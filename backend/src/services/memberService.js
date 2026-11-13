const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const { createNotification } = require('./notificationService');
const { presets: cachePresets } = require('./cacheInvalidationService');
const { hasPermission } = require('../middleware/auth');

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
  const where = ['mp.deleted_at IS NULL'];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(
      `(mp.first_name ILIKE $${params.length} OR mp.last_name ILIKE $${params.length} OR mp.username ILIKE $${params.length} OR mp.email ILIKE $${params.length})`,
    );
  }
  if (status) {
    params.push(status);
    where.push(`mp.status = $${params.length}`);
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
      status: row.status,
      completedTrips: row.completed_trips,
      membership: membershipLabel(row),
      membershipCode: row.membership_code,
      roles: row.roles || [],
      vehicle: row.vehicle,
      createdAt: row.created_at,
    })),
    pagination: {
      page,
      limit,
      total: countRes.rows[0].total,
    },
  };
}

async function getMemberById(id, viewer) {
  const res = await query(
    `SELECT mp.*, ml.code AS membership_code, ml.name AS membership_name, ml.rank AS membership_rank
     FROM member_profiles mp
     LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
     WHERE mp.id = $1 AND mp.deleted_at IS NULL`,
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
    status: mp.status,
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

  const existing = await query(`SELECT * FROM member_profiles WHERE id = $1`, [memberId]);
  if (!existing.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Member not found');

  const sets = [`status = $1`];
  const params = [status];

  if (status === 'approved') {
    params.push(actor.id);
    sets.push(`approved_by = $${params.length}`, 'approved_at = NOW()', 'rejected_at = NULL', 'suspended_at = NULL');
  } else if (status === 'rejected') {
    params.push(actor.id, reason || null);
    sets.push(`rejected_by = $${params.length - 1}`, 'rejected_at = NOW()', `rejection_reason = $${params.length}`);
  } else if (status === 'suspended') {
    params.push(actor.id, reason || null);
    sets.push(`suspended_by = $${params.length - 1}`, 'suspended_at = NOW()', `suspension_reason = $${params.length}`);
  }

  params.push(memberId);
  await query(`UPDATE member_profiles SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

  await writeAudit({
    actorId: actor.id,
    action: `member.status.${status}`,
    entityType: 'member_profiles',
    entityId: memberId,
    metadata: { reason },
    req,
  });

  await createNotification({
    userId: memberId,
    type: 'admin',
    title: `Membership ${status}`,
    body:
      status === 'approved'
        ? 'Your Keepers Adventures membership has been approved.'
        : status === 'rejected'
          ? 'Your membership application was rejected.'
          : status === 'suspended'
            ? 'Your membership has been suspended.'
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

module.exports = {
  listMembers,
  getMemberById,
  updateOwnProfile,
  setMemberStatus,
  assignRole,
  removeRole,
  directory,
};
