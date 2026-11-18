const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const {
  createNotification,
  notifyMany,
  listEligibleMemberIdsForTrip,
  listTripParticipantIds,
} = require('./notificationService');
const { presets: cachePresets } = require('./cacheInvalidationService');
const { hasPermission } = require('../middleware/auth');
const { getAdminClient } = require('../config/supabase');
const { toDateOnly } = require('../utils/dateOnly');
const {
  listActiveRequirements,
  normalizeSelectedIds,
  saveRegistrationChecklist,
  loadChecklistsByRegistrationIds,
} = require('./vehicleReadinessService');
const chatService = require('./chatService');
const {
  TRIP_CATEGORIES,
  assertTripCategory,
  inferCategoryFromLegacy,
} = require('../constants/tripCategories');

async function syncChatAfterRegistrationChange(tripId, userId, status) {
  try {
    if (status === 'registered') {
      await chatService.activateUserOnTripChats(tripId, userId, 'member');
      return;
    }
    if (['rejected', 'cancelled'].includes(status)) {
      await chatService.revokeUserFromTripChats(tripId, userId);
      return;
    }
    await chatService.ensureGroupConversation(tripId);
  } catch (err) {
    console.warn(
      '[chat] lifecycle sync failed',
      tripId,
      userId,
      status,
      err instanceof Error ? err.message : err,
    );
  }
}

const MEMBERSHIP_RANK = { junior: 0, intermediate: 1, advanced: 2 };

function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) || /\/video\//i.test(url);
}

function canManageAllTrips(actor) {
  return hasPermission(actor, 'trips.manage');
}

function canManageOwnTrip(trip, actor) {
  return (
    Boolean(actor?.id) &&
    hasPermission(actor, 'trips.manage_own') &&
    trip?.organizer_id === actor.id
  );
}

function assertCanManageTripMedia(trip, actor) {
  if (canManageAllTrips(actor) || canManageOwnTrip(trip, actor)) return;
  throw new AppError(403, 'FORBIDDEN', 'Cannot manage media for this trip');
}

function assertCanReviewTripRegistrations(trip, actor) {
  if (
    hasPermission(actor, 'registrations.manage') ||
    canManageAllTrips(actor) ||
    canManageOwnTrip(trip, actor)
  ) {
    return;
  }
  throw new AppError(403, 'FORBIDDEN', 'Not authorized for this trip');
}

function canViewManagedParticipants(row, actor, userId) {
  if (actor) {
    return (
      hasPermission(actor, 'trips.manage') ||
      hasPermission(actor, 'registrations.manage') ||
      canManageOwnTrip(row, actor) ||
      row.organizer_id === actor.id
    );
  }
  return Boolean(userId && row.organizer_id === userId);
}

async function mapTrip(row, { userId = null, actor = null } = {}) {
  const media = await query(
    `SELECT id, media_type, public_url, thumbnail_url, caption, display_order
     FROM trip_media WHERE trip_id = $1 AND deleted_at IS NULL ORDER BY display_order, created_at`,
    [row.id],
  );

  const counts = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'registered')::int AS registered_count,
       COUNT(*) FILTER (WHERE status = 'waitlist')::int AS waitlist_count,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
     FROM trip_registrations WHERE trip_id = $1`,
    [row.id],
  );

  let myRegistration = null;
  if (userId) {
    const reg = await query(
      `SELECT id, status, registered_at FROM trip_registrations WHERE trip_id = $1 AND user_id = $2`,
      [row.id, userId],
    );
    myRegistration = reg.rows[0] || null;
  }

  const showManagedParticipants = canViewManagedParticipants(row, actor, userId);
  const participantStatuses = showManagedParticipants
    ? ['pending', 'registered', 'waitlist', 'rejected']
    : ['registered', 'waitlist'];

  const participants = await query(
    `SELECT mp.id, mp.first_name, mp.last_name, mp.avatar_url,
            tr.id AS registration_id,
            tr.status AS registration_status,
            tr.registered_at,
            (SELECT manufacturer || ' ' || model FROM vehicles v
             WHERE v.user_id = mp.id AND v.deleted_at IS NULL
             ORDER BY is_primary DESC LIMIT 1) AS vehicle
     FROM trip_registrations tr
     JOIN member_profiles mp ON mp.id = tr.user_id
     WHERE tr.trip_id = $1 AND tr.status = ANY($2::text[])
     ORDER BY
       CASE tr.status
         WHEN 'pending' THEN 0
         WHEN 'registered' THEN 1
         WHEN 'waitlist' THEN 2
         WHEN 'rejected' THEN 3
         ELSE 4
       END,
       tr.registered_at ASC NULLS LAST`,
    [row.id, participantStatuses],
  );

  let readinessByReg = new Map();
  if (showManagedParticipants && participants.rows.length) {
    readinessByReg = await loadChecklistsByRegistrationIds(
      participants.rows.map((p) => p.registration_id),
    );
  }

  let organizer = null;
  if (row.organizer_id) {
    const org = await query(
      `SELECT mp.id, mp.first_name, mp.last_name, mp.avatar_url, mp.phone,
              COALESCE(
                (SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = mp.id AND r.code IN ('marshall','admin','super_admin','pre_marshall')
                 ORDER BY CASE r.code WHEN 'super_admin' THEN 1 WHEN 'admin' THEN 2 WHEN 'marshall' THEN 3 ELSE 4 END
                 LIMIT 1),
                'Organizer'
              ) AS role
       FROM member_profiles mp WHERE mp.id = $1`,
      [row.organizer_id],
    );
    if (org.rows[0]) {
      organizer = {
        id: org.rows[0].id,
        name: `${org.rows[0].first_name} ${org.rows[0].last_name}`.trim(),
        role: org.rows[0].role,
        avatar: org.rows[0].avatar_url,
        phone: org.rows[0].phone,
      };
    }
  }

  const registeredCount = counts.rows[0].registered_count;
  let clientStatus = row.status;
  if (myRegistration?.status === 'registered') clientStatus = 'registered';
  else if (myRegistration?.status === 'pending') clientStatus = 'pending';
  else if (myRegistration?.status === 'waitlist') clientStatus = 'waitlist';
  else if (row.status === 'published' && registeredCount >= row.max_participants) clientStatus = 'full';
  else if (row.status === 'published') clientStatus = 'upcoming';
  else if (row.status === 'completed') clientStatus = 'completed';

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    destination: row.destination,
    meetingPoint: row.meeting_point,
    date: toDateOnly(row.trip_date),
    time: row.trip_time,
    difficulty: row.difficulty,
    category:
      row.category ||
      inferCategoryFromLegacy({
        tripType: row.trip_type,
        title: row.title,
        destination: row.destination,
      }),
    tripType: row.trip_type || row.category || null,
    requiredMembership: row.required_membership_name || row.required_membership_code,
    requiredMembershipCode: row.required_membership_code,
    minTripsRequired: row.min_trips_required,
    coverImage: row.cover_image_url,
    gallery: media.rows.filter((m) => m.media_type === 'image').map((m) => m.public_url),
    media: media.rows,
    maxParticipants: row.max_participants,
    registeredCount,
    waitlistCount: counts.rows[0].waitlist_count,
    pendingCount: counts.rows[0].pending_count,
    vehicleRequirements: row.vehicle_requirements,
    instructions: row.instructions,
    routeSummary: row.route_summary,
    location: {
      label: row.location_label || row.destination,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    organizer,
    organizerId: row.organizer_id,
    createdBy: row.created_by || null,
    participants: participants.rows.map((p) => {
      const readinessChecklist = showManagedParticipants
        ? readinessByReg.get(p.registration_id) || []
        : undefined;
      return {
        id: p.id,
        name: `${p.first_name} ${p.last_name}`.trim(),
        avatar: p.avatar_url,
        vehicle: p.vehicle,
        registrationId: p.registration_id,
        registrationStatus: p.registration_status,
        registeredAt: p.registered_at,
        ...(readinessChecklist ? { readinessChecklist } : {}),
      };
    }),
    status: clientStatus,
    publishStatus: row.status,
    myRegistration,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function extractStorageRef(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null;
  const trimmed = urlOrPath.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('://') && !trimmed.startsWith('/')) {
    return { bucket: 'trips', path: trimmed };
  }
  const match = trimmed.match(/\/object\/public\/([^/]+)\/(.+?)(?:\?|$)/);
  if (match) {
    return { bucket: match[1], path: decodeURIComponent(match[2]) };
  }
  return null;
}

async function removeTripStorageFiles(refs) {
  const admin = getAdminClient();
  if (!admin || !refs.length) {
    return { removed: 0, failed: refs.length ? refs : [] };
  }

  const byBucket = new Map();
  for (const ref of refs) {
    if (!ref?.bucket || !ref?.path) continue;
    // Only trip-owned media buckets — never touch avatars/vehicles/documents
    if (!['trips', 'gallery'].includes(ref.bucket)) continue;
    if (!byBucket.has(ref.bucket)) byBucket.set(ref.bucket, new Set());
    byBucket.get(ref.bucket).add(ref.path);
  }

  let removed = 0;
  const failed = [];
  for (const [bucket, paths] of byBucket.entries()) {
    const list = [...paths];
    try {
      const { error } = await admin.storage.from(bucket).remove(list);
      if (error) {
        failed.push(...list.map((path) => ({ bucket, path, error: error.message })));
      } else {
        removed += list.length;
      }
    } catch (err) {
      failed.push(
        ...list.map((path) => ({
          bucket,
          path,
          error: err instanceof Error ? err.message : 'storage_remove_failed',
        })),
      );
    }
  }
  return { removed, failed };
}

async function getTripRow(id) {
  const res = await query(
    `SELECT t.*,
            ml.code AS required_membership_code,
            ml.name AS required_membership_name,
            ml.rank AS required_membership_rank
     FROM trips t
     LEFT JOIN membership_levels ml ON ml.id = t.required_membership_level_id
     WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [id],
  );
  return res.rows[0] || null;
}

