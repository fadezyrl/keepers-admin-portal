const { query } = require('../config/db');
const {
  getFirebaseMessaging,
  isFirebaseReady,
  getFirebaseInitError,
} = require('../config/firebase');
const {
  listActiveTokensForUsers,
  deactivateTokensByIds,
} = require('./deviceTokenService');

const PREF_MAP = {
  trip: 'trips',
  registration: 'registrations',
  reminder: 'trips',
  event: 'events',
  club: 'club',
  announcement: 'club',
  admin: null, // always deliver
  upgrade: 'ratings',
  chat: 'chat',
};

const INVALID_FCM_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/invalid-argument',
]);

function mapDeepLink(type, data = {}) {
  if (data.screen) return String(data.screen);
  if (data.conversationId) return `keepers://chat/${data.conversationId}`;
  if (type === 'chat' && data.conversationId) {
    return `keepers://chat/${data.conversationId}`;
  }
  if (data.tripId) return `keepers://trips/${data.tripId}`;
  if (type === 'upgrade') return 'keepers://progress';
  if (type === 'announcement' || type === 'club') return 'keepers://home';
  if (type === 'admin') return 'keepers://settings';
  return 'keepers://notifications';
}

function buildPushData(notificationRow) {
  const data = notificationRow.data || {};
  const deepLink = mapDeepLink(notificationRow.type, data);
  // FCM data payload values must be strings.
  const payload = {
    notificationId: String(notificationRow.id),
    type: String(notificationRow.type || ''),
    deepLink,
  };
  if (data.tripId) payload.tripId = String(data.tripId);
  if (data.status) payload.status = String(data.status);
  if (data.upgradeRequestId) payload.upgradeRequestId = String(data.upgradeRequestId);
  if (data.announcementId) payload.announcementId = String(data.announcementId);
  if (data.memberId) payload.memberId = String(data.memberId);
  if (data.screen) payload.screen = String(data.screen);
  if (data.conversationId) payload.conversationId = String(data.conversationId);
  if (data.messageId) payload.messageId = String(data.messageId);
  return payload;
}

