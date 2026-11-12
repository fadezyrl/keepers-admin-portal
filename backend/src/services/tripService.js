const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const { createNotification, notifyMany } = require('./notificationService');
const { hasPermission } = require('../middleware/auth');

const MEMBERSHIP_RANK = { junior: 0, intermediate: 1, advanced: 2 };

async function mapTrip(row, { userId = null } = {}) {
  const media = await query(
    `SELECT id, media_type, public_url, thumbnail_url, caption, display_order
     FROM trip_media WHERE trip_id = $1 AND deleted_at IS NULL ORDER BY display_order, created_at`,
    [row.id],
  );

  const counts = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'registered')::int AS registered_count,
       COUNT(*) FILTER (WHERE status = 'waitlist')::int AS waitlist_count
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

  const participants = await query(
    `SELECT mp.id, mp.first_name, mp.last_name, mp.avatar_url,
            tr.status AS registration_status,
            (SELECT manufacturer || ' ' || model FROM vehicles v
             WHERE v.user_id = mp.id AND v.deleted_at IS NULL
             ORDER BY is_primary DESC LIMIT 1) AS vehicle
     FROM trip_registrations tr
     JOIN member_profiles mp ON mp.id = tr.user_id
     WHERE tr.trip_id = $1 AND tr.status IN ('registered', 'waitlist')
     ORDER BY tr.registered_at ASC`,
    [row.id],
  );

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
    date: row.trip_date,
    time: row.trip_time,
    difficulty: row.difficulty,
    tripType: row.trip_type,
    requiredMembership: row.required_membership_name || row.required_membership_code,
    requiredMembershipCode: row.required_membership_code,
    minTripsRequired: row.min_trips_required,
    coverImage: row.cover_image_url,
    gallery: media.rows.filter((m) => m.media_type === 'image').map((m) => m.public_url),
    media: media.rows,
    maxParticipants: row.max_participants,
    registeredCount,
    waitlistCount: counts.rows[0].waitlist_count,
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
    participants: participants.rows.map((p) => ({
      id: p.id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      avatar: p.avatar_url,
      vehicle: p.vehicle,
      registrationStatus: p.registration_status,
    })),
    status: clientStatus,
    publishStatus: row.status,
    myRegistration,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

async function getTrip(id, userId) {
  const row = await getTripRow(id);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Trip not found');
  return mapTrip(row, { userId });
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

  const res = await query(
    `INSERT INTO trips (
      title, description, destination, meeting_point, trip_date, trip_time,
      difficulty, trip_type, required_membership_level_id, min_trips_required,
      cover_image_url, max_participants, vehicle_requirements, instructions,
      route_summary, location_label, latitude, longitude, organizer_id,
      created_by, updated_by, status, published_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20,$21,
      CASE WHEN $21 = 'published' THEN NOW() ELSE NULL END
    ) RETURNING id`,
    [
      payload.title,
      payload.description || '',
      payload.destination,
      payload.meetingPoint || null,
      payload.date,
      payload.time || null,
      payload.difficulty || 'Moderate',
      payload.tripType || null,
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
      await query(
        `INSERT INTO trip_media (trip_id, media_type, storage_path, public_url, display_order, uploaded_by)
         VALUES ($1, 'image', $2, $2, $3, $4)`,
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

  return getTrip(tripId, actor.id);
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
      required_membership_level_id = COALESCE($9, required_membership_level_id),
      min_trips_required = COALESCE($10, min_trips_required),
      cover_image_url = COALESCE($11, cover_image_url),
      max_participants = COALESCE($12, max_participants),
      vehicle_requirements = COALESCE($13, vehicle_requirements),
      instructions = COALESCE($14, instructions),
      route_summary = COALESCE($15, route_summary),
      location_label = COALESCE($16, location_label),
      latitude = COALESCE($17, latitude),
      longitude = COALESCE($18, longitude),
      organizer_id = COALESCE($19, organizer_id),
      updated_by = $20
     WHERE id = $21`,
    [
      payload.title ?? null,
      payload.description ?? null,
      payload.destination ?? null,
      payload.meetingPoint ?? null,
      payload.date ?? null,
      payload.time ?? null,
      payload.difficulty ?? null,
      payload.tripType ?? null,
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

  await writeAudit({
    actorId: actor.id,
    action: 'trip.update',
    entityType: 'trips',
    entityId: id,
    req,
  });

  return getTrip(id, actor.id);
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
  return { id, deleted: true };
}

function membershipMeets(userRank, requiredRank) {
  return (userRank ?? 0) >= (requiredRank ?? 0);
}

async function joinTrip(tripId, user, req) {
  const trip = await getTripRow(tripId);
  if (!trip || trip.status !== 'published') {
    throw new AppError(404, 'NOT_FOUND', 'Trip is not available');
  }

  const profile = user.profile;
  if (!profile || profile.status !== 'approved') {
    throw new AppError(403, 'FORBIDDEN', 'Only approved members can join trips');
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

  const existing = await query(
    `SELECT * FROM trip_registrations WHERE trip_id = $1 AND user_id = $2`,
    [tripId, user.id],
  );
  if (existing.rows[0] && existing.rows[0].status !== 'cancelled') {
    throw new AppError(409, 'ALREADY_REGISTERED', 'You are already registered for this trip');
  }

  const countRes = await query(
    `SELECT COUNT(*)::int AS n FROM trip_registrations WHERE trip_id = $1 AND status = 'registered'`,
    [tripId],
  );
  const status = countRes.rows[0].n >= trip.max_participants ? 'waitlist' : 'registered';

  let registration;
  if (existing.rows[0]) {
    const updated = await query(
      `UPDATE trip_registrations SET status = $1, registered_at = NOW(), cancelled_at = NULL, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, existing.rows[0].id],
    );
    registration = updated.rows[0];
  } else {
    const inserted = await query(
      `INSERT INTO trip_registrations (trip_id, user_id, status) VALUES ($1,$2,$3) RETURNING *`,
      [tripId, user.id, status],
    );
    registration = inserted.rows[0];
  }

  await writeAudit({
    actorId: user.id,
    action: 'trip.join',
    entityType: 'trip_registrations',
    entityId: registration.id,
    metadata: { tripId, status },
    req,
  });

  if (trip.organizer_id) {
    await createNotification({
      userId: trip.organizer_id,
      type: 'registration',
      title: 'New trip registration',
      body: `${profile.first_name} ${profile.last_name} joined ${trip.title} (${status})`,
      data: { tripId, userId: user.id, status },
    });
  }

  return getTrip(tripId, user.id);
}