async function listTrips({
  filter = 'all',
  q,
  status,
  category,
  from,
  to,
  userId,
  includeDrafts = false,
  page = 1,
  limit = 50,
}) {
  const where = ['t.deleted_at IS NULL'];
  const params = [];

  if (!includeDrafts) {
    where.push(`t.status IN ('published', 'completed', 'cancelled')`);
  } else if (status) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(t.title ILIKE $${params.length} OR t.destination ILIKE $${params.length} OR t.description ILIKE $${params.length})`,
    );
  }
  if (category) {
    try {
      assertTripCategory(category, { required: true });
    } catch (err) {
      throw new AppError(400, err.code || 'VALIDATION_ERROR', err.message);
    }
    params.push(category);
    where.push(`t.category = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`t.trip_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`t.trip_date <= $${params.length}`);
  }

  if (filter === 'joined' && userId) {
    params.push(userId);
    where.push(
      `EXISTS (SELECT 1 FROM trip_registrations tr WHERE tr.trip_id = t.id AND tr.user_id = $${params.length} AND tr.status IN ('registered','waitlist'))`,
    );
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  params.push(limit, (page - 1) * limit);

  const result = await query(
    `SELECT t.*,
            ml.code AS required_membership_code,
            ml.name AS required_membership_name,
            ml.rank AS required_membership_rank
     FROM trips t
     LEFT JOIN membership_levels ml ON ml.id = t.required_membership_level_id
     ${whereSql}
     ORDER BY t.trip_date ASC, t.trip_time ASC NULLS LAST
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const items = [];
  for (const row of result.rows) {
    items.push(await mapTrip(row, { userId }));
  }
  return { items, pagination: { page, limit } };
}

async function getTrip(id, userId, actor = null) {
  const row = await getTripRow(id);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Trip not found');
  return mapTrip(row, { userId, actor });
}

function normalizeTripTime(time) {
  if (!time) return null;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return `${time}:00`;
  if (/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) return time;
  throw new AppError(400, 'VALIDATION_ERROR', 'Time must be HH:MM (24-hour)');
}

async function createTrip(payload, actor, req) {
  if (!hasPermission(actor, 'trips.create') && !hasPermission(actor, 'trips.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot create trips');
  }

  let requiredLevelId = null;
  if (payload.requiredMembership || payload.requiredMembershipCode) {
    const code = (payload.requiredMembershipCode || payload.requiredMembership || 'junior')
      .toLowerCase();
    const level = await query(`SELECT id FROM membership_levels WHERE code = $1`, [code]);
    requiredLevelId = level.rows[0]?.id || null;
  }

  const status = payload.publish ? 'published' : payload.status || 'draft';
  const organizerId = payload.organizerId || actor.id;
  const tripTime = normalizeTripTime(payload.time);

  let category;
  try {
    category = assertTripCategory(payload.category, { required: true });
  } catch (err) {
    throw new AppError(400, err.code || 'VALIDATION_ERROR', err.message);
  }
  const tripType = payload.tripType || category;

  const res = await query(
    `INSERT INTO trips (
      title, description, destination, meeting_point, trip_date, trip_time,
      difficulty, trip_type, category, required_membership_level_id, min_trips_required,
      cover_image_url, max_participants, vehicle_requirements, instructions,
      route_summary, location_label, latitude, longitude, organizer_id,
      created_by, updated_by, status, published_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21,$22,
      CASE WHEN $22 = 'published' THEN NOW() ELSE NULL END
    ) RETURNING id`,
    [
      payload.title,
      payload.description || '',
      payload.destination,
      payload.meetingPoint || null,
      payload.date,
      tripTime,
      payload.difficulty || 'Moderate',
      tripType,
      category,
      requiredLevelId,
      payload.minTripsRequired || 0,
      payload.coverImage || null,
      payload.maxParticipants || 20,
      payload.vehicleRequirements || null,
      payload.instructions || null,
      payload.routeSummary || null,
      payload.location?.label || payload.destination,
      payload.location?.latitude || null,
      payload.location?.longitude || null,
      organizerId,
      actor.id,
      status,
    ],
  );

  const tripId = res.rows[0].id;

  if (Array.isArray(payload.gallery)) {
    let order = 0;
    for (const url of payload.gallery) {
      const mediaType = isVideoUrl(url) ? 'video' : 'image';
      await query(
        `INSERT INTO trip_media (trip_id, media_type, storage_path, public_url, display_order, uploaded_by)
         VALUES ($1, $2, $3, $3, $4, $5)`,
        [tripId, mediaType, url, order++, actor.id],
      );
    }
  }

  if (Array.isArray(payload.videos)) {
    let order = 100;
    for (const url of payload.videos) {
      await query(
        `INSERT INTO trip_media (trip_id, media_type, storage_path, public_url, display_order, uploaded_by)
         VALUES ($1, 'video', $2, $2, $3, $4)`,
        [tripId, url, order++, actor.id],
      );
    }
  }

  await writeAudit({
    actorId: actor.id,
    action: 'trip.create',
    entityType: 'trips',
    entityId: tripId,
    metadata: { status },
    req,
  });

  cachePresets.trip('trip.create');
  return getTrip(tripId, actor.id, actor);
}

