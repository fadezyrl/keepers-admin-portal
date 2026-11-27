/* One-off diagnostic: chat push path */
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const c = new Client({
    connectionString: process.env.DATABASE_URL || process.env.database_url,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const notifs = await c.query(`
    SELECT n.id, n.user_id, n.type, n.title, left(n.body,80) AS body, n.push_status, n.created_at,
           n.data, p.first_name, p.last_name, p.email
    FROM notifications n
    LEFT JOIN member_profiles p ON p.id = n.user_id
    WHERE n.type = 'chat'
    ORDER BY n.created_at DESC
    LIMIT 15
  `);
  console.log('=== recent chat notifications ===');
  console.log(JSON.stringify(notifs.rows, null, 2));

  const byStatus = await c.query(`
    SELECT push_status, count(*)::int AS n
    FROM notifications
    WHERE type = 'chat' AND created_at > NOW() - INTERVAL '7 days'
    GROUP BY push_status
    ORDER BY n DESC
  `);
  console.log('=== chat push_status last 7d ===');
  console.log(JSON.stringify(byStatus.rows, null, 2));

  const msgs = await c.query(`
    SELECT m.id, m.conversation_id, m.sender_id, m.message_type,
           left(coalesce(m.content,''),60) AS content,
           m.created_at, p.email AS sender_email, p.first_name
    FROM messages m
    LEFT JOIN member_profiles p ON p.id = m.sender_id
    ORDER BY m.created_at DESC
    LIMIT 10
  `);
  console.log('=== recent messages ===');
  console.log(JSON.stringify(msgs.rows, null, 2));

  if (msgs.rows[0]) {
    const cid = msgs.rows[0].conversation_id;
    const sid = msgs.rows[0].sender_id;
    const parts = await c.query(
      `
      SELECT cp.user_id, cp.is_active, cp.is_muted, cp.role_in_chat, p.email, p.first_name
      FROM conversation_participants cp
      LEFT JOIN member_profiles p ON p.id = cp.user_id
      WHERE cp.conversation_id = $1
    `,
      [cid],
    );
    console.log('=== participants for latest message conversation ===');
    console.log(
      JSON.stringify({ conversationId: cid, senderId: sid, participants: parts.rows }, null, 2),
    );

    // Expected recipients = active participants except sender
    const expected = parts.rows.filter((p) => p.is_active && p.user_id !== sid);
    console.log('=== expected push recipients ===');
    console.log(JSON.stringify(expected, null, 2));

    for (const r of expected) {
      const tokens = await c.query(
        `
        SELECT id, platform, is_active, left(fcm_token,24) AS token_prefix,
               updated_at, created_at, last_seen_at
        FROM device_tokens
        WHERE user_id = $1
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 8
      `,
        [r.user_id],
      );
      const prefs = await c.query(
        `SELECT trips, events, club, registrations, ratings, chat
         FROM notification_preferences WHERE user_id = $1`,
        [r.user_id],
      );
      console.log(`--- recipient ${r.email || r.user_id} ---`);
      console.log('tokens:', JSON.stringify(tokens.rows, null, 2));
      console.log('prefs:', JSON.stringify(prefs.rows[0] || null, null, 2));
    }

    // Match notifications for this latest message
    const mid = msgs.rows[0].id;
    const linked = await c.query(
      `
      SELECT id, user_id, push_status, created_at, title, body
      FROM notifications
      WHERE type = 'chat' AND data->>'messageId' = $1
      ORDER BY created_at DESC
    `,
      [mid],
    );
    console.log('=== notifications for latest messageId ===');
    console.log(JSON.stringify(linked.rows, null, 2));
  }

  // Firebase readiness (same as app)
  try {
    const { isFirebaseReady, getFirebaseInitError } = require('../src/config/firebase');
    console.log('=== firebase ===');
    console.log({
      ready: isFirebaseReady(),
      error: getFirebaseInitError?.() || null,
    });
  } catch (err) {
    console.log('firebase check failed:', err.message);
  }

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
