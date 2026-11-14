const { randomUUID } = require('crypto');
const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { hasPermission } = require('../middleware/auth');
const { getAdminClient } = require('../config/supabase');
const { createNotification } = require('./notificationService');
const { isUserViewing } = require('./presenceStore');
const { writeAudit } = require('./auditService');

const TEXT_MAX = 4000;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VOICE_MAX_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_MS = 60 * 1000;
const VOICE_MAX_MS = 120 * 1000;

const CHAT_MIME = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  video: new Set(['video/mp4', 'video/quicktime', 'video/webm']),
  voice: new Set([
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/mpeg',
  ]),
};

let socketHub = null;

function setChatSocketHub(hub) {
  socketHub = hub;
}

function emitToConversation(conversationId, event, payload) {
  if (socketHub?.emitToConversation) {
    socketHub.emitToConversation(conversationId, event, payload);
  }
}

function emitToUser(userId, event, payload) {
  if (socketHub?.emitToUser) {
    socketHub.emitToUser(userId, event, payload);
  }
}

function removeUserFromConversationRoom(userId, conversationId) {
  if (socketHub?.removeUserFromConversation) {
    socketHub.removeUserFromConversation(userId, conversationId);
  }
}

function isModerator(actor) {
  return (
    hasPermission(actor, 'chat.moderate') ||
    hasPermission(actor, 'trips.manage') ||
    (actor.roles || []).includes('super_admin') ||
    (actor.roles || []).includes('admin')
  );
}

async function getConversationRow(conversationId, client = null) {
  const q = client ? client.query.bind(client) : query;
  const res = await q(`SELECT * FROM conversations WHERE id = $1`, [conversationId]);
  return res.rows[0] || null;
}

async function getActiveParticipant(conversationId, userId, client = null) {
  const q = client ? client.query.bind(client) : query;
  const res = await q(
    `SELECT * FROM conversation_participants
     WHERE conversation_id = $1 AND user_id = $2 AND is_active = TRUE`,
    [conversationId, userId],
  );
  return res.rows[0] || null;
}

/**
 * Conversation-level ACL. Must be called for every join/send/receipt/media action.
 */
async function assertCanAccessConversation(conversationId, actor, { requireSend = false } = {}) {
  if (!actor?.id) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  if (!hasPermission(actor, 'chat.read') && !isModerator(actor)) {
    throw new AppError(403, 'FORBIDDEN', 'Chat access not granted');
  }

  const conversation = await getConversationRow(conversationId);
  if (!conversation) throw new AppError(404, 'NOT_FOUND', 'Conversation not found');

  if (isModerator(actor)) {
    if (requireSend && conversation.is_readonly && !hasPermission(actor, 'chat.moderate')) {
      throw new AppError(409, 'CHAT_READONLY', 'Conversation is read-only');
    }
    return { conversation, participant: null, asModerator: true };
  }

  const participant = await getActiveParticipant(conversationId, actor.id);
  if (!participant) {
    throw new AppError(403, 'FORBIDDEN', 'Not a participant in this conversation');
  }

  if (requireSend) {
    if (!hasPermission(actor, 'chat.send')) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot send messages');
    }
    if (conversation.is_readonly || conversation.is_archived) {
      throw new AppError(409, 'CHAT_READONLY', 'Conversation is read-only');
    }
  }

  return { conversation, participant, asModerator: false };
}

async function getTripChatContext(tripId) {
  const res = await query(
    `SELECT id, title, trip_date, cover_image_url, organizer_id, status, deleted_at
     FROM trips WHERE id = $1`,
    [tripId],
  );
  return res.rows[0] || null;
}

async function upsertParticipant(conversationId, userId, roleInChat, { active = true } = {}) {
  const res = await query(
    `INSERT INTO conversation_participants (
       conversation_id, user_id, role_in_chat, is_active, joined_at, left_at
     ) VALUES ($1, $2, $3, $4, NOW(), CASE WHEN $4 THEN NULL ELSE NOW() END)
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET
       role_in_chat = EXCLUDED.role_in_chat,
       is_active = EXCLUDED.is_active,
       left_at = CASE WHEN EXCLUDED.is_active THEN NULL ELSE NOW() END,
       joined_at = CASE
         WHEN conversation_participants.is_active = FALSE AND EXCLUDED.is_active = TRUE
         THEN NOW()
         ELSE conversation_participants.joined_at
       END,
       updated_at = NOW()
     RETURNING *`,
    [conversationId, userId, roleInChat, active],
  );
  return res.rows[0];
}

