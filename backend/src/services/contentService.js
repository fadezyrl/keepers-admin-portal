const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const { notifyMany } = require('./notificationService');
const { presets: cachePresets } = require('./cacheInvalidationService');
const { hasPermission } = require('../middleware/auth');
const { getAdminClient } = require('../config/supabase');

async function listSponsors({ activeOnly = false } = {}) {
  const res = await query(
    `SELECT * FROM sponsors
     WHERE deleted_at IS NULL AND ($1::boolean = FALSE OR is_active = TRUE)
     ORDER BY display_order, name`,
    [activeOnly],
  );
  return res.rows.map((s) => ({
    id: s.id,
    name: s.name,
    logo: s.logo_url,
    url: s.website_url,
    displayOrder: s.display_order,
    isActive: s.is_active,
  }));
}

async function upsertSponsor(payload, actor, req) {
  if (!hasPermission(actor, 'sponsors.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage sponsors');
  }

  if (payload.id) {
    const updated = await query(
      `UPDATE sponsors SET
         name = COALESCE($1, name),
         logo_url = COALESCE($2, logo_url),
         website_url = COALESCE($3, website_url),
         display_order = COALESCE($4, display_order),
         is_active = COALESCE($5, is_active),
         updated_by = $6
       WHERE id = $7 AND deleted_at IS NULL
       RETURNING *`,
      [
        payload.name ?? null,
        payload.logo ?? null,
        payload.url ?? null,
        payload.displayOrder ?? null,
        payload.isActive ?? null,
        actor.id,
        payload.id,
      ],
    );
    if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Sponsor not found');
    cachePresets.sponsors('sponsor.update');
    return updated.rows[0];
  }

  const inserted = await query(
    `INSERT INTO sponsors (name, logo_url, website_url, display_order, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,TRUE),$6,$6) RETURNING *`,
    [
      payload.name,
      payload.logo || null,
      payload.url || null,
      payload.displayOrder,
      payload.isActive,
      actor.id,
    ],
  );

  await writeAudit({
    actorId: actor.id,
    action: 'sponsor.create',
    entityType: 'sponsors',
    entityId: inserted.rows[0].id,
    req,
  });
  cachePresets.sponsors('sponsor.create');
  return inserted.rows[0];
}

async function reorderSponsors(orderedIds, actor, req) {
  if (!hasPermission(actor, 'sponsors.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage sponsors');
  }
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'orderedIds required');
  }
  for (let i = 0; i < orderedIds.length; i += 1) {
    await query(
      `UPDATE sponsors SET display_order = $1, updated_by = $2 WHERE id = $3 AND deleted_at IS NULL`,
      [i, actor.id, orderedIds[i]],
    );
  }
  await writeAudit({
    actorId: actor.id,
    action: 'sponsors.reorder',
    entityType: 'sponsors',
    entityId: null,
    metadata: { count: orderedIds.length },
    req,
  });
  cachePresets.sponsors('sponsors.reorder');
  return listSponsors({ activeOnly: false });
}

async function deleteSponsor(id, actor, req) {
  if (!hasPermission(actor, 'sponsors.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage sponsors');
  }
  await query(`UPDATE sponsors SET deleted_at = NOW(), updated_by = $1 WHERE id = $2`, [
    actor.id,
    id,
  ]);
  await writeAudit({
    actorId: actor.id,
    action: 'sponsor.delete',
    entityType: 'sponsors',
    entityId: id,
    req,
  });
  cachePresets.sponsors('sponsor.delete');
  return { id, deleted: true };
}

async function listHeroSlides({ activeOnly = true } = {}) {
  const res = await query(
    `SELECT * FROM hero_slides
     WHERE ($1::boolean = FALSE OR is_active = TRUE)
     ORDER BY display_order, created_at`,
    [activeOnly],
  );
  return res.rows.map((s) => ({
    id: s.id,
    title: s.title,
    subtitle: s.subtitle,
    image: s.image_url,
    tripId: s.trip_id,
    displayOrder: s.display_order,
    isActive: s.is_active,
    updatedAt: s.updated_at,
  }));
}