async function cancelRegistration(tripId, user, req) {
  const existing = await query(
    `SELECT * FROM trip_registrations WHERE trip_id = $1 AND user_id = $2 AND status IN ('registered','waitlist')`,
    [tripId, user.id],
  );
  if (!existing.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Registration not found');

  await query(
    `UPDATE trip_registrations SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [existing.rows[0].id],
  );

  // Promote waitlist if a seat opened
  const trip = await getTripRow(tripId);
  if (trip) {
    const countRes = await query(
      `SELECT COUNT(*)::int AS n FROM trip_registrations WHERE trip_id = $1 AND status = 'registered'`,
      [tripId],
    );
    if (countRes.rows[0].n < trip.max_participants) {
      const next = await query(
        `SELECT * FROM trip_registrations
         WHERE trip_id = $1 AND status = 'waitlist'
         ORDER BY registered_at ASC LIMIT 1`,
        [tripId],
      );
      if (next.rows[0]) {
        await query(
          `UPDATE trip_registrations SET status = 'registered', updated_at = NOW() WHERE id = $1`,
          [next.rows[0].id],
        );
        await createNotification({
          userId: next.rows[0].user_id,
          type: 'registration',
          title: 'Waitlist promoted',
          body: `A seat opened for ${trip.title}. You are now registered.`,
          data: { tripId },
        });
      }
    }
  }

  await writeAudit({
    actorId: user.id,
    action: 'trip.cancel_registration',
    entityType: 'trip_registrations',
    entityId: existing.rows[0].id,
    metadata: { tripId },
    req,
  });

  return getTrip(tripId, user.id);
}

async function markAttendance(tripId, { userId, attended = true, notes }, actor, req) {
  if (!hasPermission(actor, 'attendance.mark')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot mark attendance');
  }

  const trip = await getTripRow(tripId);
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  const canManageAll = hasPermission(actor, 'trips.manage');
  if (!canManageAll && trip.organizer_id !== actor.id && !hasPermission(actor, 'attendance.mark')) {
    throw new AppError(403, 'FORBIDDEN', 'Not authorized for this trip');
  }

  const reg = await query(
    `SELECT id FROM trip_registrations WHERE trip_id = $1 AND user_id = $2 AND status = 'registered'`,
    [tripId, userId],
  );

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
    [tripId, userId, reg.rows[0]?.id || null, attended, actor.id, notes || null],
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
    items.push(await mapTrip(row, { userId: actor.id }));
  }
  return { items, pagination: { page, limit } };
}

module.exports = {
  listTrips,
  getTrip,
  createTrip,
  updateTrip,
  setTripStatus,
  softDeleteTrip,
  joinTrip,
  cancelRegistration,
  markAttendance,
  calendar,
  listMyOrganizedTrips,
  mapTrip,
  getTripRow,
};
