/**
 * Chat ACL + private uniqueness + receipt scope tests (service-level).
 */
const { query } = require('../src/config/db');
const chatService = require('../src/services/chatService');
const { AppError } = require('../src/utils/AppError');

async function makeTrip(organizerId) {
  const res = await query(
    `INSERT INTO trips (
       title, description, destination, trip_date, max_participants, status,
       published_at, created_by, organizer_id
     ) VALUES (
       'Chat ACL Spec', 'auto', 'Range', CURRENT_DATE + 21, 10, 'published',
       NOW(), $1, $1
     ) RETURNING id`,
    [organizerId],
  );
  return res.rows[0].id;
}

async function cleanup(tripId) {
  await query(`DELETE FROM conversations WHERE trip_id = $1`, [tripId]);
  await query(`DELETE FROM trip_registrations WHERE trip_id = $1`, [tripId]);
  await query(`DELETE FROM trips WHERE id = $1`, [tripId]);
}

async function main() {
  const members = await query(
    `SELECT mp.id,
            COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
     FROM member_profiles mp
     LEFT JOIN user_roles ur ON ur.user_id = mp.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE mp.status = 'approved' AND mp.deleted_at IS NULL
     GROUP BY mp.id
     LIMIT 40`,
  );

  const marshall = members.rows.find((m) => m.roles.includes('marshall'));
  const others = members.rows.filter((m) => m.id !== marshall?.id);
  if (!marshall || others.length < 2) {
    console.log(JSON.stringify({ skipped: true, reason: 'Need marshall + 2 members' }));
    return;
  }

  const memberA = others[0];
  const memberB = others[1];

  const actorMarshall = {
    id: marshall.id,
    permissions: ['chat.read', 'chat.send', 'trips.manage_own', 'trips.create'],
    roles: ['marshall'],
  };
  const actorA = {
    id: memberA.id,
    permissions: ['chat.read', 'chat.send', 'trips.read'],
    roles: ['member'],
  };
  const actorB = {
    id: memberB.id,
    permissions: ['chat.read', 'chat.send', 'trips.read'],
    roles: ['member'],
  };

  const report = {
    confirmedCanJoinGroup: false,
    pendingCannotJoin: false,
    privateUnique: false,
    privateIsolation: false,
    revokeOnCancel: false,
    receiptsScoped: false,
  };

  const tripId = await makeTrip(marshall.id);
  try {
    await query(
      `INSERT INTO trip_registrations (trip_id, user_id, status)
       VALUES ($1, $2, 'pending')`,
      [tripId, memberA.id],
    );
    await chatService.ensureGroupConversation(tripId);
    const group = await query(
      `SELECT id FROM conversations WHERE trip_id = $1 AND type = 'group'`,
      [tripId],
    );
    const groupId = group.rows[0].id;

    try {
      await chatService.assertCanAccessConversation(groupId, actorA);
    } catch (err) {
      report.pendingCannotJoin =
        err instanceof AppError && err.status === 403;
    }

    await query(
      `UPDATE trip_registrations SET status = 'registered' WHERE trip_id = $1 AND user_id = $2`,
      [tripId, memberA.id],
    );
    await chatService.activateUserOnTripChats(tripId, memberA.id, 'member');
    await chatService.assertCanAccessConversation(groupId, actorA);
    report.confirmedCanJoinGroup = true;

    const priv1 = await chatService.ensurePrivateConversation(tripId, memberA.id);
    const priv2 = await chatService.ensurePrivateConversation(tripId, memberA.id);
    report.privateUnique = priv1.id === priv2.id;

    await chatService.activateUserOnTripChats(tripId, memberB.id, 'member');
    await query(
      `INSERT INTO trip_registrations (trip_id, user_id, status)
       VALUES ($1, $2, 'registered')
       ON CONFLICT DO NOTHING`,
      [tripId, memberB.id],
    );
    try {
      await chatService.assertCanAccessConversation(priv1.id, actorB);
    } catch (err) {
      report.privateIsolation =
        err instanceof AppError && err.status === 403;
    }

    const msg = await chatService.sendMessage(groupId, actorMarshall, {
      messageType: 'text',
      content: 'ACL test message',
      clientMessageId: require('crypto').randomUUID(),
    });
    const receipts = await query(
      `SELECT user_id, delivered_at, read_at FROM message_receipts WHERE message_id = $1`,
      [msg.id],
    );
    report.receiptsScoped =
      receipts.rows.every((r) => r.user_id !== marshall.id) &&
      receipts.rows.every((r) => !r.delivered_at && !r.read_at) &&
      receipts.rows.some((r) => r.user_id === memberA.id);

    await chatService.revokeUserFromTripChats(tripId, memberA.id);
    try {
      await chatService.assertCanAccessConversation(groupId, actorA);
    } catch (err) {
      report.revokeOnCancel =
        err instanceof AppError && err.status === 403;
    }
  } finally {
    await cleanup(tripId);
  }

  const passed = Object.values(report).every(Boolean);
  console.log(JSON.stringify({ passed, report }, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