async function getPreference(userId) {
  const res = await query(
    `SELECT * FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );
  return (
    res.rows[0] || {
      trips: true,
      events: true,
      club: true,
      registrations: true,
      ratings: true,
      chat: true,
    }
  );
}

function isPreferred(type, prefs) {
  const key = PREF_MAP[type];
  if (!key) return true;
  // Fallback: older DBs without registrations/ratings columns
  if (key === 'registrations' && prefs.registrations == null) {
    return prefs.trips !== false;
  }
  if (key === 'ratings' && prefs.ratings == null) return true;
  if (key === 'chat' && prefs.chat == null) return true;
  return prefs[key] !== false;
}

async function setPushStatus(notificationId, status) {
  await query(`UPDATE notifications SET push_status = $1 WHERE id = $2`, [
    status,
    notificationId,
  ]);
}

async function deliverPush(notificationRow) {
  if (!notificationRow?.id || !notificationRow.user_id) return { status: 'skipped' };

  if (!isFirebaseReady()) {
    await setPushStatus(notificationRow.id, 'skipped');
    if (getFirebaseInitError()) {
      console.warn('[fcm] skipped:', getFirebaseInitError());
    }
    return { status: 'skipped' };
  }

  const tokens = await listActiveTokensForUsers([notificationRow.user_id]);
  if (!tokens.length) {
    await setPushStatus(notificationRow.id, 'none');
    return { status: 'none' };
  }

  const messaging = getFirebaseMessaging();
  if (!messaging) {
    await setPushStatus(notificationRow.id, 'skipped');
    return { status: 'skipped' };
  }
  const data = buildPushData(notificationRow);
  const invalidIds = [];
  let successCount = 0;
  let failureCount = 0;

  // Chunk to stay within FCM multicast limits.
  const chunkSize = 500;
  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: chunk.map((t) => t.fcm_token),
        notification: {
          title: notificationRow.title,
          body: notificationRow.body,
        },
        data,
        android: {
          priority: 'high',
          notification: {
            channelId: 'keepers_default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      });

      response.responses.forEach((resp, idx) => {
        if (resp.success) {
          successCount += 1;
          return;
        }
        failureCount += 1;
        const code = resp.error?.code;
        if (code && INVALID_FCM_CODES.has(code)) {
          invalidIds.push(chunk[idx].id);
        } else {
          console.warn(
            '[fcm] send failed',
            code || resp.error?.message || 'unknown',
          );
        }
      });
    } catch (err) {
      failureCount += chunk.length;
      console.warn('[fcm] multicast error:', err.message || err);
    }
  }

  if (invalidIds.length) {
    await deactivateTokensByIds(invalidIds);
  }

  let status = 'sent';
  if (successCount === 0 && failureCount > 0) status = 'failed';
  else if (successCount > 0 && failureCount > 0) status = 'partial';
  else if (successCount === 0) status = 'none';

  await setPushStatus(notificationRow.id, status);
  return { status, successCount, failureCount, invalidated: invalidIds.length };
}

/**
 * Persist an in-app notification, then best-effort FCM push.
 * Push failures never throw — callers treat business action as success.
 */
async function createNotification({
  userId,
  type,
  title,
  body,
  data = {},
  announcementId = null,
  idempotencyKey = null,
  client = null,
  skipPush = false,
}) {
  const q = client ? client.query.bind(client) : query;

  if (idempotencyKey) {
    const existing = await q(
      `SELECT * FROM notifications
       WHERE user_id = $1 AND idempotency_key = $2
       LIMIT 1`,
      [userId, idempotencyKey],
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }
  }

  const prefs = await getPreference(userId);
  const preferred = isPreferred(type, prefs);

  // Always persist account-critical types; for others still persist for in-app history
  // but skip push when user opted out.
  const shouldPush = preferred && !skipPush && !client;

  const enrichedData = {
    ...data,
    deepLink: data.deepLink || mapDeepLink(type, data),
  };

  let result;
  try {
    result = await q(
      `INSERT INTO notifications (user_id, type, title, body, data, announcement_id, idempotency_key, push_status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        type,
        title,
        body,
        JSON.stringify(enrichedData),
        announcementId,
        idempotencyKey,
        shouldPush ? 'pending' : 'skipped',
      ],
    );
  } catch (err) {
    // Race on unique idempotency index
    if (idempotencyKey && String(err.message || '').includes('idx_notifications_idempotency')) {
      const existing = await q(
        `SELECT * FROM notifications WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [userId, idempotencyKey],
      );
      if (existing.rows[0]) return existing.rows[0];
    }
    throw err;
  }

  const row = result.rows[0];

  if (shouldPush) {
    // Fire-and-forget so HTTP latency is not tied to FCM.
    setImmediate(() => {
      deliverPush(row).catch((err) => {
        console.warn('[fcm] deliverPush error:', err.message || err);
      });
    });
  }

  return row;
}

async function notifyMany(userIds, payload, client = null) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const rows = [];
  for (const userId of unique) {
    rows.push(
      await createNotification({
        ...payload,
        userId,
        client,
        idempotencyKey: payload.idempotencyKey
          ? `${payload.idempotencyKey}:${userId}`
          : null,
      }),
    );
  }
  return rows;
}

async function listAdminUserIds() {
  const res = await query(
    `SELECT DISTINCT ur.user_id
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     JOIN member_profiles mp ON mp.id = ur.user_id
     WHERE r.code IN ('admin', 'super_admin')
       AND mp.deleted_at IS NULL
       AND mp.status = 'approved'`,
  );
  return res.rows.map((r) => r.user_id);
}

async function listEligibleMemberIdsForTrip(trip) {
  const params = [];
  let rankFilter = '';
  if (trip.required_membership_level_id) {
    const level = await query(
      `SELECT rank FROM membership_levels WHERE id = $1`,
      [trip.required_membership_level_id],
    );
    if (level.rows[0]) {
      params.push(level.rows[0].rank);
      rankFilter = `AND (ml.rank IS NULL OR ml.rank >= $${params.length})`;
    }
  }
  if (trip.min_trips_required > 0) {
    params.push(trip.min_trips_required);
    rankFilter += ` AND mp.completed_trips >= $${params.length}`;
  }

  const res = await query(
    `SELECT mp.id
     FROM member_profiles mp
     LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
     WHERE mp.deleted_at IS NULL
       AND mp.status = 'approved'
       ${rankFilter}`,
    params,
  );
  return res.rows.map((r) => r.id);
}

async function listTripParticipantIds(tripId, statuses = ['registered', 'pending']) {
  const res = await query(
    `SELECT user_id FROM trip_registrations
     WHERE trip_id = $1 AND status = ANY($2::text[])`,
    [tripId, statuses],
  );
  return res.rows.map((r) => r.user_id);
}

module.exports = {
  createNotification,
  notifyMany,
  deliverPush,
  listAdminUserIds,
  listEligibleMemberIdsForTrip,
  listTripParticipantIds,
  mapDeepLink,
};
