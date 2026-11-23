const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const { createNotification, notifyMany } = require('./notificationService');
const { hasPermission } = require('../middleware/auth');
const { clubRoleForLevelCode } = require('./progressionLevels');

async function listAdminUserIds() {
  const res = await query(
    `SELECT DISTINCT ur.user_id
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE r.code IN ('admin', 'super_admin')`,
  );
  return res.rows.map((r) => r.user_id);
}

async function getMemberRoleCodes(client, memberId) {
  const q = client && client.query ? client.query.bind(client) : query;
  const res = await q(
    `SELECT r.code
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [memberId],
  );
  return res.rows.map((r) => r.code);
}

/**
 * After a driving-level upgrade is approved into Pre-Marshall 1 or Marshall 1,
 * open a separate club-role promotion request (never auto-grants the role).
 */
async function maybeCreateRolePromotionFromLevel(client, {
  memberId,
  toLevelCode,
  upgradeRequestId,
  toLevelId,
}) {
  const requestedRole = clubRoleForLevelCode(toLevelCode);
  if (!requestedRole) return null;

  const roles = await getMemberRoleCodes(client, memberId);
  if (roles.includes(requestedRole)) return null;
  // Never create role promo for admins that would imply a downgrade path
  if (roles.includes('admin') || roles.includes('super_admin')) return null;

  const existing = await client.query(
    `SELECT id FROM role_promotion_requests
     WHERE member_id = $1 AND requested_role_code = $2 AND status = 'pending'`,
    [memberId, requestedRole],
  );
  if (existing.rows[0]) return existing.rows[0];

  const currentRole = roles.includes('marshall')
    ? 'marshall'
    : roles.includes('pre_marshall')
      ? 'pre_marshall'
      : 'member';

  const inserted = await client.query(
    `INSERT INTO role_promotion_requests (
       member_id, current_role_code, requested_role_code, status,
       trigger_upgrade_request_id, trigger_level_id
     ) VALUES ($1,$2,$3,'pending',$4,$5)
     RETURNING *`,
    [memberId, currentRole, requestedRole, upgradeRequestId || null, toLevelId || null],
  );
  return inserted.rows[0];
}

async function listRolePromotionRequests({
  status = 'pending',
  requestedRole = null,
  page = 1,
  limit = 50,
} = {}) {
  const params = [];
  const where = [];
  if (status && status !== 'all') {
    params.push(status);
    where.push(`rpr.status = $${params.length}`);
  }
  if (requestedRole) {
    params.push(requestedRole);
    where.push(`rpr.requested_role_code = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, (page - 1) * limit);

  const res = await query(
    `SELECT rpr.*,
            mp.first_name, mp.last_name, mp.email, mp.username,
            ml.name AS trigger_level_name, ml.code AS trigger_level_code,
            rv.first_name AS reviewer_first_name, rv.last_name AS reviewer_last_name
     FROM role_promotion_requests rpr
     JOIN member_profiles mp ON mp.id = rpr.member_id
     LEFT JOIN membership_levels ml ON ml.id = rpr.trigger_level_id
     LEFT JOIN member_profiles rv ON rv.id = rpr.reviewed_by
     ${whereSql}
     ORDER BY rpr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return res.rows;
}

async function reviewRolePromotionRequest(id, { decision, reviewNotes }, actor, req) {
  if (!hasPermission(actor, 'upgrades.review') && !hasPermission(actor, 'roles.assign')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot review club-role promotion requests');
  }
  if (!['approved', 'rejected'].includes(decision)) {
    throw new AppError(400, 'INVALID_DECISION', 'Decision must be approved or rejected');
  }

  const existing = await query(`SELECT * FROM role_promotion_requests WHERE id = $1`, [id]);
  if (!existing.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Role promotion request not found');
  const row = existing.rows[0];

  if (row.status !== 'pending') {
    throw new AppError(409, 'ALREADY_REVIEWED', 'Request already reviewed');
  }
  if (row.member_id === actor.id) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot review your own club-role promotion');
  }

  const memberRoles = await getMemberRoleCodes(null, row.member_id);
  if (memberRoles.includes('admin') || memberRoles.includes('super_admin')) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Admin and Super Admin club roles are not modified by progression role promotions',
    );
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE role_promotion_requests SET
         status = $1, reviewed_by = $2, reviewed_at = NOW(),
         review_notes = $3, updated_at = NOW()
       WHERE id = $4`,
      [decision, actor.id, reviewNotes || null, id],
    );

    if (decision === 'approved') {
      const roleRes = await client.query(
        `SELECT id, code FROM roles WHERE code = $1`,
        [row.requested_role_code],
      );
      if (!roleRes.rows[0]) {
        throw new AppError(500, 'ROLE_MISSING', `Role ${row.requested_role_code} not found`);
      }

      // Preserve member role; add requested club role if missing
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [row.member_id, roleRes.rows[0].id, actor.id],
      );
    }
  });

  await writeAudit({
    actorId: actor.id,
    action: `role_promotion.${decision}`,
    entityType: 'role_promotion_requests',
    entityId: id,
    metadata: {
      memberId: row.member_id,
      requestedRole: row.requested_role_code,
      reviewNotes: reviewNotes || null,
    },
    req,
  });

  const roleLabel =
    row.requested_role_code === 'marshall' ? 'Marshall' : 'Pre-Marshall';

  await createNotification({
    userId: row.member_id,
    type: 'upgrade',
    title:
      decision === 'approved'
        ? `${roleLabel} club role approved`
        : `${roleLabel} club role request declined`,
    body:
      decision === 'approved'
        ? `Your ${roleLabel} club role has been granted. Driving level and club role remain separate.`
        : `Your ${roleLabel} club role request was not approved.`,
    data: {
      rolePromotionRequestId: id,
      decision,
      requestedRole: row.requested_role_code,
      screen: 'keepers://progress',
    },
    idempotencyKey: `role_promo.review.member:${id}:${decision}`,
  });

  return query(`SELECT * FROM role_promotion_requests WHERE id = $1`, [id]).then(
    (r) => r.rows[0],
  );
}

async function notifyAdminsOfRolePromotion(rolePromo) {
  if (!rolePromo?.id) return;
  const adminIds = await listAdminUserIds();
  const roleLabel =
    rolePromo.requested_role_code === 'marshall' ? 'Marshall' : 'Pre-Marshall';
  await notifyMany(
    adminIds.filter((id) => id !== rolePromo.member_id),
    {
      type: 'upgrade',
      title: `${roleLabel} club-role promotion pending`,
      body: `A member reached ${roleLabel} driving progression and needs club-role approval.`,
      data: {
        rolePromotionRequestId: rolePromo.id,
        memberId: rolePromo.member_id,
        requestedRole: rolePromo.requested_role_code,
        screen: 'keepers://notifications',
      },
      idempotencyKey: `role_promo.create:${rolePromo.id}`,
    },
  );
}

module.exports = {
  maybeCreateRolePromotionFromLevel,
  listRolePromotionRequests,
  reviewRolePromotionRequest,
  notifyAdminsOfRolePromotion,
  getMemberRoleCodes,
};