async function updateTrip(id, payload, actor, req) {
  const existing = await getTripRow(id);
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  const canManageAll = hasPermission(actor, 'trips.manage');
  const canManageOwn =
    hasPermission(actor, 'trips.manage_own') && existing.organizer_id === actor.id;
  if (!canManageAll && !canManageOwn) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot update this trip');
  }

  let requiredLevelId = existing.required_membership_level_id;
  if (payload.requiredMembership || payload.requiredMembershipCode) {
    const code = (payload.requiredMembershipCode || payload.requiredMembership).toLowerCase();
    const level = await query(`SELECT id FROM membership_levels WHERE code = $1`, [code]);
    requiredLevelId = level.rows[0]?.id || null;
  }

  if (payload.maxParticipants != null) {
    const nextCap = Number(payload.maxParticipants);
    if (!Number.isFinite(nextCap) || nextCap < 1) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Capacity must be at least 1');
    }
    const occupied = await query(
      `SELECT COUNT(*)::int AS n FROM trip_registrations
       WHERE trip_id = $1 AND status IN ('registered', 'pending')`,
      [id],
    );
    if (nextCap < occupied.rows[0].n) {
      throw new AppError(
        409,
        'CAPACITY_TOO_LOW',
        `Cannot set capacity below current registrations (${occupied.rows[0].n})`,
      );
    }
  }

  let nextCategory = null;
  if (payload.category != null && payload.category !== '') {
    try {
      nextCategory = assertTripCategory(payload.category, { required: true });
    } catch (err) {
      throw new AppError(400, err.code || 'VALIDATION_ERROR', err.message);
    }
  }
  const nextTripType =
    payload.tripType ?? (nextCategory != null ? nextCategory : null);

  await query(
    `UPDATE trips SET
      title = COALESCE($1, title),
      description = COALESCE($2, description),
      destination = COALESCE($3, destination),
      meeting_point = COALESCE($4, meeting_point),
      trip_date = COALESCE($5, trip_date),
      trip_time = COALESCE($6, trip_time),
      difficulty = COALESCE($7, difficulty),
      trip_type = COALESCE($8, trip_type),
      category = COALESCE($9, category),
      required_membership_level_id = COALESCE($10, required_membership_level_id),
      min_trips_required = COALESCE($11, min_trips_required),
      cover_image_url = COALESCE($12, cover_image_url),
      max_participants = COALESCE($13, max_participants),
      vehicle_requirements = COALESCE($14, vehicle_requirements),
      instructions = COALESCE($15, instructions),
      route_summary = COALESCE($16, route_summary),
      location_label = COALESCE($17, location_label),
      latitude = COALESCE($18, latitude),
      longitude = COALESCE($19, longitude),
      organizer_id = COALESCE($20, organizer_id),
      updated_by = $21
     WHERE id = $22`,
    [
      payload.title ?? null,
      payload.description ?? null,
      payload.destination ?? null,
      payload.meetingPoint ?? null,
      payload.date ?? null,
      payload.time ?? null,
      payload.difficulty ?? null,
      nextTripType,
      nextCategory,
      requiredLevelId,
      payload.minTripsRequired ?? null,
      payload.coverImage ?? null,
      payload.maxParticipants ?? null,
      payload.vehicleRequirements ?? null,
      payload.instructions ?? null,
      payload.routeSummary ?? null,
      payload.location?.label ?? null,
      payload.location?.latitude ?? null,
      payload.location?.longitude ?? null,
      payload.organizerId ?? null,
      actor.id,
      id,
    ],
  );

  if (Array.isArray(payload.gallery)) {
    for (const url of payload.gallery) {
      await addTripMedia(id, { url, mediaType: isVideoUrl(url) ? 'video' : 'image' }, actor);
    }
  }
  if (Array.isArray(payload.videos)) {
    for (const url of payload.videos) {
      await addTripMedia(id, { url, mediaType: 'video' }, actor);
    }
  }

  await writeAudit({
    actorId: actor.id,
    action: 'trip.update',
    entityType: 'trips',
    entityId: id,
    req,
  });

  // Material schedule/location changes notify registered participants.
  const materialKeys = ['date', 'time', 'destination', 'meetingPoint', 'title'];
  const materialChanged = materialKeys.some((key) => payload[key] != null);
  if (materialChanged && existing.status === 'published') {
    const participantIds = await listTripParticipantIds(id, ['registered', 'pending']);
    if (participantIds.length) {
      await notifyMany(participantIds, {
        type: 'trip',
        title: 'Trip updated',
        body: `${existing.title} details were updated. Check the latest schedule.`,
        data: { tripId: id, screen: `keepers://trips/${id}` },
      });
    }
  }

  cachePresets.trip('trip.update');
  return getTrip(id, actor.id, actor);
}

async function addTripMedia(tripId, payload, actor) {
  const trip = await getTripRow(tripId);
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');
  assertCanManageTripMedia(trip, actor);

  const url = payload.url || payload.publicUrl;
  if (!url) throw new AppError(400, 'VALIDATION_ERROR', 'Media URL is required');
  const mediaType =
    payload.mediaType || (isVideoUrl(url) ? 'video' : 'image');
  if (!['image', 'video'].includes(mediaType)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'mediaType must be image or video');
  }
  const orderRes = await query(
    `SELECT COALESCE(MAX(display_order), 0)::int AS n
     FROM trip_media WHERE trip_id = $1 AND deleted_at IS NULL`,
    [tripId],
  );
  const order = (orderRes.rows[0]?.n || 0) + 1;
  const inserted = await query(
    `INSERT INTO trip_media (trip_id, media_type, storage_path, public_url, caption, display_order, uploaded_by)
     VALUES ($1, $2, $3, $3, $4, $5, $6)
     RETURNING *`,
    [tripId, mediaType, url, payload.caption || null, order, actor.id],
  );
  cachePresets.trip('trip.media.add');
  return inserted.rows[0];
}

