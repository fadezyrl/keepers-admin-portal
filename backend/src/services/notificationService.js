const { query } = require('../config/db');

async function createNotification({
  userId,
  type,
  title,
  body,
  data = {},
  announcementId = null,
  client = null,
}) {
  const q = client ? client.query.bind(client) : query;
  const result = await q(
    `INSERT INTO notifications (user_id, type, title, body, data, announcement_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING *`,
    [userId, type, title, body, JSON.stringify(data), announcementId],
  );
  return result.rows[0];
}

async function notifyMany(userIds, payload, client = null) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const rows = [];
  for (const userId of unique) {
    rows.push(await createNotification({ ...payload, userId, client }));
  }
  return rows;
}

module.exports = { createNotification, notifyMany };
