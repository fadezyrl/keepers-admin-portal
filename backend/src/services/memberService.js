const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const { createNotification } = require('./notificationService');
const { presets: cachePresets } = require('./cacheInvalidationService');
const { hasPermission } = require('../middleware/auth');
const { getAdminClient } = require('../config/supabase');

function membershipLabel(row) {
  return row.membership_name || row.membership_code || null;
}

async function listMembers({
  q,
  status,
  membership,
  role,
  page = 1,
  limit = 20,
}) {
  const offset = (page - 1) * limit;
  const where = [];
  const params = [];

  if (status === 'deleted') {
    where.push('mp.deleted_at IS NOT NULL');
  } else {
    where.push('mp.deleted_at IS NULL');
    if (status) {
      params.push(status);
      where.push(`mp.status = $${params.length}`);
    }
  }

  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(mp.first_name ILIKE $${params.length} OR mp.last_name ILIKE $${params.length} OR mp.username ILIKE $${params.length} OR mp.email ILIKE $${params.length})`,
    );
  }
  if (membership) {
    params.push(membership.toLowerCase());
    where.push(`ml.code = $${params.length}`);
  }
  if (role) {
    params.push(role);
    where.push(
      `EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = mp.id AND r.code = $${params.length})`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, offset);

  const result = await query(
    `SELECT mp.id, mp.first_name, mp.last_name, mp.username, mp.email, mp.phone,
            mp.nationality, mp.avatar_url, mp.status, mp.completed_trips, mp.created_at,
            mp.deleted_at,
            ml.code AS membership_code, ml.name AS membership_name,
            COALESCE(
              (SELECT json_agg(json_build_object('code', r.code, 'name', r.name))
               FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = mp.id),
              '[]'::json
            ) AS roles,
            (SELECT row_to_json(v) FROM (
               SELECT id, manufacturer, model, model_year AS year, image_url AS image
               FROM vehicles WHERE user_id = mp.id AND deleted_at IS NULL
               ORDER BY is_primary DESC LIMIT 1
             ) v) AS vehicle
     FROM member_profiles mp
     LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
     ${whereSql}
     ORDER BY mp.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countParams = params.slice(0, -2);
  const countRes = await query(
    `SELECT COUNT(*)::int AS total
     FROM member_profiles mp
     LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
     ${whereSql}`,
    countParams,
  );

  return {
    items: result.rows.map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      name: `${row.first_name} ${row.last_name}`.trim(),
      username: row.username,
      email: row.email,
      phone: row.phone,
      nationality: row.nationality,
      avatar: row.avatar_url,
      status: row.deleted_at ? 'deleted' : row.status,
      completedTrips: row.completed_trips,
      membership: membershipLabel(row),
      membershipCode: row.membership_code,
      roles: row.roles || [],
      vehicle: row.vehicle,
      createdAt: row.created_at,
      deletedAt: row.deleted_at || null,
    })),
    pagination: {
      page,
      limit,
      total: countRes.rows[0].total,
    },
  };
}