async function deleteTripMedia(tripId, mediaId, actor, req) {
  const trip = await getTripRow(tripId);
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');
  assertCanManageTripMedia(trip, actor);

  const existing = await query(
    `SELECT * FROM trip_media
     WHERE id = $1 AND trip_id = $2 AND deleted_at IS NULL`,
    [mediaId, tripId],
  );
  if (!existing.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'Media not found on this trip');
  }
  const media = existing.rows[0];

  await query(
    `UPDATE trip_media SET deleted_at = NOW() WHERE id = $1`,
    [mediaId],
  );

  // Remove storage object only when no other active trip_media (or cover) still references it
  const refs = [];
  const fromPath = extractStorageRef(media.storage_path);
  const fromUrl = extractStorageRef(media.public_url);
  if (fromPath) refs.push(fromPath);
  if (fromUrl && (!fromPath || fromUrl.path !== fromPath.path || fromUrl.bucket !== fromPath.bucket)) {
    refs.push(fromUrl);
  }

  const storageRefsToRemove = [];
  for (const ref of refs) {
    if (!ref?.bucket || !ref?.path) continue;
    const stillUsed = await query(
      `SELECT 1 FROM trip_media
       WHERE deleted_at IS NULL
         AND id <> $1
         AND (
           storage_path = $2 OR public_url = $2
           OR storage_path LIKE '%' || $3
           OR public_url LIKE '%' || $3
         )
       LIMIT 1`,
      [mediaId, media.public_url || media.storage_path, ref.path],
    );
    const coverUses =
      trip.cover_image_url &&
      (trip.cover_image_url === media.public_url ||
        trip.cover_image_url === media.storage_path ||
        trip.cover_image_url.includes(ref.path));
    if (!stillUsed.rows[0] && !coverUses) {
      storageRefsToRemove.push(ref);
    }
  }

  const storage = await removeTripStorageFiles(storageRefsToRemove);

  await writeAudit({
    actorId: actor.id,
    action: 'trip.media.delete',
    entityType: 'trip_media',
    entityId: mediaId,
    metadata: { tripId, storage },
    req,
  });

  cachePresets.trip('trip.media.delete');
  return { id: mediaId, tripId, deleted: true, storage };
}

async function setTripStatus(id, status, actor, req, reason) {
  const existing = await getTripRow(id);
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  const canManageAll = hasPermission(actor, 'trips.manage');
  const canManageOwn =
    hasPermission(actor, 'trips.manage_own') && existing.organizer_id === actor.id;
  if (!canManageAll && !canManageOwn) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot change trip status');
  }

  const allowed = ['draft', 'published', 'cancelled', 'completed'];
  if (!allowed.includes(status)) throw new AppError(400, 'INVALID_STATUS', 'Invalid trip status');

  await query(
    `UPDATE trips SET
      status = $1,
      published_at = CASE WHEN $1 = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END,
      cancelled_at = CASE WHEN $1 = 'cancelled' THEN NOW() ELSE cancelled_at END,
      cancellation_reason = CASE WHEN $1 = 'cancelled' THEN $2 ELSE cancellation_reason END,
      updated_by = $3
     WHERE id = $4`,
    [status, reason || null, actor.id, id],
  );

  await writeAudit({
    actorId: actor.id,
    action: `trip.status.${status}`,
    entityType: 'trips',
    entityId: id,
    metadata: { reason },
    req,
  });

  if (status !== existing.status) {
    if (status === 'published') {
      const eligible = await listEligibleMemberIdsForTrip(existing);
      const recipients = eligible.filter((uid) => uid !== actor.id);
      if (recipients.length) {
        await notifyMany(recipients, {
          type: 'trip',
          title: 'New trip published',
          body: `${existing.title} is now open for registration.`,
          data: { tripId: id, status, screen: `keepers://trips/${id}` },
          idempotencyKey: `trip.status.published:${id}`,
        });
      }
      try {
        await chatService.syncGroupParticipantsForTrip(id);
      } catch (err) {
        console.warn('[chat] trip publish chat sync failed', err?.message || err);
      }
    } else if (status === 'cancelled') {
      const participantIds = await listTripParticipantIds(id, [
        'registered',
        'pending',
        'waitlist',
      ]);
      if (participantIds.length) {
        await notifyMany(participantIds, {
          type: 'trip',
          title: 'Trip cancelled',
          body: reason
            ? `${existing.title} was cancelled: ${reason}`
            : `${existing.title} was cancelled.`,
          data: { tripId: id, status, screen: `keepers://trips/${id}` },
          idempotencyKey: `trip.status.cancelled:${id}`,
        });
      }
      try {
        await query(
          `UPDATE conversations
           SET is_readonly = TRUE, updated_at = NOW()
           WHERE trip_id = $1`,
          [id],
        );
        await chatService.syncGroupParticipantsForTrip(id);
      } catch (err) {
        console.warn('[chat] trip cancel chat sync failed', err?.message || err);
      }
    }
  }

  cachePresets.trip(`trip.status.${status}`);
  return getTrip(id, actor.id);
}

async function softDeleteTrip(id, actor, req) {
  if (!hasPermission(actor, 'trips.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot delete trips');
  }
  await query(`UPDATE trips SET deleted_at = NOW(), updated_by = $1 WHERE id = $2`, [
    actor.id,
    id,
  ]);
  await writeAudit({
    actorId: actor.id,
    action: 'trip.delete',
    entityType: 'trips',
    entityId: id,
    req,
  });
  cachePresets.trip('trip.delete');
  return { id, deleted: true };
}

/**
 * Hard-delete a trip. Admin (trips.manage) may delete any trip.
 * Marshall may delete only trips they personally created (created_by).
 */
