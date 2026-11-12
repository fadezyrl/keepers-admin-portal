const { query } = require('../config/db');

async function writeAudit({
  actorId,
  action,
  entityType,
  entityId = null,
  metadata = {},
  req = null,
}) {
  await query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [
      actorId || null,
      action,
      entityType,
      entityId,
      JSON.stringify(metadata || {}),
      req?.ip || null,
      req?.headers?.['user-agent'] || null,
    ],
  );
}

module.exports = { writeAudit };