async function getMemberById(id, viewer) {
  const includeDeleted = hasPermission(viewer, 'members.manage');
  const res = await query(
    `SELECT mp.*, ml.code AS membership_code, ml.name AS membership_name, ml.rank AS membership_rank
     FROM member_profiles mp
     LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
     WHERE mp.id = $1 ${includeDeleted ? '' : 'AND mp.deleted_at IS NULL'}`,
    [id],
  );
  if (!res.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Member not found');
  const mp = res.rows[0];

  const roles = await query(
    `SELECT r.code, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
    [id],
  );
  const vehicle = await query(
    `SELECT id, manufacturer, model, model_year AS year, vin, image_url AS image, is_primary
     FROM vehicles WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_primary DESC`,
    [id],
  );
  const social = await query(
    `SELECT platform, handle_or_url FROM social_links WHERE user_id = $1`,
    [id],
  );

  let emergency = [];
  const canSeeEmergency =
    viewer?.id === id || hasPermission(viewer, 'members.emergency.read');
  if (canSeeEmergency) {
    const em = await query(
      `SELECT id, name, phone, relationship FROM emergency_contacts WHERE user_id = $1`,
      [id],
    );
    emergency = em.rows;
  }

  const socialMap = {};
  for (const s of social.rows) socialMap[s.platform] = s.handle_or_url;

  const showVehicle = mp.privacy_show_vehicle || viewer?.id === id || hasPermission(viewer, 'members.manage');
  const showSocial = mp.privacy_show_social || viewer?.id === id || hasPermission(viewer, 'members.manage');

  const tripsCompleted = await query(
    `SELECT t.id, t.title, t.trip_date, t.destination
     FROM trip_attendance ta
     JOIN trips t ON t.id = ta.trip_id
     WHERE ta.user_id = $1 AND ta.attended = TRUE
     ORDER BY t.trip_date DESC`,
    [id],
  );

  return {
    id: mp.id,
    firstName: mp.first_name,
    lastName: mp.last_name,
    name: `${mp.first_name} ${mp.last_name}`.trim(),
    username: mp.username,
    email: mp.email,
    phone: mp.phone,
    nationality: mp.nationality,
    gender: mp.gender,
    bio: mp.bio,
    avatar: mp.avatar_url,
    status: mp.deleted_at ? 'deleted' : mp.status,
    completedTrips: mp.completed_trips,
    membership: membershipLabel(mp),
    membershipCode: mp.membership_code,
    membershipRank: mp.membership_rank,
    roles: roles.rows,
    vehicle: showVehicle ? vehicle.rows[0] || null : null,
    vehicles: showVehicle ? vehicle.rows : [],
    social: showSocial ? socialMap : {},
    emergencyContacts: emergency,
    privacy: {
      showVehicle: mp.privacy_show_vehicle,
      showSocial: mp.privacy_show_social,
    },
    completedTripHistory: tripsCompleted.rows,
    createdAt: mp.created_at,
    approvedAt: mp.approved_at,
    deletedAt: mp.deleted_at || null,
  };
}

async function updateOwnProfile(userId, payload, req) {
  const fields = [];
  const params = [];
  const map = {
    firstName: 'first_name',
    lastName: 'last_name',
    phone: 'phone',
    nationality: 'nationality',
    gender: 'gender',
    bio: 'bio',
    avatar: 'avatar_url',
  };

  for (const [key, column] of Object.entries(map)) {
    if (payload[key] !== undefined) {
      params.push(payload[key]);
      fields.push(`${column} = $${params.length}`);
    }
  }

  if (payload.privacy) {
    if (payload.privacy.showVehicle !== undefined) {
      params.push(payload.privacy.showVehicle);
      fields.push(`privacy_show_vehicle = $${params.length}`);
    }
    if (payload.privacy.showSocial !== undefined) {
      params.push(payload.privacy.showSocial);
      fields.push(`privacy_show_social = $${params.length}`);
    }
  }

  if (fields.length) {
    params.push(userId);
    await query(
      `UPDATE member_profiles SET ${fields.join(', ')} WHERE id = $${params.length}`,
      params,
    );
  }

  if (payload.vehicle) {
    const existing = await query(
      `SELECT id FROM vehicles WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_primary DESC LIMIT 1`,
      [userId],
    );
    const v = payload.vehicle;
    if (existing.rows[0]) {
      await query(
        `UPDATE vehicles SET manufacturer=$1, model=$2, model_year=$3, vin=$4, image_url=COALESCE($5, image_url), updated_at=NOW()
         WHERE id=$6`,
        [v.manufacturer, v.model, v.year || null, v.vin || null, v.image || null, existing.rows[0].id],
      );
    } else if (v.manufacturer && v.model) {
      await query(
        `INSERT INTO vehicles (user_id, manufacturer, model, model_year, vin, image_url, is_primary)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE)`,
        [userId, v.manufacturer, v.model, v.year || null, v.vin || null, v.image || null],
      );
    }
  }

  if (payload.social) {
    for (const platform of ['instagram', 'facebook', 'tiktok']) {
      if (payload.social[platform] !== undefined) {
        await query(
          `INSERT INTO social_links (user_id, platform, handle_or_url)
           VALUES ($1,$2,$3)
           ON CONFLICT (user_id, platform) DO UPDATE SET handle_or_url = EXCLUDED.handle_or_url, updated_at = NOW()`,
          [userId, platform, payload.social[platform] || ''],
        );
      }
    }
  }

  if (payload.emergencyContact) {
    const existing = await query(`SELECT id FROM emergency_contacts WHERE user_id = $1 LIMIT 1`, [
      userId,
    ]);
    if (existing.rows[0]) {
      await query(`UPDATE emergency_contacts SET phone=$1, updated_at=NOW() WHERE id=$2`, [
        payload.emergencyContact,
        existing.rows[0].id,
      ]);
    } else {
      await query(`INSERT INTO emergency_contacts (user_id, phone) VALUES ($1,$2)`, [
        userId,
        payload.emergencyContact,
      ]);
    }
  }

  if (payload.notificationPrefs) {
    await query(
      `INSERT INTO notification_preferences (user_id, trips, events, club)
       VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE))
       ON CONFLICT (user_id) DO UPDATE SET
         trips = COALESCE($2, notification_preferences.trips),
         events = COALESCE($3, notification_preferences.events),
         club = COALESCE($4, notification_preferences.club),
         updated_at = NOW()`,
      [
        userId,
        payload.notificationPrefs.trips,
        payload.notificationPrefs.events,
        payload.notificationPrefs.club,
      ],
    );
  }

  await writeAudit({
    actorId: userId,
    action: 'member.profile.update',
    entityType: 'member_profiles',
    entityId: userId,
    req,
  });

  return getMemberById(userId, { id: userId, roles: [], permissions: [] });
}

async function setMemberStatus(memberId, { status, reason }, actor, req) {
  const allowed = ['approved', 'rejected', 'suspended', 'pending'];
  if (!allowed.includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'Invalid member status');
  }

  if (!hasPermission(actor, 'members.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage member status');
  }

  const existing = await query(
    `SELECT * FROM member_profiles WHERE id = $1 AND deleted_at IS NULL`,
    [memberId],
  );
  if (!existing.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Member not found');

  if (memberId === actor.id && status === 'suspended') {
    throw new AppError(400, 'INVALID', 'You cannot deactivate your own account');
  }

  const sets = [`status = $1`];
  const params = [status];

  if (status === 'approved') {
    params.push(actor.id);
    sets.push(
      `approved_by = $${params.length}`,
      'approved_at = NOW()',
      'rejected_at = NULL',
      'suspended_at = NULL',
      'suspension_reason = NULL',
    );
  } else if (status === 'rejected') {
    params.push(actor.id, reason || null);
    sets.push(
      `rejected_by = $${params.length - 1}`,
      'rejected_at = NOW()',
      `rejection_reason = $${params.length}`,
    );
  } else if (status === 'suspended') {
    params.push(actor.id, reason || null);
    sets.push(
      `suspended_by = $${params.length - 1}`,
      'suspended_at = NOW()',
      `suspension_reason = $${params.length}`,
    );
  }

  params.push(memberId);
  await query(`UPDATE member_profiles SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

  // Deactivate: invalidate sessions so protected APIs stop working immediately
  if (status === 'suspended') {
    try {
      const admin = getAdminClient();
      if (admin && typeof admin.auth.admin.signOut === 'function') {
        await admin.auth.admin.signOut(memberId, 'global');
      }
    } catch {
      // non-fatal — status already blocked by requireApprovedMember
    }
  }

  await writeAudit({
    actorId: actor.id,
    action: `member.status.${status}`,
    entityType: 'member_profiles',
    entityId: memberId,
    metadata: { reason: reason || null },
    req,
  });

  await createNotification({
    userId: memberId,
    type: 'admin',
    title:
      status === 'suspended'
        ? 'Account deactivated'
        : status === 'approved' && existing.rows[0].status === 'suspended'
          ? 'Account reactivated'
          : `Membership ${status}`,
    body:
      status === 'approved'
        ? existing.rows[0].status === 'suspended'
          ? 'Your Keepers Adventures account has been reactivated.'
          : 'Your Keepers Adventures membership has been approved.'
        : status === 'rejected'
          ? 'Your membership application was rejected.'
          : status === 'suspended'
            ? 'Your account has been deactivated by an Admin.'
            : 'Your membership status was updated.',
    data: { status },
  });

  cachePresets.member(`member.status.${status}`);
  return getMemberById(memberId, actor);
}