async function permanentlyDeleteTrip(id, actor, req) {
  const canManageAll = hasPermission(actor, 'trips.manage');
  const canCreateOrManageOwn =
    hasPermission(actor, 'trips.create') || hasPermission(actor, 'trips.manage_own');

  if (!canManageAll && !canCreateOrManageOwn) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot permanently delete trips');
  }

  const snapshot = await withTransaction(async (client) => {
    const tripRes = await client.query(
      `SELECT * FROM trips WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const trip = tripRes.rows[0];
    if (!trip) {
      throw new AppError(404, 'NOT_FOUND', 'Trip not found or already permanently deleted');
    }

    const isCreator = trip.created_by === actor.id;
    if (!canManageAll && !isCreator) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'You can only permanently delete trips you created',
      );
    }
    if (!canManageAll && isCreator && !canCreateOrManageOwn) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot permanently delete trips');
    }

    const counts = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('registered','pending','waitlist'))::int AS active_regs,
         COUNT(*)::int AS all_regs
       FROM trip_registrations WHERE trip_id = $1`,
      [id],
    );

    const mediaRes = await client.query(
      `SELECT id, storage_path, public_url, media_type
       FROM trip_media WHERE trip_id = $1`,
      [id],
    );

    const storageRefs = [];
    for (const m of mediaRes.rows) {
      const fromPath = extractStorageRef(m.storage_path);
      const fromUrl = extractStorageRef(m.public_url);
      if (fromPath) storageRefs.push(fromPath);
      if (fromUrl) storageRefs.push(fromUrl);
    }
    const coverRef = extractStorageRef(trip.cover_image_url);
    if (coverRef) storageRefs.push(coverRef);

    // Detach shared content; withdraw open upgrade requests tied to this trip
    await client.query(
      `UPDATE membership_upgrade_requests
       SET status = 'withdrawn', updated_at = NOW()
       WHERE trip_id = $1 AND status = 'pending'`,
      [id],
    );
    await client.query(
      `UPDATE membership_upgrade_requests SET trip_id = NULL WHERE trip_id = $1`,
      [id],
    );
    await client.query(
      `UPDATE membership_upgrade_requests SET rating_id = NULL
       WHERE rating_id IN (SELECT id FROM trip_ratings WHERE trip_id = $1)`,
      [id],
    );

    await client.query(
      `DELETE FROM notifications
       WHERE (data->>'tripId') = $1 OR (data->>'trip_id') = $1`,
      [id],
    );

    // CASCADE removes registrations, attendance, ratings(+scores/history), trip_media, assignments
    await client.query(`DELETE FROM trips WHERE id = $1`, [id]);

    return {
      id: trip.id,
      title: trip.title,
      createdBy: trip.created_by,
      organizerId: trip.organizer_id,
      status: trip.status,
      wasSoftDeleted: Boolean(trip.deleted_at),
      registrationCount: counts.rows[0].all_regs,
      activeRegistrationCount: counts.rows[0].active_regs,
      mediaCount: mediaRes.rows.length,
      storageRefs,
    };
  });

  const storage = await removeTripStorageFiles(snapshot.storageRefs);
  if (storage.failed.length) {
    console.warn(
      '[trip.permanent_delete] storage cleanup incomplete',
      JSON.stringify({ tripId: id, failed: storage.failed }),
    );
  }

  await writeAudit({
    actorId: actor.id,
    action: 'trip.permanent_delete',
    entityType: 'trips',
    entityId: id,
    metadata: {
      title: snapshot.title,
      createdBy: snapshot.createdBy,
      organizerId: snapshot.organizerId,
      status: snapshot.status,
      wasSoftDeleted: snapshot.wasSoftDeleted,
      registrationCount: snapshot.registrationCount,
      mediaCount: snapshot.mediaCount,
      storageRemoved: storage.removed,
      storageFailed: storage.failed.length,
    },
    req,
  });

  cachePresets.trip('trip.permanent_delete');
  cachePresets.rating('trip.permanent_delete');

  return {
    id,
    permanentlyDeleted: true,
    title: snapshot.title,
    registrationCount: snapshot.registrationCount,
    mediaRemoved: snapshot.mediaCount,
    storageRemoved: storage.removed,
    storageCleanupPending: storage.failed.length > 0,
  };
}

function membershipMeets(userRank, requiredRank) {
  return (userRank ?? 0) >= (requiredRank ?? 0);
}

async function getBoolSetting(key, fallback = false) {
  const res = await query(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  if (!res.rows[0]) return fallback;
  const value = res.rows[0].value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true';
  if (value && typeof value === 'object' && 'value' in value) {
    return Boolean(value.value);
  }
  // jsonb booleans / strings
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
}

async function joinTrip(tripId, user, req) {
  const profile = user.profile;
  if (!profile || profile.status !== 'approved') {
    throw new AppError(403, 'FORBIDDEN', 'Only approved members can join trips');
  }

  // Optional checklist: 0..N selections allowed; never required to join.
  const catalog = await listActiveRequirements();
  const selectedRequirementIds = normalizeSelectedIds(
    req?.body?.requirementIds,
    catalog,
  );

  const requiresApproval = await getBoolSetting('trip_join_requires_approval', false);
  const allowWaitlist = await getBoolSetting('trip_join_allow_waitlist', false);

  const { registration, trip, status } = await withTransaction(async (client) => {
    const tripRes = await client.query(
      `SELECT t.*,
              ml.rank AS required_membership_rank,
              ml.name AS required_membership_name
       FROM trips t
       LEFT JOIN membership_levels ml ON ml.id = t.required_membership_level_id
       WHERE t.id = $1 AND t.deleted_at IS NULL
       FOR UPDATE OF t`,
      [tripId],
    );
    const trip = tripRes.rows[0];
    if (!trip) {
      throw new AppError(404, 'NOT_FOUND', 'Trip is not available');
    }
    if (trip.status !== 'published') {
      throw new AppError(
        409,
        'TRIP_CLOSED',
        'This trip is not open for registration',
      );
    }
    // Past-dated published trips cannot accept new joins
    const todayRes = await client.query(`SELECT CURRENT_DATE AS today`);
    const today = todayRes.rows[0].today;
    if (trip.trip_date < today) {
      throw new AppError(409, 'TRIP_EXPIRED', 'This trip has already taken place');
    }

    if (!membershipMeets(profile.membership_rank, trip.required_membership_rank)) {
      throw new AppError(
        403,
        'INELIGIBLE_MEMBERSHIP',
        `Requires ${trip.required_membership_name || 'higher'} membership or above`,
      );
    }

    if (profile.completed_trips < trip.min_trips_required) {
      throw new AppError(
        403,
        'INELIGIBLE_TRIPS',
        `Requires ${trip.min_trips_required} completed trips`,
      );
    }

    const existing = await client.query(
      `SELECT * FROM trip_registrations
       WHERE trip_id = $1 AND user_id = $2
       FOR UPDATE`,
      [tripId, user.id],
    );
    if (
      existing.rows[0] &&
      !['cancelled', 'rejected'].includes(existing.rows[0].status)
    ) {
      throw new AppError(
        409,
        'ALREADY_REGISTERED',
        'You are already registered for this trip',
      );
    }

    // Hold seats for both confirmed and pending approvals so concurrent joins cannot overbook
    const countRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM trip_registrations
       WHERE trip_id = $1 AND status IN ('registered', 'pending')`,
      [tripId],
    );
    const occupied = countRes.rows[0].n;

    let status = 'registered';
    if (requiresApproval) {
      if (occupied >= trip.max_participants) {
        if (allowWaitlist) {
          status = 'waitlist';
        } else {
          throw new AppError(409, 'TRIP_FULL', 'This trip is full');
        }
      } else {
        status = 'pending';
      }
    } else if (occupied >= trip.max_participants) {
      if (allowWaitlist) {
        status = 'waitlist';
      } else {
        throw new AppError(409, 'TRIP_FULL', 'This trip is full');
      }
    }

    let registration;
    if (existing.rows[0]) {
      const updated = await client.query(
        `UPDATE trip_registrations
         SET status = $1, registered_at = NOW(), cancelled_at = NULL, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [status, existing.rows[0].id],
      );
      registration = updated.rows[0];
    } else {
      const inserted = await client.query(
        `INSERT INTO trip_registrations (trip_id, user_id, status)
         VALUES ($1,$2,$3) RETURNING *`,
        [tripId, user.id, status],
      );
      registration = inserted.rows[0];
    }

    await saveRegistrationChecklist(
      client,
      registration.id,
      selectedRequirementIds,
    );

    return { registration, trip, status };
  });

  await writeAudit({
    actorId: user.id,
    action: 'trip.join',
    entityType: 'trip_registrations',
    entityId: registration.id,
    metadata: {
      tripId,
      status,
      readinessSelectedCount: selectedRequirementIds.length,
    },
    req,
  });

  if (trip.organizer_id) {
    await createNotification({
      userId: trip.organizer_id,
      type: 'registration',
      title: 'New trip registration',
      body: `${profile.first_name} ${profile.last_name} joined ${trip.title} (${status})`,
      data: {
        tripId,
        userId: user.id,
        status,
        screen: `keepers://trips/${tripId}`,
      },
      idempotencyKey: `trip.join:${registration.id}`,
    });
  }

  await syncChatAfterRegistrationChange(tripId, user.id, status);
  return getTrip(tripId, user.id);
}