async function ensureGroupConversation(tripId) {
  const trip = await getTripChatContext(tripId);
  if (!trip || trip.deleted_at) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  const existing = await query(
    `SELECT * FROM conversations WHERE trip_id = $1 AND type = 'group'`,
    [tripId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await query(
    `INSERT INTO conversations (trip_id, type, title)
     VALUES ($1, 'group', $2)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [tripId, trip.title],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const again = await query(
    `SELECT * FROM conversations WHERE trip_id = $1 AND type = 'group'`,
    [tripId],
  );
  return again.rows[0];
}

async function ensurePrivateConversation(tripId, memberId) {
  const trip = await getTripChatContext(tripId);
  if (!trip || trip.deleted_at) throw new AppError(404, 'NOT_FOUND', 'Trip not found');
  if (!trip.organizer_id) {
    throw new AppError(409, 'NO_ORGANIZER', 'Trip has no Marshall organizer');
  }
  if (memberId === trip.organizer_id) {
    throw new AppError(400, 'INVALID_PRIVATE', 'Cannot open private chat with yourself');
  }

  const existing = await query(
    `SELECT * FROM conversations
     WHERE trip_id = $1 AND type = 'private' AND private_member_id = $2`,
    [tripId, memberId],
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await query(
    `INSERT INTO conversations (trip_id, type, private_member_id, title)
     VALUES ($1, 'private', $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [tripId, memberId, trip.title],
  );
  if (inserted.rows[0]) {
    await upsertParticipant(inserted.rows[0].id, trip.organizer_id, 'organizer');
    await upsertParticipant(inserted.rows[0].id, memberId, 'member');
    return inserted.rows[0];
  }
  const again = await query(
    `SELECT * FROM conversations
     WHERE trip_id = $1 AND type = 'private' AND private_member_id = $2`,
    [tripId, memberId],
  );
  return again.rows[0];
}

/**
 * Sync group participants from trip membership (registered + organizer + assigned pre-marshalls).
 */
async function syncGroupParticipantsForTrip(tripId) {
  const conversation = await ensureGroupConversation(tripId);
  const trip = await getTripChatContext(tripId);
  if (!trip) return conversation;

  if (trip.organizer_id) {
    await upsertParticipant(conversation.id, trip.organizer_id, 'organizer', { active: true });
  }

  const regs = await query(
    `SELECT user_id FROM trip_registrations
     WHERE trip_id = $1 AND status = 'registered'`,
    [tripId],
  );
  const registeredIds = new Set(regs.rows.map((r) => r.user_id));

  const assigned = await query(
    `SELECT user_id FROM trip_pre_marshall_assignments WHERE trip_id = $1`,
    [tripId],
  );
  const preIds = new Set(assigned.rows.map((r) => r.user_id));

  for (const userId of registeredIds) {
    if (userId === trip.organizer_id) continue;
    await upsertParticipant(conversation.id, userId, 'member', { active: true });
  }
  for (const userId of preIds) {
    if (userId === trip.organizer_id || registeredIds.has(userId)) continue;
    await upsertParticipant(conversation.id, userId, 'pre_marshall', { active: true });
  }

  // Deactivate anyone no longer eligible (except leave moderators who aren't trip-bound)
  const active = await query(
    `SELECT user_id, role_in_chat FROM conversation_participants
     WHERE conversation_id = $1 AND is_active = TRUE`,
    [conversation.id],
  );
  for (const row of active.rows) {
    if (row.role_in_chat === 'moderator') continue;
    const stillOk =
      row.user_id === trip.organizer_id ||
      registeredIds.has(row.user_id) ||
      preIds.has(row.user_id);
    if (!stillOk) {
      await upsertParticipant(conversation.id, row.user_id, row.role_in_chat, {
        active: false,
      });
      removeUserFromConversationRoom(row.user_id, conversation.id);
      emitToUser(row.user_id, 'chat:access.revoked', {
        conversationId: conversation.id,
        tripId,
      });
    }
  }

  if (trip.status === 'cancelled') {
    await query(
      `UPDATE conversations SET is_readonly = TRUE, updated_at = NOW() WHERE id = $1`,
      [conversation.id],
    );
  }

  return conversation;
}

async function revokeUserFromTripChats(tripId, userId) {
  const convos = await query(
    `SELECT id, type FROM conversations WHERE trip_id = $1`,
    [tripId],
  );
  for (const c of convos.rows) {
    await query(
      `UPDATE conversation_participants
       SET is_active = FALSE, left_at = NOW(), updated_at = NOW()
       WHERE conversation_id = $1 AND user_id = $2 AND is_active = TRUE`,
      [c.id, userId],
    );
    removeUserFromConversationRoom(userId, c.id);
    emitToUser(userId, 'chat:access.revoked', {
      conversationId: c.id,
      tripId,
    });
  }
}

async function activateUserOnTripChats(tripId, userId, roleInChat = 'member') {
  const group = await syncGroupParticipantsForTrip(tripId);
  await upsertParticipant(group.id, userId, roleInChat, { active: true });
  // Private chat is created on demand; ensure participant rows if it already exists
  const priv = await query(
    `SELECT id FROM conversations
     WHERE trip_id = $1 AND type = 'private' AND private_member_id = $2`,
    [tripId, userId],
  );
  if (priv.rows[0]) {
    const trip = await getTripChatContext(tripId);
    if (trip?.organizer_id) {
      await upsertParticipant(priv.rows[0].id, trip.organizer_id, 'organizer', {
        active: true,
      });
    }
    await upsertParticipant(priv.rows[0].id, userId, 'member', { active: true });
  }
}

async function signChatUrl(bucket, path, expiresSec = 3600) {
  const admin = getAdminClient();
  if (!admin || !path) return null;
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, expiresSec);
  if (error) return null;
  return data?.signedUrl || null;
}

function mapAttachment(row, signedUrl) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    waveform: row.waveform_json || null,
    thumbnailUrl: row.thumbnail_url,
    url: signedUrl || row.public_url || null,
  };
}