async function upsertHeroSlide(payload, actor, req) {
  if (!hasPermission(actor, 'media.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage carousel');
  }
  if (!payload.image && !payload.imageUrl) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Image URL is required');
  }
  const imageUrl = payload.image || payload.imageUrl;
  if (payload.id) {
    const updated = await query(
      `UPDATE hero_slides SET
        title = COALESCE($1, title),
        subtitle = COALESCE($2, subtitle),
        image_url = COALESCE($3, image_url),
        trip_id = COALESCE($4, trip_id),
        display_order = COALESCE($5, display_order),
        is_active = COALESCE($6, is_active)
       WHERE id = $7
       RETURNING *`,
      [
        payload.title ?? null,
        payload.subtitle ?? null,
        imageUrl ?? null,
        payload.tripId || null,
        payload.displayOrder ?? null,
        payload.isActive ?? null,
        payload.id,
      ],
    );
    if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Slide not found');
    await writeAudit({
      actorId: actor.id,
      action: 'hero_slides.update',
      entityType: 'hero_slides',
      entityId: payload.id,
      req,
    });
    cachePresets.carousel('hero_slides.update');
    return updated.rows[0];
  }

  const inserted = await query(
    `INSERT INTO hero_slides (title, subtitle, image_url, trip_id, display_order, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), $7)
     RETURNING *`,
    [
      payload.title || null,
      payload.subtitle || null,
      imageUrl,
      payload.tripId || null,
      payload.displayOrder || 0,
      payload.isActive,
      actor.id,
    ],
  );
  await writeAudit({
    actorId: actor.id,
    action: 'hero_slides.create',
    entityType: 'hero_slides',
    entityId: inserted.rows[0].id,
    req,
  });
  cachePresets.carousel('hero_slides.create');
  return inserted.rows[0];
}

async function deleteHeroSlide(id, actor, req) {
  if (!hasPermission(actor, 'media.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage carousel');
  }
  const updated = await query(
    `UPDATE hero_slides SET is_active = FALSE WHERE id = $1 RETURNING id`,
    [id],
  );
  if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Slide not found');
  await writeAudit({
    actorId: actor.id,
    action: 'hero_slides.deactivate',
    entityType: 'hero_slides',
    entityId: id,
    req,
  });
  cachePresets.carousel('hero_slides.deactivate');
  return { id, deleted: true };
}

async function listGallery({ activeOnly = true } = {}) {
  const res = await query(
    `SELECT * FROM gallery_items
     WHERE deleted_at IS NULL AND ($1::boolean = FALSE OR is_active = TRUE)
     ORDER BY display_order, created_at DESC`,
    [activeOnly],
  );
  return res.rows.map((g) => ({
    id: g.id,
    image: g.image_url,
    caption: g.caption,
    tripId: g.trip_id,
    displayOrder: g.display_order,
    isActive: g.is_active,
    createdAt: g.created_at,
  }));
}

async function upsertGalleryItem(payload, actor, req) {
  if (!hasPermission(actor, 'media.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage gallery');
  }
  if (!payload.image && !payload.imageUrl) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Image URL is required');
  }
  const imageUrl = payload.image || payload.imageUrl;
  if (payload.id) {
    const updated = await query(
      `UPDATE gallery_items SET
        image_url = COALESCE($1, image_url),
        caption = COALESCE($2, caption),
        trip_id = COALESCE($3, trip_id),
        display_order = COALESCE($4, display_order),
        is_active = COALESCE($5, is_active)
       WHERE id = $6 AND deleted_at IS NULL
       RETURNING *`,
      [
        imageUrl ?? null,
        payload.caption ?? null,
        payload.tripId || null,
        payload.displayOrder ?? null,
        payload.isActive ?? null,
        payload.id,
      ],
    );
    if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Gallery item not found');
    await writeAudit({
      actorId: actor.id,
      action: 'gallery_items.update',
      entityType: 'gallery_items',
      entityId: payload.id,
      req,
    });
    cachePresets.gallery('gallery_items.update');
    return updated.rows[0];
  }

  const inserted = await query(
    `INSERT INTO gallery_items (image_url, caption, trip_id, display_order, is_active, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), $6)
     RETURNING *`,
    [
      imageUrl,
      payload.caption || null,
      payload.tripId || null,
      payload.displayOrder || 0,
      payload.isActive,
      actor.id,
    ],
  );
  await writeAudit({
    actorId: actor.id,
    action: 'gallery_items.create',
    entityType: 'gallery_items',
    entityId: inserted.rows[0].id,
    req,
  });
  cachePresets.gallery('gallery_items.create');
  return inserted.rows[0];
}