async function cancelRegistration(tripId, user, req) {
  const { cancelled, promoted } = await withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM trip_registrations
       WHERE trip_id = $1 AND user_id = $2
         AND status IN ('registered','waitlist','pending')
       FOR UPDATE`,
      [tripId, user.id],
    );
    if (!existing.rows[0]) {
      throw new AppError(404, 'NOT_FOUND', 'Registration not found');
    }

    const wasHoldingSeat = ['registered', 'pending'].includes(existing.rows[0].status);

    await client.query(
      `UPDATE trip_registrations
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id],
    );

    let promoted = null;
    if (wasHoldingSeat) {
      const tripRes = await client.query(
        `SELECT * FROM trips WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [tripId],
      );
      const trip = tripRes.rows[0];
      if (trip) {
        const countRes = await client.query(
          `SELECT COUNT(*)::int AS n FROM trip_registrations
           WHERE trip_id = $1 AND status IN ('registered', 'pending')`,
          [tripId],
        );
        if (countRes.rows[0].n < trip.max_participants) {
          const next = await client.query(
            `SELECT * FROM trip_registrations
             WHERE trip_id = $1 AND status = 'waitlist'
             ORDER BY registered_at ASC NULLS LAST, created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [tripId],
          );
          if (next.rows[0]) {
            await client.query(
              `UPDATE trip_registrations SET status = 'registered', updated_at = NOW() WHERE id = $1`,
              [next.rows[0].id],
            );
            promoted = { userId: next.rows[0].user_id, tripTitle: trip.title };
          }
        }
      }
    }

    return { cancelled: existing.rows[0], promoted };
  });

  if (promoted) {
    await createNotification({
      userId: promoted.userId,
      type: 'registration',
      title: 'Waitlist promoted',
      body: `A seat opened for ${promoted.tripTitle}. You are now registered.`,
      data: { tripId, screen: `keepers://trips/${tripId}` },
      idempotencyKey: `waitlist.promote:${tripId}:${promoted.userId}`,
    });
  }

  const tripRow = await getTripRow(tripId);
  if (tripRow?.organizer_id && tripRow.organizer_id !== user.id) {
    const member = await query(
      `SELECT first_name, last_name FROM member_profiles WHERE id = $1`,
      [user.id],
    );
    const name = member.rows[0]
      ? `${member.rows[0].first_name} ${member.rows[0].last_name}`.trim()
      : 'A member';
    await createNotification({
      userId: tripRow.organizer_id,
      type: 'registration',
      title: 'Registration cancelled',
      body: `${name} cancelled their registration for ${tripRow.title}.`,
      data: {
        tripId,
        userId: user.id,
        status: 'cancelled',
        screen: `keepers://trips/${tripId}`,
      },
      idempotencyKey: `trip.cancel_registration:${cancelled.id}`,
    });
  }

  await writeAudit({
    actorId: user.id,
    action: 'trip.cancel_registration',
    entityType: 'trip_registrations',
    entityId: cancelled.id,
    metadata: { tripId },
    req,
  });

  await syncChatAfterRegistrationChange(tripId, user.id, 'cancelled');
  if (promoted?.userId) {
    await syncChatAfterRegistrationChange(tripId, promoted.userId, 'registered');
  }

  return getTrip(tripId, user.id);
}