async function mapMessage(row, { includeReceiptSummary = false, viewerId = null } = {}) {
  const attRes = await query(
    `SELECT * FROM message_attachments WHERE message_id = $1 ORDER BY created_at ASC`,
    [row.id],
  );
  const attachments = [];
  for (const a of attRes.rows) {
    const signed = await signChatUrl(a.bucket, a.storage_path);
    attachments.push(mapAttachment(a, signed));
  }

  let sender = null;
  if (row.sender_id) {
    const s = await query(
      `SELECT id, first_name, last_name, avatar_url FROM member_profiles WHERE id = $1`,
      [row.sender_id],
    );
    if (s.rows[0]) {
      sender = {
        id: s.rows[0].id,
        name: `${s.rows[0].first_name} ${s.rows[0].last_name}`.trim(),
        avatar: s.rows[0].avatar_url,
      };
    }
  }

  let receipt = null;
  if (includeReceiptSummary) {
    const counts = await query(
      `SELECT
         COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
         COUNT(*) FILTER (WHERE read_at IS NOT NULL)::int AS read,
         COUNT(*)::int AS total
       FROM message_receipts WHERE message_id = $1`,
      [row.id],
    );
    receipt = counts.rows[0];
  }

  let myReceipt = null;
  if (viewerId) {
    const mine = await query(
      `SELECT delivered_at, read_at FROM message_receipts
       WHERE message_id = $1 AND user_id = $2`,
      [row.id, viewerId],
    );
    myReceipt = mine.rows[0] || null;
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    clientMessageId: row.client_message_id,
    type: row.message_type,
    content: row.deleted_at ? null : row.content,
    replyToMessageId: row.reply_to_message_id,
    sender,
    attachments,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    receipt,
    myReceipt,
  };
}