async function deleteGalleryItem(id, actor, req) {
  if (!hasPermission(actor, 'media.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage gallery');
  }
  const updated = await query(
    `UPDATE gallery_items SET deleted_at = NOW(), is_active = FALSE WHERE id = $1 RETURNING id`,
    [id],
  );
  if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Gallery item not found');
  await writeAudit({
    actorId: actor.id,
    action: 'gallery_items.delete',
    entityType: 'gallery_items',
    entityId: id,
    req,
  });
  cachePresets.gallery('gallery_items.delete');
  return { id, deleted: true };
}

async function listDocuments() {
  const res = await query(
    `SELECT id, slug, title, content, document_type, file_url, version, is_published, updated_at
     FROM documents WHERE is_published = TRUE ORDER BY title`,
  );
  return res.rows;
}

async function getDocumentBySlug(slug) {
  const res = await query(`SELECT * FROM documents WHERE slug = $1`, [slug]);
  if (!res.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Document not found');
  return res.rows[0];
}

async function updateDocument(slug, payload, actor, req) {
  if (!hasPermission(actor, 'documents.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage documents');
  }
  const updated = await query(
    `UPDATE documents SET
       title = COALESCE($1, title),
       content = COALESCE($2, content),
       file_url = COALESCE($3, file_url),
       version = COALESCE($4, version),
       is_published = COALESCE($5, is_published),
       updated_by = $6
     WHERE slug = $7 RETURNING *`,
    [
      payload.title ?? null,
      payload.content ?? null,
      payload.fileUrl ?? null,
      payload.version ?? null,
      payload.isPublished ?? null,
      actor.id,
      slug,
    ],
  );
  if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Document not found');
  await writeAudit({
    actorId: actor.id,
    action: 'document.update',
    entityType: 'documents',
    entityId: updated.rows[0].id,
    req,
  });
  cachePresets.documents('document.update');
  return updated.rows[0];
}

async function listAnnouncements({ status } = {}) {
  const params = [];
  let where = 'deleted_at IS NULL';
  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }
  const res = await query(
    `SELECT * FROM announcements WHERE ${where} ORDER BY COALESCE(published_at, created_at) DESC`,
    params,
  );
  return res.rows;
}

async function createAnnouncement(payload, actor, req) {
  if (!hasPermission(actor, 'announcements.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage announcements');
  }

  const status = payload.publish ? 'published' : payload.status || 'draft';
  const inserted = await query(
    `INSERT INTO announcements (
       title, body, target_audience, target_membership_level_id, target_role_id,
       status, published_at, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $6='published' THEN NOW() ELSE NULL END, $7, $7)
     RETURNING *`,
    [
      payload.title,
      payload.body,
      payload.targetAudience || 'all',
      payload.targetMembershipLevelId || null,
      payload.targetRoleId || null,
      status,
      actor.id,
    ],
  );

  const announcement = inserted.rows[0];

  if (status === 'published') {
    await fanOutAnnouncement(announcement);
  }

  await writeAudit({
    actorId: actor.id,
    action: 'announcement.create',
    entityType: 'announcements',
    entityId: announcement.id,
    metadata: { status },
    req,
  });

  cachePresets.announcements('announcement.create');
  return announcement;
}

async function publishAnnouncement(id, actor, req) {
  if (!hasPermission(actor, 'announcements.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage announcements');
  }

  const updated = await query(
    `UPDATE announcements SET status = 'published', published_at = COALESCE(published_at, NOW()), updated_by = $1
     WHERE id = $2 AND deleted_at IS NULL RETURNING *`,
    [actor.id, id],
  );
  if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Announcement not found');

  await fanOutAnnouncement(updated.rows[0]);
  await writeAudit({
    actorId: actor.id,
    action: 'announcement.publish',
    entityType: 'announcements',
    entityId: id,
    req,
  });
  cachePresets.announcements('announcement.publish');
  return updated.rows[0];
}