async function markAttendance(tripId, { userId, attended = true, notes }, actor, req) {
  if (!hasPermission(actor, 'attendance.mark')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot mark attendance');
  }

  const trip = await getTripRow(tripId);
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  const canManageAll = hasPermission(actor, 'trips.manage');
  const isOrganizer = trip.organizer_id === actor.id;
  const canManageOwn = hasPermission(actor, 'trips.manage_own') && isOrganizer;

  // Only admins (trips.manage) or the drive organizer with manage_own may mark attendance.
  // Holding attendance.mark alone (e.g. legacy Pre-Marshall grants) is not enough.
  if (!canManageAll && !canManageOwn) {
    throw new AppError(403, 'FORBIDDEN', 'Not authorized for this trip');
  }

  const reg = await query(
    `SELECT id FROM trip_registrations WHERE trip_id = $1 AND user_id = $2 AND status = 'registered'`,
    [tripId, userId],
  );
  if (!reg.rows[0]) {
    throw new AppError(
      400,
      'NOT_REGISTERED',
      'Member must be a registered participant before attendance can be marked',
    );
  }

  const result = await query(
    `INSERT INTO trip_attendance (trip_id, user_id, registration_id, attended, marked_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (trip_id, user_id) DO UPDATE SET
       attended = EXCLUDED.attended,
       marked_by = EXCLUDED.marked_by,
       notes = EXCLUDED.notes,
       marked_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [tripId, userId, reg.rows[0].id, attended, actor.id, notes || null],
  );

  await writeAudit({
    actorId: actor.id,
    action: 'trip.attendance',
    entityType: 'trip_attendance',
    entityId: result.rows[0].id,
    metadata: { tripId, userId, attended },
    req,
  });

  // completed_trips synced by DB trigger
  return result.rows[0];
}

async function calendar({ from, to, userId, includeDrafts = false }) {
  return listTrips({ from, to, userId, includeDrafts, limit: 500 });
}

async function listMyOrganizedTrips(actor, { status, page = 1, limit = 50 } = {}) {
  if (
    !hasPermission(actor, 'trips.create') &&
    !hasPermission(actor, 'trips.manage_own') &&
    !hasPermission(actor, 'trips.manage')
  ) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot list organized trips');
  }

  const where = ['t.deleted_at IS NULL', 't.organizer_id = $1'];
  const params = [actor.id];

  if (status) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }

  params.push(limit, (page - 1) * limit);
  const result = await query(
    `SELECT t.*,
            ml.code AS required_membership_code,
            ml.name AS required_membership_name,
            ml.rank AS required_membership_rank
     FROM trips t
     LEFT JOIN membership_levels ml ON ml.id = t.required_membership_level_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.trip_date DESC, t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const items = [];
  for (const row of result.rows) {
    const mapped = await mapTrip(row, { userId: actor.id, actor });
    items.push({ ...mapped, accessMode: 'organizer' });
  }
  return { items, pagination: { page, limit } };
}

async function assertUserIsPreMarshall(userId) {
  const res = await query(
    `SELECT 1
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND r.code = 'pre_marshall'
     LIMIT 1`,
    [userId],
  );
  if (!res.rows[0]) {
    throw new AppError(
      400,
      'NOT_PRE_MARSHALL',
      'Member must have the Pre-Marshall role before assignment',
    );
  }
}

async function listPreMarshallAssignments(tripId, actor) {
  if (!hasPermission(actor, 'trips.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot list Pre-Marshall assignments');
  }
  const trip = await getTripRow(tripId);
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  const res = await query(
    `SELECT a.id, a.trip_id, a.user_id, a.notes, a.assigned_by, a.created_at,
            mp.first_name, mp.last_name, mp.username, mp.avatar_url
     FROM trip_pre_marshall_assignments a
     JOIN member_profiles mp ON mp.id = a.user_id
     WHERE a.trip_id = $1
     ORDER BY a.created_at ASC`,
    [tripId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    notes: row.notes,
    assignedBy: row.assigned_by,
    createdAt: row.created_at,
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    username: row.username,
    avatar: row.avatar_url,
  }));
}

async function assignPreMarshall(tripId, { userId, notes }, actor, req) {
  if (!hasPermission(actor, 'trips.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot assign Pre-Marshalls');
  }
  if (!userId) throw new AppError(400, 'VALIDATION_ERROR', 'userId is required');

  const trip = await getTripRow(tripId);
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  await assertUserIsPreMarshall(userId);

  const inserted = await query(
    `INSERT INTO trip_pre_marshall_assignments (trip_id, user_id, assigned_by, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (trip_id, user_id) DO UPDATE SET
       notes = COALESCE(EXCLUDED.notes, trip_pre_marshall_assignments.notes),
       assigned_by = EXCLUDED.assigned_by,
       updated_at = NOW()
     RETURNING *`,
    [tripId, userId, actor.id, notes || null],
  );

  await writeAudit({
    actorId: actor.id,
    action: 'trip.pre_marshall.assign',
    entityType: 'trip_pre_marshall_assignments',
    entityId: inserted.rows[0].id,
    metadata: { tripId, userId },
    req,
  });

  await createNotification({
    userId,
    type: 'trip',
    title: 'Drive assignment',
    body: `You were assigned as Pre-Marshall for ${trip.title}.`,
    data: { tripId, kind: 'pre_marshall_assignment' },
  });

  cachePresets.trip('trip.pre_marshall.assign');
  return listPreMarshallAssignments(tripId, actor);
}

