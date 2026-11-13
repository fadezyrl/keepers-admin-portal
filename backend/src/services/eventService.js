const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const { presets: cachePresets } = require('./cacheInvalidationService');
const { hasPermission } = require('../middleware/auth');

function mapEvent(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    date: row.event_date,
    location: row.location || '',
    image: row.image_url || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listEvents({ status, includeUnpublished = false, page = 1, limit = 50 } = {}) {
  const where = ['deleted_at IS NULL'];
  const params = [];

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  } else if (!includeUnpublished) {
    where.push(`status = 'scheduled'`);
  }

  params.push(limit, (page - 1) * limit);
  const res = await query(
    `SELECT * FROM events
     WHERE ${where.join(' AND ')}
     ORDER BY event_date ASC, created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return res.rows.map(mapEvent);
}

async function getEvent(id) {
  const res = await query(
    `SELECT * FROM events WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!res.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Event not found');
  return mapEvent(res.rows[0]);
}

async function upsertEvent(payload, actor, req) {
  if (!hasPermission(actor, 'events.manage') && !hasPermission(actor, 'announcements.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage events');
  }
  if (!payload.title || !payload.date) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Title and date are required');
  }

  const status = payload.status || 'draft';
  const allowed = ['draft', 'scheduled', 'cancelled', 'completed'];
  if (!allowed.includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'Invalid event status');
  }

  if (payload.id) {
    const updated = await query(
      `UPDATE events SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         event_date = COALESCE($3, event_date),
         location = COALESCE($4, location),
         image_url = COALESCE($5, image_url),
         status = COALESCE($6, status)
       WHERE id = $7 AND deleted_at IS NULL
       RETURNING *`,
      [
        payload.title ?? null,
        payload.description ?? null,
        payload.date ?? null,
        payload.location ?? null,
        payload.image ?? payload.imageUrl ?? null,
        status,
        payload.id,
      ],
    );
    if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Event not found');
    await writeAudit({
      actorId: actor.id,
      action: 'events.update',
      entityType: 'events',
      entityId: payload.id,
      req,
    });
    cachePresets.events('events.update');
    return mapEvent(updated.rows[0]);
  }

  const inserted = await query(
    `INSERT INTO events (title, description, event_date, location, image_url, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      payload.title,
      payload.description || null,
      payload.date,
      payload.location || null,
      payload.image || payload.imageUrl || null,
      status,
      actor.id,
    ],
  );
  await writeAudit({
    actorId: actor.id,
    action: 'events.create',
    entityType: 'events',
    entityId: inserted.rows[0].id,
    req,
  });
  cachePresets.events('events.create');
  return mapEvent(inserted.rows[0]);
}

async function setEventStatus(id, status, actor, req) {
  if (!hasPermission(actor, 'events.manage') && !hasPermission(actor, 'announcements.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage events');
  }
  const allowed = ['draft', 'scheduled', 'cancelled', 'completed'];
  if (!allowed.includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'Invalid event status');
  }
  const updated = await query(
    `UPDATE events SET status = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
    [status, id],
  );
  if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Event not found');
  await writeAudit({
    actorId: actor.id,
    action: `events.status.${status}`,
    entityType: 'events',
    entityId: id,
    req,
  });
  cachePresets.events(`events.status.${status}`);
  return mapEvent(updated.rows[0]);
}

async function deleteEvent(id, actor, req) {
  if (!hasPermission(actor, 'events.manage') && !hasPermission(actor, 'announcements.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage events');
  }
  const updated = await query(
    `UPDATE events SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id],
  );
  if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Event not found');
  await writeAudit({
    actorId: actor.id,
    action: 'events.delete',
    entityType: 'events',
    entityId: id,
    req,
  });
  cachePresets.events('events.delete');
  return { id, deleted: true };
}

module.exports = {
  listEvents,
  getEvent,
  upsertEvent,
  setEventStatus,
  deleteEvent,
};