async function listActiveRecipientIds(conversationId, excludeUserId = null) {
  const res = await query(
    `SELECT user_id FROM conversation_participants
     WHERE conversation_id = $1 AND is_active = TRUE
       AND ($2::uuid IS NULL OR user_id <> $2)`,
    [conversationId, excludeUserId],
  );
  return res.rows.map((r) => r.user_id);
}

async function sendMessage(conversationId, actor, payload) {
  const { conversation } = await assertCanAccessConversation(conversationId, actor, {
    requireSend: true,
  });

  const type = payload.messageType || payload.type || 'text';
  if (!['text', 'image', 'video', 'voice', 'system'].includes(type)) {
    throw new AppError(400, 'INVALID_TYPE', 'Invalid message type');
  }
  if (type === 'system' && !isModerator(actor)) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot send system messages');
  }

  const content = (payload.content || '').trim();
  if (type === 'text' && !content) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Message text is required');
  }
  if (content.length > TEXT_MAX) {
    throw new AppError(400, 'VALIDATION_ERROR', `Message exceeds ${TEXT_MAX} characters`);
  }

  const clientMessageId = payload.clientMessageId || null;
  if (clientMessageId) {
    const dup = await query(
      `SELECT * FROM messages WHERE conversation_id = $1 AND client_message_id = $2`,
      [conversationId, clientMessageId],
    );
    if (dup.rows[0]) {
      return mapMessage(dup.rows[0], { includeReceiptSummary: true, viewerId: actor.id });
    }
  }

  const attachmentId = payload.attachmentId || null;
  if (['image', 'video', 'voice'].includes(type) && !attachmentId) {
    throw new AppError(400, 'ATTACHMENT_REQUIRED', 'Attachment is required for media messages');
  }

  const { message, recipientIds } = await withTransaction(async (client) => {
    if (attachmentId) {
      const att = await client.query(
        `SELECT * FROM message_attachments
         WHERE id = $1 AND conversation_id = $2 AND uploaded_by = $3 AND message_id IS NULL`,
        [attachmentId, conversationId, actor.id],
      );
      if (!att.rows[0]) {
        throw new AppError(400, 'INVALID_ATTACHMENT', 'Attachment not found or already used');
      }
      if (att.rows[0].kind !== type) {
        throw new AppError(400, 'ATTACHMENT_TYPE_MISMATCH', 'Attachment kind does not match message type');
      }
    }

    if (payload.replyToMessageId) {
      const reply = await client.query(
        `SELECT id FROM messages
         WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
        [payload.replyToMessageId, conversationId],
      );
      if (!reply.rows[0]) {
        throw new AppError(400, 'INVALID_REPLY', 'Reply target not found in this conversation');
      }
    }

    const inserted = await client.query(
      `INSERT INTO messages (
         conversation_id, sender_id, message_type, content,
         client_message_id, reply_to_message_id
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        conversationId,
        actor.id,
        type,
        content || null,
        clientMessageId,
        payload.replyToMessageId || null,
      ],
    );
    const msg = inserted.rows[0];

    if (attachmentId) {
      await client.query(
        `UPDATE message_attachments SET message_id = $1 WHERE id = $2`,
        [msg.id, attachmentId],
      );
    }

    const recipients = await client.query(
      `SELECT user_id FROM conversation_participants
       WHERE conversation_id = $1 AND is_active = TRUE AND user_id <> $2`,
      [conversationId, actor.id],
    );
    const ids = recipients.rows.map((r) => r.user_id);

    // Receipt scope defined at send time for active recipients only.
    for (const userId of ids) {
      await client.query(
        `INSERT INTO message_receipts (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [msg.id, userId],
      );
    }

    await client.query(
      `UPDATE conversations
       SET last_message_at = $1, updated_at = NOW()
       WHERE id = $2`,
      [msg.created_at, conversationId],
    );

    return { message: msg, recipientIds: ids };
  });

  const mapped = await mapMessage(message, {
    includeReceiptSummary: true,
    viewerId: actor.id,
  });

  emitToConversation(conversationId, 'chat:message.new', { message: mapped });

  // FCM: never treat as delivery proof. Suppress only while user is viewing.
  for (const userId of recipientIds) {
    const viewing = await isUserViewing(conversationId, userId);
    if (viewing) continue;
    const muted = await query(
      `SELECT is_muted FROM conversation_participants
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );
    if (muted.rows[0]?.is_muted) continue;

    const preview =
      type === 'text'
        ? content.slice(0, 120)
        : type === 'image'
          ? 'Sent a photo'
          : type === 'video'
            ? 'Sent a video'
            : type === 'voice'
              ? 'Sent a voice message'
              : 'New message';

    createNotification({
      userId,
      type: 'chat',
      title: mapped.sender?.name || 'Keepers Chat',
      body: preview,
      data: {
        conversationId,
        tripId: conversation.trip_id,
        messageId: message.id,
        screen: `keepers://chat/${conversationId}`,
      },
      idempotencyKey: `chat:${message.id}:${userId}`,
    }).catch(() => undefined);
  }

  return mapped;
}

async function listMessages(conversationId, actor, { before = null, limit = 40 } = {}) {
  await assertCanAccessConversation(conversationId, actor);
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const params = [conversationId];
  let sql = `
    SELECT * FROM messages
    WHERE conversation_id = $1`;
  if (before) {
    params.push(before);
    sql += ` AND created_at < $${params.length}`;
  }
  params.push(safeLimit);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const res = await query(sql, params);
  const items = [];
  for (const row of res.rows.reverse()) {
    items.push(await mapMessage(row, { includeReceiptSummary: true, viewerId: actor.id }));
  }
  return {
    items,
    nextBefore: res.rows.length ? res.rows[res.rows.length - 1].created_at : null,
  };
}

/**
 * Device ACK only — Socket emit / FCM send is NOT delivery proof.
 */
async function ackDelivered(conversationId, actor, messageIds = []) {
  await assertCanAccessConversation(conversationId, actor);
  const ids = (messageIds || []).filter(Boolean);
  if (!ids.length) return { updated: 0 };

  const res = await query(
    `UPDATE message_receipts SET delivered_at = COALESCE(delivered_at, NOW())
     WHERE user_id = $1
       AND message_id = ANY($2::uuid[])
       AND message_id IN (
         SELECT id FROM messages WHERE conversation_id = $3
       )
     RETURNING message_id`,
    [actor.id, ids, conversationId],
  );

  await query(
    `UPDATE conversation_participants
     SET last_delivered_at = NOW(), updated_at = NOW()
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, actor.id],
  );

  for (const row of res.rows) {
    emitToConversation(conversationId, 'chat:receipt.update', {
      conversationId,
      messageId: row.message_id,
      messageIds: [row.message_id],
      userId: actor.id,
      status: 'delivered',
      deliveredAt: new Date().toISOString(),
    });
  }
  return { updated: res.rowCount };
}

async function ackRead(conversationId, actor, { upToMessageId = null } = {}) {
  await assertCanAccessConversation(conversationId, actor);

  let result;
  if (upToMessageId) {
    result = await query(
      `UPDATE message_receipts mr
       SET
         delivered_at = COALESCE(mr.delivered_at, NOW()),
         read_at = COALESCE(mr.read_at, NOW())
       FROM messages m
       WHERE mr.message_id = m.id
         AND m.conversation_id = $1
         AND mr.user_id = $2
         AND m.created_at <= (SELECT created_at FROM messages WHERE id = $3)
         AND mr.read_at IS NULL
       RETURNING mr.message_id`,
      [conversationId, actor.id, upToMessageId],
    );
  } else {
    result = await query(
      `UPDATE message_receipts mr
       SET
         delivered_at = COALESCE(mr.delivered_at, NOW()),
         read_at = COALESCE(mr.read_at, NOW())
       FROM messages m
       WHERE mr.message_id = m.id
         AND m.conversation_id = $1
         AND mr.user_id = $2
         AND mr.read_at IS NULL
       RETURNING mr.message_id`,
      [conversationId, actor.id],
    );
  }

  await query(
    `UPDATE conversation_participants
     SET last_read_at = NOW(),
         last_delivered_at = COALESCE(last_delivered_at, NOW()),
         updated_at = NOW()
     WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, actor.id],
  );

  emitToConversation(conversationId, 'chat:receipt.update', {
    conversationId,
    userId: actor.id,
    status: 'read',
    readAt: new Date().toISOString(),
    messageIds: result.rows.map((r) => r.message_id),
  });

  return { updated: result.rowCount };
}

async function uploadChatAttachment(conversationId, actor, file, meta = {}) {
  await assertCanAccessConversation(conversationId, actor, { requireSend: true });
  if (!file?.buffer) throw new AppError(400, 'NO_FILE', 'File is required');

  const kind = meta.kind || meta.messageType;
  if (!['image', 'video', 'voice'].includes(kind)) {
    throw new AppError(400, 'INVALID_KIND', 'kind must be image, video, or voice');
  }
  const mime = file.mimetype;
  if (!CHAT_MIME[kind].has(mime)) {
    throw new AppError(400, 'INVALID_TYPE', `MIME ${mime} not allowed for ${kind}`);
  }

  const size = file.size || file.buffer.length;
  const max =
    kind === 'image' ? IMAGE_MAX_BYTES : kind === 'video' ? VIDEO_MAX_BYTES : VOICE_MAX_BYTES;
  if (size > max) {
    throw new AppError(400, 'FILE_TOO_LARGE', `Max size for ${kind} is ${max} bytes`);
  }

  const durationMs = meta.durationMs != null ? Number(meta.durationMs) : null;
  if (kind === 'video' && durationMs != null && durationMs > VIDEO_MAX_MS) {
    throw new AppError(400, 'DURATION_TOO_LONG', 'Video max duration is 60 seconds');
  }
  if (kind === 'voice' && durationMs != null && durationMs > VOICE_MAX_MS) {
    throw new AppError(400, 'DURATION_TOO_LONG', 'Voice max duration is 120 seconds');
  }

  const admin = getAdminClient();
  if (!admin) throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'Storage not configured');

  const ext = (file.originalname || mime.split('/')[1] || 'bin').split('.').pop();
  const path = `${conversationId}/${actor.id}/${Date.now()}-${randomUUID()}.${ext}`;
  const { error } = await admin.storage.from('chat').upload(path, file.buffer, {
    contentType: mime,
    upsert: false,
  });
  if (error) throw new AppError(400, 'UPLOAD_FAILED', error.message);

  let waveform = null;
  if (meta.waveform) {
    try {
      waveform = typeof meta.waveform === 'string' ? JSON.parse(meta.waveform) : meta.waveform;
    } catch {
      waveform = null;
    }
  }

  const inserted = await query(
    `INSERT INTO message_attachments (
       uploaded_by, conversation_id, kind, bucket, storage_path,
       mime_type, byte_size, width, height, duration_ms, waveform_json, thumbnail_url
     ) VALUES ($1,$2,$3,'chat',$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      actor.id,
      conversationId,
      kind,
      path,
      mime,
      size,
      meta.width ? Number(meta.width) : null,
      meta.height ? Number(meta.height) : null,
      durationMs,
      waveform ? JSON.stringify(waveform) : null,
      meta.thumbnailUrl || null,
    ],
  );

  const signed = await signChatUrl('chat', path);
  return mapAttachment(inserted.rows[0], signed);
}

async function listInbox(actor, { limit = 50 } = {}) {
  if (!hasPermission(actor, 'chat.read') && !isModerator(actor)) {
    throw new AppError(403, 'FORBIDDEN', 'Chat access not granted');
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);

  let sql;
  let params;
  if (isModerator(actor)) {
    sql = `
      SELECT c.*, t.title AS trip_title, t.trip_date, t.cover_image_url,
             (
               SELECT COUNT(*)::int FROM message_receipts mr
               JOIN messages m ON m.id = mr.message_id
               WHERE m.conversation_id = c.id AND mr.user_id = $1 AND mr.read_at IS NULL
             ) AS unread_count,
             (
               SELECT m.content FROM messages m
               WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
               ORDER BY m.created_at DESC LIMIT 1
             ) AS last_content,
             (
               SELECT m.message_type FROM messages m
               WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
               ORDER BY m.created_at DESC LIMIT 1
             ) AS last_type
      FROM conversations c
      JOIN trips t ON t.id = c.trip_id AND t.deleted_at IS NULL
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT $2`;
    params = [actor.id, safeLimit];
  } else {
    sql = `
      SELECT c.*, t.title AS trip_title, t.trip_date, t.cover_image_url,
             (
               SELECT COUNT(*)::int FROM message_receipts mr
               JOIN messages m ON m.id = mr.message_id
               WHERE m.conversation_id = c.id AND mr.user_id = $1 AND mr.read_at IS NULL
             ) AS unread_count,
             (
               SELECT m.content FROM messages m
               WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
               ORDER BY m.created_at DESC LIMIT 1
             ) AS last_content,
             (
               SELECT m.message_type FROM messages m
               WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
               ORDER BY m.created_at DESC LIMIT 1
             ) AS last_type
      FROM conversations c
      JOIN conversation_participants cp
        ON cp.conversation_id = c.id AND cp.user_id = $1 AND cp.is_active = TRUE
      JOIN trips t ON t.id = c.trip_id AND t.deleted_at IS NULL
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT $2`;
    params = [actor.id, safeLimit];
  }

  const res = await query(sql, params);
  return {
    items: res.rows.map((r) => ({
      id: r.id,
      type: r.type,
      tripId: r.trip_id,
      privateMemberId: r.private_member_id,
      tripTitle: r.trip_title,
      tripDate: r.trip_date,
      coverImage: r.cover_image_url,
      isReadonly: r.is_readonly,
      isArchived: r.is_archived,
      lastMessageAt: r.last_message_at,
      lastPreview:
        r.last_type === 'text'
          ? r.last_content
          : r.last_type
            ? `[${r.last_type}]`
            : null,
      unreadCount: r.unread_count || 0,
    })),
  };
}

async function getConversation(conversationId, actor) {
  const { conversation } = await assertCanAccessConversation(conversationId, actor);
  const trip = await getTripChatContext(conversation.trip_id);
  const participants = await query(
    `SELECT cp.user_id, cp.role_in_chat, cp.is_active,
            mp.first_name, mp.last_name, mp.avatar_url
     FROM conversation_participants cp
     JOIN member_profiles mp ON mp.id = cp.user_id
     WHERE cp.conversation_id = $1 AND cp.is_active = TRUE
     ORDER BY
       CASE cp.role_in_chat
         WHEN 'organizer' THEN 0
         WHEN 'pre_marshall' THEN 1
         WHEN 'moderator' THEN 2
         ELSE 3
       END,
       mp.first_name`,
    [conversationId],
  );

  const unread = await query(
    `SELECT COUNT(*)::int AS n FROM message_receipts mr
     JOIN messages m ON m.id = mr.message_id
     WHERE m.conversation_id = $1 AND mr.user_id = $2 AND mr.read_at IS NULL`,
    [conversationId, actor.id],
  );

  return {
    id: conversation.id,
    type: conversation.type,
    tripId: conversation.trip_id,
    privateMemberId: conversation.private_member_id,
    isReadonly: conversation.is_readonly,
    isArchived: conversation.is_archived,
    unreadCount: unread.rows[0]?.n || 0,
    trip: trip
      ? {
          id: trip.id,
          title: trip.title,
          date: trip.trip_date,
          coverImage: trip.cover_image_url,
          organizerId: trip.organizer_id,
          status: trip.status,
        }
      : null,
    participants: participants.rows.map((p) => ({
      id: p.user_id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      avatar: p.avatar_url,
      roleInChat: p.role_in_chat,
    })),
  };
}

async function openGroupForTrip(tripId, actor) {
  await syncGroupParticipantsForTrip(tripId);
  const conversation = await ensureGroupConversation(tripId);
  await assertCanAccessConversation(conversation.id, actor);
  return getConversation(conversation.id, actor);
}

async function openPrivateForTrip(tripId, actor) {
  const trip = await getTripChatContext(tripId);
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  let memberId = actor.id;
  if (isModerator(actor) && actor.id !== trip.organizer_id) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Specify member context via participant flow');
  }

  // Member opens with organizer; organizer cannot invent arbitrary private without member
  if (actor.id === trip.organizer_id) {
    throw new AppError(
      400,
      'USE_MEMBER_THREAD',
      'Marshalls open private threads from a participant context',
    );
  }

  // Must be confirmed registrant
  const reg = await query(
    `SELECT status FROM trip_registrations WHERE trip_id = $1 AND user_id = $2`,
    [tripId, memberId],
  );
  if (reg.rows[0]?.status !== 'registered') {
    throw new AppError(403, 'FORBIDDEN', 'Only confirmed participants can open private chat');
  }

  const conversation = await ensurePrivateConversation(tripId, memberId);
  await assertCanAccessConversation(conversation.id, actor);
  return getConversation(conversation.id, actor);
}

async function openPrivateAsMarshall(tripId, memberId, actor) {
  const trip = await getTripChatContext(tripId);
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');
  const can =
    isModerator(actor) ||
    (hasPermission(actor, 'trips.manage_own') && trip.organizer_id === actor.id);
  if (!can) throw new AppError(403, 'FORBIDDEN', 'Not the trip organizer');

  const reg = await query(
    `SELECT status FROM trip_registrations WHERE trip_id = $1 AND user_id = $2`,
    [tripId, memberId],
  );
  if (reg.rows[0]?.status !== 'registered') {
    throw new AppError(403, 'FORBIDDEN', 'Member is not a confirmed participant');
  }

  const conversation = await ensurePrivateConversation(tripId, memberId);
  return getConversation(conversation.id, actor);
}

async function softDeleteMessage(messageId, actor, reason) {
  if (!isModerator(actor) && !hasPermission(actor, 'chat.moderate')) {
    // Allow sender soft-delete of own message within policy
  }
  const msg = await query(`SELECT * FROM messages WHERE id = $1`, [messageId]);
  if (!msg.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  const row = msg.rows[0];
  await assertCanAccessConversation(row.conversation_id, actor);

  const canModerate = isModerator(actor);
  const isSender = row.sender_id === actor.id;
  if (!canModerate && !isSender) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot delete this message');
  }

  await query(
    `UPDATE messages SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2`,
    [actor.id, messageId],
  );
  await query(
    `INSERT INTO chat_moderation_actions (actor_id, action, conversation_id, message_id, reason)
     VALUES ($1, 'delete_message', $2, $3, $4)`,
    [actor.id, row.conversation_id, messageId, reason || null],
  );

  emitToConversation(row.conversation_id, 'chat:message.deleted', {
    messageId,
    conversationId: row.conversation_id,
  });
  return { id: messageId, deleted: true };
}

async function reportMessage(messageId, actor, reason) {
  const msg = await query(`SELECT * FROM messages WHERE id = $1`, [messageId]);
  if (!msg.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  await assertCanAccessConversation(msg.rows[0].conversation_id, actor);
  if (!reason?.trim()) throw new AppError(400, 'VALIDATION_ERROR', 'Reason is required');

  const inserted = await query(
    `INSERT INTO chat_reports (
       reporter_id, conversation_id, message_id, reported_user_id, reason
     ) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      actor.id,
      msg.rows[0].conversation_id,
      messageId,
      msg.rows[0].sender_id,
      reason.trim(),
    ],
  );
  return inserted.rows[0];
}

module.exports = {
  setChatSocketHub,
  assertCanAccessConversation,
  ensureGroupConversation,
  ensurePrivateConversation,
  syncGroupParticipantsForTrip,
  revokeUserFromTripChats,
  activateUserOnTripChats,
  sendMessage,
  listMessages,
  ackDelivered,
  ackRead,
  uploadChatAttachment,
  listInbox,
  getConversation,
  openGroupForTrip,
  openPrivateForTrip,
  openPrivateAsMarshall,
  softDeleteMessage,
  reportMessage,
  listActiveRecipientIds,
  TEXT_MAX,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VOICE_MAX_BYTES,
};