async function unassignPreMarshall(tripId, userId, actor, req) {
  if (!hasPermission(actor, 'trips.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot unassign Pre-Marshalls');
  }

  const existing = await query(
    `SELECT * FROM trip_pre_marshall_assignments WHERE trip_id = $1 AND user_id = $2`,
    [tripId, userId],
  );
  if (!existing.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Assignment not found');

  await query(
    `DELETE FROM trip_pre_marshall_assignments WHERE trip_id = $1 AND user_id = $2`,
    [tripId, userId],
  );

  await writeAudit({
    actorId: actor.id,
    action: 'trip.pre_marshall.unassign',
    entityType: 'trip_pre_marshall_assignments',
    entityId: existing.rows[0].id,
    metadata: { tripId, userId },
    req,
  });

  cachePresets.trip('trip.pre_marshall.unassign');
  return listPreMarshallAssignments(tripId, actor);
}

async function listMyAssignedTrips(actor, { status, page = 1, limit = 50 } = {}) {
  if (!hasPermission(actor, 'trips.read')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot list assigned drives');
  }

  const where = [
    't.deleted_at IS NULL',
    'a.user_id = $1',
  ];
  const params = [actor.id];

  if (status) {
    params.push(status);
    where.push(`t.status = $${params.length}`);
  }

  params.push(limit, (page - 1) * limit);
  const result = await query(
    `SELECT t.*,
            ml.code AS required_membership_code,
            ml.name AS required_membership_name,
            ml.rank AS required_membership_rank
     FROM trip_pre_marshall_assignments a
     JOIN trips t ON t.id = a.trip_id
     LEFT JOIN membership_levels ml ON ml.id = t.required_membership_level_id
     WHERE ${where.join(' AND ')}
     ORDER BY t.trip_date DESC, t.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const items = [];
  for (const row of result.rows) {
    const mapped = await mapTrip(row, { userId: actor.id, actor });
    items.push({ ...mapped, accessMode: 'assigned' });
  }
  return { items, pagination: { page, limit } };
}

async function assertCanViewAssignedTrip(tripId, actor) {
  if (
    hasPermission(actor, 'trips.manage') ||
    hasPermission(actor, 'trips.manage_own') ||
    hasPermission(actor, 'trips.create')
  ) {
    return true;
  }
  const assigned = await query(
    `SELECT 1 FROM trip_pre_marshall_assignments WHERE trip_id = $1 AND user_id = $2`,
    [tripId, actor.id],
  );
  return Boolean(assigned.rows[0]);
}

module.exports = {
  listTrips,
  getTrip,
  createTrip,
  updateTrip,
  addTripMedia,
  deleteTripMedia,
  setTripStatus,
  softDeleteTrip,
  permanentlyDeleteTrip,
  joinTrip,
  cancelRegistration,
  markAttendance,
  listRegistrations,
  reviewRegistration,
  calendar,
  listMyOrganizedTrips,
  listMyAssignedTrips,
  listPreMarshallAssignments,
  assignPreMarshall,
  unassignPreMarshall,
  assertCanViewAssignedTrip,
  mapTrip,
  getTripRow,
  listActiveRequirements,
  TRIP_CATEGORIES,
};

async function listRegistrations({
  tripId,
  status,
  q,
  page = 1,
  limit = 50,
} = {}) {
  const where = ['1=1'];
  const params = [];

  if (tripId) {
    params.push(tripId);
    where.push(`tr.trip_id = $${params.length}`);
  }
  if (status && status !== 'all') {
    params.push(status);
    where.push(`tr.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(mp.first_name ILIKE $${params.length} OR mp.last_name ILIKE $${params.length} OR mp.username ILIKE $${params.length} OR t.title ILIKE $${params.length})`,
    );
  }

  params.push(limit, (page - 1) * limit);
  const result = await query(
    `SELECT tr.id, tr.trip_id, tr.user_id, tr.status, tr.registered_at, tr.cancelled_at,
            tr.notes, tr.reviewed_by, tr.reviewed_at,
            t.title AS trip_title, t.trip_date, t.destination, t.max_participants,
            mp.first_name, mp.last_name, mp.username, mp.avatar_url,
            ml.name AS membership_name
     FROM trip_registrations tr
     JOIN trips t ON t.id = tr.trip_id AND t.deleted_at IS NULL
     JOIN member_profiles mp ON mp.id = tr.user_id
     LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
     WHERE ${where.join(' AND ')}
     ORDER BY tr.registered_at DESC NULLS LAST, tr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countParams = params.slice(0, params.length - 2);
  const total = await query(
    `SELECT COUNT(*)::int AS n
     FROM trip_registrations tr
     JOIN trips t ON t.id = tr.trip_id AND t.deleted_at IS NULL
     JOIN member_profiles mp ON mp.id = tr.user_id
     WHERE ${where.join(' AND ')}`,
    countParams,
  );

  return {
    items: result.rows.map((row) => ({
      id: row.id,
      tripId: row.trip_id,
      userId: row.user_id,
      status: row.status,
      registeredAt: row.registered_at,
      cancelledAt: row.cancelled_at,
      notes: row.notes,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      tripTitle: row.trip_title,
      tripDate: row.trip_date,
      destination: row.destination,
      maxParticipants: row.max_participants,
      memberName: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
      username: row.username,
      avatar: row.avatar_url,
      membership: row.membership_name,
    })),
    page,
    limit,
    total: total.rows[0]?.n || 0,
  };
}

async function reviewRegistration(registrationId, payload, actor, req) {
  const nextStatus = payload.status;
  const allowed = ['registered', 'waitlist', 'rejected', 'cancelled', 'pending'];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(400, 'INVALID_STATUS', 'Invalid registration status');
  }

  const isGlobalReviewer =
    hasPermission(actor, 'registrations.manage') || hasPermission(actor, 'trips.manage');

  const { updated, row, promoted, tripTitle } = await withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM trip_registrations WHERE id = $1 FOR UPDATE`,
      [registrationId],
    );
    if (!existing.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Registration not found');
    const row = existing.rows[0];

    const tripRes = await client.query(
      `SELECT * FROM trips WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [row.trip_id],
    );
    const trip = tripRes.rows[0];
    if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

    assertCanReviewTripRegistrations(trip, actor);

    // Marshall (manage_own only) may only review pending → registered|rejected
    if (!isGlobalReviewer) {
      if (row.status !== 'pending') {
        throw new AppError(409, 'ALREADY_REVIEWED', 'Registration has already been reviewed');
      }
      if (!['registered', 'rejected'].includes(nextStatus)) {
        throw new AppError(403, 'FORBIDDEN', 'Marshalls may only approve or reject pending registrations');
      }
    }

    if (['registered', 'rejected'].includes(nextStatus) && ['cancelled', 'completed'].includes(trip.status)) {
      throw new AppError(409, 'TRIP_CLOSED', 'Cannot review registrations for a closed trip');
    }

    if (nextStatus === 'registered') {
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS n FROM trip_registrations
         WHERE trip_id = $1 AND status IN ('registered', 'pending') AND id <> $2`,
        [row.trip_id, registrationId],
      );
      if (countRes.rows[0].n >= trip.max_participants) {
        throw new AppError(409, 'TRIP_FULL', 'Trip is full — move to waitlist instead');
      }
    }

    const updatedRes = await client.query(
      `UPDATE trip_registrations SET
         status = $1,
         notes = COALESCE($2, notes),
         reviewed_by = $3,
         reviewed_at = NOW(),
         cancelled_at = CASE WHEN $1 = 'cancelled' THEN NOW() ELSE cancelled_at END,
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [nextStatus, payload.notes || null, actor.id, registrationId],
    );

    let promoted = null;
    if (
      ['cancelled', 'rejected'].includes(nextStatus) &&
      ['registered', 'pending'].includes(row.status) &&
      trip
    ) {
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS n FROM trip_registrations
         WHERE trip_id = $1 AND status IN ('registered', 'pending')`,
        [row.trip_id],
      );
      if (countRes.rows[0].n < trip.max_participants) {
        const next = await client.query(
          `SELECT * FROM trip_registrations
           WHERE trip_id = $1 AND status = 'waitlist'
           ORDER BY registered_at ASC NULLS LAST, created_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          [row.trip_id],
        );
        if (next.rows[0]) {
          await client.query(
            `UPDATE trip_registrations SET status = 'registered', updated_at = NOW() WHERE id = $1`,
            [next.rows[0].id],
          );
          promoted = next.rows[0];
        }
      }
    }

    return {
      updated: updatedRes.rows[0],
      row,
      promoted,
      tripTitle: trip?.title || 'this trip',
    };
  });

  await writeAudit({
    actorId: actor.id,
    action: 'registration.review',
    entityType: 'trip_registrations',
    entityId: registrationId,
    metadata: { status: nextStatus, tripId: row.trip_id },
    req,
  });

  await createNotification({
    userId: row.user_id,
    type: 'registration',
    title: 'Registration update',
    body: `Your trip registration is now “${nextStatus}”.`,
    data: {
      tripId: row.trip_id,
      status: nextStatus,
      screen: `keepers://trips/${row.trip_id}`,
    },
    idempotencyKey: `registration.review:${registrationId}:${nextStatus}`,
  });

  if (promoted) {
    await createNotification({
      userId: promoted.user_id,
      type: 'registration',
      title: 'Waitlist promoted',
      body: `A seat opened — you are now registered for ${tripTitle}.`,
      data: {
        tripId: row.trip_id,
        status: 'registered',
        screen: `keepers://trips/${row.trip_id}`,
      },
      idempotencyKey: `waitlist.promote:${row.trip_id}:${promoted.user_id}`,
    });
  }

  await syncChatAfterRegistrationChange(row.trip_id, row.user_id, nextStatus);
  if (promoted?.user_id) {
    await syncChatAfterRegistrationChange(row.trip_id, promoted.user_id, 'registered');
  }

  cachePresets.registration('registration.review');
  return updated;
}