const ASSIGNABLE_BY_ROLES_ASSIGN = new Set([
  'member',
  'pre_marshall',
  'marshall',
]);

function assertCanManageRole(actor, roleCode, action) {
  if (!hasPermission(actor, 'roles.assign') && !hasPermission(actor, 'admins.manage')) {
    throw new AppError(403, 'FORBIDDEN', `Cannot ${action} roles`);
  }
  if (roleCode === 'super_admin') {
    if (!(actor.roles || []).includes('super_admin')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can manage super_admin');
    }
    return;
  }
  if (roleCode === 'admin') {
    if (!hasPermission(actor, 'admins.manage') && !(actor.roles || []).includes('super_admin')) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot manage admin role');
    }
    return;
  }
  if (!ASSIGNABLE_BY_ROLES_ASSIGN.has(roleCode)) {
    throw new AppError(400, 'INVALID_ROLE', 'Unknown or unsupported role');
  }
  if (!hasPermission(actor, 'roles.assign')) {
    throw new AppError(403, 'FORBIDDEN', `Cannot ${action} this role`);
  }
}

async function assignRole(memberId, roleCode, actor, req) {
  const role = await query(`SELECT * FROM roles WHERE code = $1`, [roleCode]);
  if (!role.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Role not found');

  assertCanManageRole(actor, roleCode, 'assign');

  // Prevent self-escalation to admin without admins.manage
  if (
    memberId === actor.id &&
    ['admin', 'super_admin'].includes(roleCode) &&
    !hasPermission(actor, 'admins.manage') &&
    !(actor.roles || []).includes('super_admin')
  ) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot escalate your own privileges');
  }

  await query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, role_id) DO NOTHING`,
    [memberId, role.rows[0].id, actor.id],
  );

  await writeAudit({
    actorId: actor.id,
    action: 'member.role.assign',
    entityType: 'user_roles',
    entityId: memberId,
    metadata: { role: roleCode },
    req,
  });

  return getMemberById(memberId, actor);
}

async function removeRole(memberId, roleCode, actor, req) {
  const role = await query(`SELECT * FROM roles WHERE code = $1`, [roleCode]);
  if (!role.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Role not found');

  assertCanManageRole(actor, roleCode, 'remove');

  if (roleCode === 'admin' || roleCode === 'super_admin') {
    const admins = await query(
      `SELECT COUNT(*)::int AS n
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code IN ('admin', 'super_admin')`,
    );
    if (admins.rows[0].n <= 1) {
      throw new AppError(409, 'LAST_ADMIN', 'Cannot remove the last admin role');
    }
  }

  await query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [
    memberId,
    role.rows[0].id,
  ]);

  await writeAudit({
    actorId: actor.id,
    action: 'member.role.remove',
    entityType: 'user_roles',
    entityId: memberId,
    metadata: { role: roleCode },
    req,
  });

  return getMemberById(memberId, actor);
}

async function directory({ q, membership, page = 1, limit = 50 }) {
  return listMembers({ q, membership, status: 'approved', page, limit });
}

async function getDeletionImpact(memberId, actor) {
  if (!hasPermission(actor, 'members.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot inspect deletion impact');
  }

  const member = await query(
    `SELECT mp.*,
            COALESCE(
              (SELECT json_agg(json_build_object('code', r.code, 'name', r.name))
               FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = mp.id),
              '[]'::json
            ) AS roles
     FROM member_profiles mp
     WHERE mp.id = $1 AND mp.deleted_at IS NULL`,
    [memberId],
  );
  if (!member.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Member not found');
  const mp = member.rows[0];

  const ownedTrips = await query(
    `SELECT t.id, t.title, t.trip_date, t.status, t.organizer_id, t.created_by,
            (SELECT COUNT(*)::int FROM trip_registrations tr
             WHERE tr.trip_id = t.id AND tr.status IN ('registered','pending','waitlist')) AS active_regs
     FROM trips t
     WHERE t.deleted_at IS NULL
       AND (t.created_by = $1 OR t.organizer_id = $1)
     ORDER BY t.trip_date DESC`,
    [memberId],
  );

  const assignments = await query(
    `SELECT a.id, a.trip_id, t.title, t.trip_date, t.status
     FROM trip_pre_marshall_assignments a
     JOIN trips t ON t.id = a.trip_id AND t.deleted_at IS NULL
     WHERE a.user_id = $1
     ORDER BY t.trip_date DESC`,
    [memberId],
  );

  const regs = await query(
    `SELECT COUNT(*)::int AS n FROM trip_registrations
     WHERE user_id = $1 AND status IN ('registered','pending','waitlist')`,
    [memberId],
  );
  const upgrades = await query(
    `SELECT COUNT(*)::int AS n FROM membership_upgrade_requests
     WHERE member_id = $1 AND status = 'pending'`,
    [memberId],
  );

  const eligibleOrganizers = await query(
    `SELECT mp.id, mp.first_name, mp.last_name, mp.username,
            COALESCE(
              (SELECT json_agg(r.code)
               FROM user_roles ur JOIN roles r ON r.id = ur.role_id
               WHERE ur.user_id = mp.id
                 AND r.code IN ('marshall','admin','super_admin')),
              '[]'::json
            ) AS role_codes
     FROM member_profiles mp
     WHERE mp.deleted_at IS NULL
       AND mp.status = 'approved'
       AND mp.id <> $1
       AND EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = mp.id
           AND r.code IN ('marshall','admin','super_admin')
       )
     ORDER BY mp.first_name, mp.last_name
     LIMIT 100`,
    [memberId],
  );

  return {
    member: {
      id: mp.id,
      name: `${mp.first_name} ${mp.last_name}`.trim(),
      email: mp.email,
      username: mp.username,
      status: mp.status,
      roles: mp.roles || [],
    },
    ownedTrips: ownedTrips.rows.map((t) => ({
      id: t.id,
      title: t.title,
      date: t.trip_date,
      status: t.status,
      organizerId: t.organizer_id,
      createdBy: t.created_by,
      activeRegistrations: t.active_regs,
      relation:
        t.created_by === memberId && t.organizer_id === memberId
          ? 'created_and_organized'
          : t.created_by === memberId
            ? 'created'
            : 'organized',
    })),
    preMarshallAssignments: assignments.rows.map((a) => ({
      id: a.id,
      tripId: a.trip_id,
      title: a.title,
      date: a.trip_date,
      status: a.status,
    })),
    activeRegistrations: regs.rows[0].n,
    pendingUpgrades: upgrades.rows[0].n,
    eligibleOrganizers: eligibleOrganizers.rows.map((m) => ({
      id: m.id,
      name: `${m.first_name} ${m.last_name}`.trim(),
      username: m.username,
      roles: m.role_codes || [],
    })),
    retentionNotes: [
      'Attendance and rating history remain attached to trip records for club history.',
      'Active registrations for this member will be cancelled.',
      'Pending upgrade recommendations for this member will be withdrawn.',
      'Pre-Marshall drive assignments for this member will be removed.',
      'Owned/organized trips are NOT auto-deleted — choose reassign, cancel, or retain under Admin.',
      'Personal profile data will be anonymized and the Auth user removed.',
    ],
  };
}

async function permanentlyDeleteMember(memberId, payload, actor, req) {
  if (!hasPermission(actor, 'members.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot permanently delete members');
  }
  if (memberId === actor.id) {
    throw new AppError(400, 'INVALID', 'You cannot permanently delete your own account');
  }

  const admin = getAdminClient();
  if (!admin) {
    throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured');
  }

  const impact = await getDeletionImpact(memberId, actor);
  const confirmEmail = (payload.confirmEmail || '').trim().toLowerCase();
  if (!confirmEmail || confirmEmail !== String(impact.member.email || '').toLowerCase()) {
    throw new AppError(
      400,
      'CONFIRMATION_REQUIRED',
      'Type the member email exactly to confirm permanent deletion',
    );
  }

  const roleCodes = (impact.member.roles || []).map((r) => r.code);
  if (roleCodes.includes('super_admin') && !(actor.roles || []).includes('super_admin')) {
    throw new AppError(403, 'FORBIDDEN', 'Only a Super Admin can delete a Super Admin');
  }
  if (
    roleCodes.includes('admin') &&
    !hasPermission(actor, 'admins.manage') &&
    !(actor.roles || []).includes('super_admin')
  ) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot permanently delete an Admin account');
  }

  if (roleCodes.includes('admin') || roleCodes.includes('super_admin')) {
    const admins = await query(
      `SELECT COUNT(*)::int AS n
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       JOIN member_profiles mp ON mp.id = ur.user_id AND mp.deleted_at IS NULL
       WHERE r.code IN ('admin', 'super_admin')`,
    );
    if (admins.rows[0].n <= 1) {
      throw new AppError(409, 'LAST_ADMIN', 'Cannot delete the last admin account');
    }
  }

  const tripActions = Array.isArray(payload.tripActions) ? payload.tripActions : [];
  const actionByTrip = new Map(tripActions.map((a) => [a.tripId, a]));

  if (impact.ownedTrips.length > 0) {
    for (const trip of impact.ownedTrips) {
      const action = actionByTrip.get(trip.id);
      if (!action || !['reassign', 'cancel', 'retain_admin'].includes(action.action)) {
        throw new AppError(
          400,
          'TRIP_ACTION_REQUIRED',
          `Choose reassign, cancel, or retain_admin for trip “${trip.title}”`,
          { tripId: trip.id },
        );
      }
      if (action.action === 'reassign') {
        if (!action.newOrganizerId) {
          throw new AppError(400, 'VALIDATION_ERROR', 'newOrganizerId required for reassignment');
        }
        const eligible = impact.eligibleOrganizers.some((m) => m.id === action.newOrganizerId);
        if (!eligible) {
          throw new AppError(400, 'INVALID_ORGANIZER', 'Selected organizer is not eligible');
        }
      }
    }
  }

  const decisions = [];
  /** @type {Array<{ tripId: string, title: string, userIds: string[] }>} */
  const cancelNotify = [];

  await withTransaction(async (client) => {
    const locked = await client.query(
      `SELECT * FROM member_profiles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [memberId],
    );
    if (!locked.rows[0]) {
      throw new AppError(404, 'NOT_FOUND', 'Member not found or already deleted');
    }

    for (const trip of impact.ownedTrips) {
      const action = actionByTrip.get(trip.id);
      if (action.action === 'reassign') {
        await client.query(
          `UPDATE trips SET
             organizer_id = $1,
             created_by = CASE WHEN created_by = $2 THEN $1 ELSE created_by END,
             updated_by = $3,
             updated_at = NOW()
           WHERE id = $4 AND deleted_at IS NULL`,
          [action.newOrganizerId, memberId, actor.id, trip.id],
        );
        decisions.push({
          tripId: trip.id,
          action: 'reassign',
          newOrganizerId: action.newOrganizerId,
        });
      } else if (action.action === 'cancel') {
        const participants = await client.query(
          `SELECT user_id FROM trip_registrations
           WHERE trip_id = $1 AND status IN ('registered','waitlist','pending')
             AND user_id <> $2`,
          [trip.id, memberId],
        );
        await client.query(
          `UPDATE trip_registrations
           SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
           WHERE trip_id = $1 AND status IN ('registered','waitlist','pending')`,
          [trip.id],
        );
        await client.query(
          `UPDATE trips SET
             status = 'cancelled',
             cancelled_at = NOW(),
             cancellation_reason = COALESCE(cancellation_reason, $1),
             organizer_id = $2,
             created_by = CASE WHEN created_by = $3 THEN $2 ELSE created_by END,
             updated_by = $2,
             updated_at = NOW()
           WHERE id = $4 AND deleted_at IS NULL`,
          ['Organizer account permanently deleted', actor.id, memberId, trip.id],
        );
        decisions.push({ tripId: trip.id, action: 'cancel' });
        cancelNotify.push({
          tripId: trip.id,
          title: trip.title,
          userIds: participants.rows.map((r) => r.user_id),
        });
      } else if (action.action === 'retain_admin') {
        await client.query(
          `UPDATE trips SET
             organizer_id = $1,
             created_by = CASE WHEN created_by = $2 THEN $1 ELSE created_by END,
             updated_by = $1,
             updated_at = NOW()
           WHERE id = $3 AND deleted_at IS NULL`,
          [actor.id, memberId, trip.id],
        );
        decisions.push({ tripId: trip.id, action: 'retain_admin', newOrganizerId: actor.id });
      }
    }

    // Reassign NOT NULL auth.users FKs so Auth deletion is not blocked
    await client.query(
      `UPDATE trip_attendance SET marked_by = $2 WHERE marked_by = $1`,
      [memberId, actor.id],
    );
    await client.query(
      `UPDATE trip_rating_history SET changed_by = $2 WHERE changed_by = $1`,
      [memberId, actor.id],
    );

    // Null nullable auth.users FKs that would block auth.users deletion
    await client.query(
      `UPDATE trips SET created_by = NULL WHERE created_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE trips SET updated_by = NULL WHERE updated_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE trip_pre_marshall_assignments SET assigned_by = NULL WHERE assigned_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE user_roles SET assigned_by = NULL WHERE assigned_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE member_profiles SET approved_by = NULL WHERE approved_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE member_profiles SET rejected_by = NULL WHERE rejected_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE member_profiles SET suspended_by = NULL WHERE suspended_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE trip_registrations SET reviewed_by = NULL WHERE reviewed_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE membership_upgrade_requests SET reviewed_by = NULL WHERE reviewed_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE membership_history SET changed_by = NULL WHERE changed_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE trip_media SET uploaded_by = NULL WHERE uploaded_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE member_media SET uploaded_by = NULL WHERE uploaded_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE hero_slides SET created_by = NULL WHERE created_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE gallery_items SET created_by = NULL WHERE created_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE sponsors SET created_by = NULL WHERE created_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE sponsors SET updated_by = NULL WHERE updated_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE events SET created_by = NULL WHERE created_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE announcements SET created_by = NULL WHERE created_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE announcements SET updated_by = NULL WHERE updated_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE documents SET updated_by = NULL WHERE updated_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE app_settings SET updated_by = NULL WHERE updated_by = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE audit_logs SET actor_id = NULL WHERE actor_id = $1`,
      [memberId],
    );

    await client.query(`DELETE FROM trip_pre_marshall_assignments WHERE user_id = $1`, [
      memberId,
    ]);
    await client.query(
      `UPDATE trip_registrations
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
       WHERE user_id = $1 AND status IN ('registered', 'waitlist', 'pending')`,
      [memberId],
    );
    await client.query(
      `UPDATE membership_upgrade_requests
       SET status = 'withdrawn', updated_at = NOW()
       WHERE member_id = $1 AND status = 'pending'`,
      [memberId],
    );
    await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [memberId]);
    await client.query(`DELETE FROM social_links WHERE user_id = $1`, [memberId]);
    await client.query(`DELETE FROM emergency_contacts WHERE user_id = $1`, [memberId]);
    await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [memberId]);
    await client.query(`DELETE FROM notifications WHERE user_id = $1`, [memberId]);
    await client.query(
      `UPDATE vehicles SET deleted_at = NOW(), image_url = NULL WHERE user_id = $1`,
      [memberId],
    );
    await client.query(
      `UPDATE member_media SET deleted_at = NOW() WHERE user_id = $1 AND deleted_at IS NULL`,
      [memberId],
    );
    await client.query(
      `UPDATE member_profiles SET
         deleted_at = NOW(),
         status = 'suspended',
         email = $2,
         phone = NULL,
         avatar_url = NULL,
         first_name = 'Deleted',
         last_name = 'Member',
         username = $3,
         bio = NULL
       WHERE id = $1`,
      [memberId, `deleted+${memberId}@keepers.invalid`, `deleted_${memberId.slice(0, 8)}`],
    );
  });

  // Best-effort participant notifications for cancelled organizer trips
  for (const item of cancelNotify) {
    for (const userId of item.userIds) {
      try {
        await createNotification({
          userId,
          type: 'trip',
          title: 'Drive cancelled',
          body: `“${item.title}” was cancelled because the organizer account was permanently deleted.`,
          data: { tripId: item.tripId, reason: 'organizer_deleted' },
        });
      } catch {
        // non-fatal
      }
    }
  }

  let storageFailed = false;
  try {
    for (const bucket of ['avatars', 'vehicles', 'gallery', 'documents', 'trips']) {
      const listed = await admin.storage.from(bucket).list(memberId, { limit: 100 });
      if (listed.data?.length) {
        const paths = listed.data.map((f) => `${memberId}/${f.name}`);
        const { error } = await admin.storage.from(bucket).remove(paths);
        if (error) storageFailed = true;
      }
    }
  } catch {
    storageFailed = true;
  }

  try {
    if (typeof admin.auth.admin.signOut === 'function') {
      await admin.auth.admin.signOut(memberId, 'global');
    }
  } catch {
    // continue — deleteUser is authoritative
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(memberId);
  if (deleteError) {
    await writeAudit({
      actorId: actor.id,
      action: 'member.permanent_delete.partial',
      entityType: 'member_profiles',
      entityId: memberId,
      metadata: {
        roleCodes,
        decisions,
        authDeleteError: deleteError.message,
        storageFailed,
      },
      req,
    });
    throw new AppError(
      500,
      'DELETE_PARTIAL',
      `Profile scrubbed but Auth deletion failed: ${deleteError.message}`,
    );
  }

  await writeAudit({
    actorId: actor.id,
    action: 'member.permanent_delete',
    entityType: 'member_profiles',
    entityId: memberId,
    metadata: {
      roleCodes,
      decisions,
      storageFailed,
      previousEmailDomain: String(impact.member.email || '').split('@')[1] || null,
    },
    req,
  });

  cachePresets.member('member.permanent_delete');
  cachePresets.trip('member.permanent_delete');

  return {
    id: memberId,
    permanentlyDeleted: true,
    tripDecisions: decisions,
    storageCleanupPending: storageFailed,
  };
}

module.exports = {
  listMembers,
  getMemberById,
  updateOwnProfile,
  setMemberStatus,
  assignRole,
  removeRole,
  directory,
  getDeletionImpact,
  permanentlyDeleteMember,
};