async function fanOutAnnouncement(announcement) {
  let userQuery = `SELECT id FROM member_profiles WHERE status = 'approved' AND deleted_at IS NULL`;
  const params = [];

  if (announcement.target_audience === 'membership_level' && announcement.target_membership_level_id) {
    params.push(announcement.target_membership_level_id);
    userQuery += ` AND membership_level_id = $${params.length}`;
  } else if (announcement.target_audience === 'role' && announcement.target_role_id) {
    params.push(announcement.target_role_id);
    userQuery = `
      SELECT mp.id FROM member_profiles mp
      JOIN user_roles ur ON ur.user_id = mp.id
      WHERE mp.status = 'approved' AND mp.deleted_at IS NULL AND ur.role_id = $1`;
  } else if (announcement.target_audience === 'marshalls') {
    userQuery = `
      SELECT DISTINCT mp.id FROM member_profiles mp
      JOIN user_roles ur ON ur.user_id = mp.id
      JOIN roles r ON r.id = ur.role_id
      WHERE mp.status = 'approved' AND mp.deleted_at IS NULL
        AND r.code IN ('marshall', 'pre_marshall')`;
  } else if (announcement.target_audience === 'admins') {
    userQuery = `
      SELECT DISTINCT mp.id FROM member_profiles mp
      JOIN user_roles ur ON ur.user_id = mp.id
      JOIN roles r ON r.id = ur.role_id
      WHERE mp.status = 'approved' AND mp.deleted_at IS NULL
        AND r.code IN ('admin', 'super_admin')`;
  }

  const users = await query(userQuery, params);
  await notifyMany(
    users.rows.map((u) => u.id),
    {
      type: 'announcement',
      title: announcement.title,
      body: announcement.body,
      data: { announcementId: announcement.id },
      announcementId: announcement.id,
    },
  );
}

async function listNotifications(userId, { unreadOnly = false } = {}) {
  const res = await query(
    `SELECT * FROM notifications
     WHERE user_id = $1 AND ($2::boolean = FALSE OR read_at IS NULL)
     ORDER BY created_at DESC
     LIMIT 100`,
    [userId, unreadOnly],
  );
  return res.rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    timestamp: n.created_at,
    read: Boolean(n.read_at),
    data: n.data,
  }));
}

async function markNotificationRead(userId, notificationId) {
  await query(
    `UPDATE notifications SET read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notificationId, userId],
  );
  return { id: notificationId, read: true };
}

async function markAllNotificationsRead(userId) {
  await query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return { success: true };
}

async function uploadFile({ bucket, path, buffer, contentType, upsert = true }) {
  const admin = getAdminClient();
  if (!admin) throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'Supabase Storage is not configured');

  const { data, error } = await admin.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert,
  });
  if (error) throw new AppError(400, 'UPLOAD_FAILED', error.message);

  const { data: pub } = admin.storage.from(bucket).getPublicUrl(data.path);
  return {
    path: data.path,
    publicUrl: pub.publicUrl,
    bucket,
  };
}

async function getHomeFeed(userId) {
  const [heroes, trips, sponsors, gallery] = await Promise.all([
    listHeroSlides(),
    query(
      `SELECT t.*, ml.code AS required_membership_code, ml.name AS required_membership_name
       FROM trips t
       LEFT JOIN membership_levels ml ON ml.id = t.required_membership_level_id
       WHERE t.status = 'published' AND t.deleted_at IS NULL AND t.trip_date >= CURRENT_DATE
       ORDER BY t.trip_date ASC LIMIT 6`,
    ),
    listSponsors({ activeOnly: true }),
    listGallery(),
  ]);

  const { mapTrip } = require('./tripService');
  const upcoming = [];
  for (const row of trips.rows) {
    upcoming.push(await mapTrip(row, { userId }));
  }

  return {
    heroSlides: heroes,
    upcomingTrips: upcoming,
    sponsors,
    gallery,
  };
}

/**
 * Lightweight module-level change markers for client stale-while-revalidate.
 * Returns ISO timestamps (or null) so the app can refresh only changed modules.
 */
async function getContentVersions(userId) {
  const res = await query(
    `
    SELECT
      (SELECT MAX(updated_at)::text FROM hero_slides) AS hero_slides,
      (SELECT MAX(updated_at)::text FROM sponsors WHERE deleted_at IS NULL) AS sponsors,
      (SELECT MAX(COALESCE(deleted_at, created_at))::text FROM gallery_items) AS gallery,
      (SELECT MAX(updated_at)::text FROM trips WHERE deleted_at IS NULL) AS trips,
      (SELECT MAX(updated_at)::text FROM trip_registrations) AS registrations,
      (SELECT MAX(updated_at)::text FROM trip_attendance) AS attendance,
      (SELECT MAX(updated_at)::text FROM documents) AS documents,
      (SELECT MAX(updated_at)::text FROM announcements WHERE deleted_at IS NULL) AS announcements,
      (SELECT MAX(updated_at)::text FROM events WHERE deleted_at IS NULL) AS events,
      (SELECT MAX(updated_at)::text FROM membership_levels) AS membership_levels,
      (SELECT MAX(updated_at)::text FROM member_profiles) AS members,
      (SELECT MAX(updated_at)::text FROM vehicles) AS vehicles,
      (SELECT MAX(GREATEST(created_at, COALESCE(read_at, created_at)))::text
         FROM notifications WHERE user_id = $1) AS notifications,
      (SELECT MAX(updated_at)::text FROM membership_upgrade_requests) AS upgrades,
      (SELECT MAX(updated_at)::text FROM rating_criteria) AS rating_criteria,
      (SELECT MAX(updated_at)::text FROM trip_ratings) AS ratings,
      (SELECT MAX(created_at)::text FROM trip_media WHERE deleted_at IS NULL) AS trip_media
    `,
    [userId],
  );

  const row = res.rows[0] || {};
  return {
    heroSlides: row.hero_slides || null,
    sponsors: row.sponsors || null,
    gallery: row.gallery || null,
    trips: row.trips || null,
    registrations: row.registrations || null,
    attendance: row.attendance || null,
    documents: row.documents || null,
    announcements: row.announcements || null,
    events: row.events || null,
    membershipLevels: row.membership_levels || null,
    members: row.members || null,
    vehicles: row.vehicles || null,
    notifications: row.notifications || null,
    upgrades: row.upgrades || null,
    ratingCriteria: row.rating_criteria || null,
    ratings: row.ratings || null,
    tripMedia: row.trip_media || null,
    checkedAt: new Date().toISOString(),
  };
}

async function listSettings() {
  const res = await query(`SELECT key, value, description, updated_at FROM app_settings ORDER BY key`);
  return res.rows;
}

async function updateSetting(key, value, actor, req) {
  if (!hasPermission(actor, 'settings.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage settings');
  }
  const updated = await query(
    `UPDATE app_settings SET value = $1::jsonb, updated_by = $2 WHERE key = $3 RETURNING *`,
    [JSON.stringify(value), actor.id, key],
  );
  if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Setting not found');
  cachePresets.settings('settings.update');
  await writeAudit({
    actorId: actor.id,
    action: 'settings.update',
    entityType: 'app_settings',
    entityId: updated.rows[0].id,
    metadata: { key },
    req,
  });
  return updated.rows[0];
}

module.exports = {
  listSponsors,
  upsertSponsor,
  reorderSponsors,
  deleteSponsor,
  listHeroSlides,
  upsertHeroSlide,
  deleteHeroSlide,
  listGallery,
  upsertGalleryItem,
  deleteGalleryItem,
  listDocuments,
  getDocumentBySlug,
  updateDocument,
  listAnnouncements,
  createAnnouncement,
  publishAnnouncement,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  uploadFile,
  getHomeFeed,
  getContentVersions,
  listSettings,
  updateSetting,
};
