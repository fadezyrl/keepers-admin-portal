const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { hasPermission } = require('../middleware/auth');
const { formatLevel, RANK_GROUP_LABELS } = require('./progressionLevels');
const memberProgressService = require('./memberProgressService');

async function assertProgressionAdmin(actor) {
  if (
    !hasPermission(actor, 'upgrades.review') &&
    !hasPermission(actor, 'members.manage') &&
    !hasPermission(actor, 'dashboard.read')
  ) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot access driver progression management');
  }
}

async function getHierarchy() {
  const res = await query(
    `SELECT id, code, name, display_name, rank, rank_group, level_number,
            description, is_active, min_completed_trips, min_average_rating
     FROM membership_levels
     WHERE is_active = TRUE
       AND rank_group IS NOT NULL
     ORDER BY rank ASC`,
  );
  const levels = res.rows.map(formatLevel);
  const groups = Object.keys(RANK_GROUP_LABELS).map((code) => ({
    code,
    label: RANK_GROUP_LABELS[code],
    levels: levels.filter((l) => l.rankGroup === code),
  }));
  return { levels, groups, totalLevels: levels.length };
}

async function getDashboardStats(actor) {
  await assertProgressionAdmin(actor);

  const [byRank, byLevel, pendingUpgrades, pendingRole, recentPromotions] =
    await Promise.all([
      query(
        `SELECT ml.rank_group, COUNT(*)::INT AS count
         FROM member_profiles mp
         JOIN membership_levels ml ON ml.id = mp.membership_level_id
         WHERE mp.deleted_at IS NULL
           AND mp.status = 'approved'
           AND ml.rank_group IS NOT NULL
         GROUP BY ml.rank_group`,
      ),
      query(
        `SELECT ml.id, ml.code, ml.display_name, ml.name, ml.rank, ml.rank_group,
                ml.level_number, COUNT(mp.id)::INT AS count
         FROM membership_levels ml
         LEFT JOIN member_profiles mp
           ON mp.membership_level_id = ml.id
          AND mp.deleted_at IS NULL
          AND mp.status = 'approved'
         WHERE ml.is_active = TRUE AND ml.rank_group IS NOT NULL
         GROUP BY ml.id
         ORDER BY ml.rank ASC`,
      ),
      query(
        `SELECT COUNT(*)::INT AS n FROM membership_upgrade_requests WHERE status = 'pending'`,
      ),
      query(
        `SELECT requested_role_code, COUNT(*)::INT AS n
         FROM role_promotion_requests
         WHERE status = 'pending'
         GROUP BY requested_role_code`,
      ),
      query(
        `SELECT mh.id, mh.created_at, mh.change_reason,
                mp.id AS member_id, mp.first_name, mp.last_name, mp.email,
                fl.display_name AS from_level, tl.display_name AS to_level,
                tl.rank_group AS to_rank_group
         FROM membership_history mh
         JOIN member_profiles mp ON mp.id = mh.member_id
         LEFT JOIN membership_levels fl ON fl.id = mh.from_level_id
         JOIN membership_levels tl ON tl.id = mh.to_level_id
         WHERE mp.deleted_at IS NULL
         ORDER BY mh.created_at DESC
         LIMIT 15`,
      ),
    ]);

  const membersByRank = Object.keys(RANK_GROUP_LABELS).map((code) => ({
    code,
    label: RANK_GROUP_LABELS[code],
    count: Number(byRank.rows.find((r) => r.rank_group === code)?.count || 0),
  }));

  const rolePending = { pre_marshall: 0, marshall: 0 };
  for (const row of pendingRole.rows) {
    if (rolePending[row.requested_role_code] !== undefined) {
      rolePending[row.requested_role_code] = Number(row.n);
    }
  }

  return {
    membersByRank,
    membersByLevel: byLevel.rows.map((r) => ({
      ...formatLevel(r),
      memberCount: Number(r.count || 0),
    })),
    pendingUpgradeRequests: Number(pendingUpgrades.rows[0]?.n || 0),
    pendingPreMarshallRolePromotions: rolePending.pre_marshall,
    pendingMarshallRolePromotions: rolePending.marshall,
    recentlyPromoted: recentPromotions.rows.map((r) => ({
      id: r.id,
      memberId: r.member_id,
      memberName: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      email: r.email,
      fromLevel: r.from_level,
      toLevel: r.to_level,
      toRankGroup: r.to_rank_group,
      reason: r.change_reason,
      createdAt: r.created_at,
    })),
  };
}

async function listMemberProgression(actor, {
  q = '',
  rankGroup = null,
  levelCode = null,
  role = null,
  page = 1,
  limit = 25,
} = {}) {
  await assertProgressionAdmin(actor);

  const params = [];
  const where = [`mp.deleted_at IS NULL`];

  if (q) {
    params.push(`%${String(q).trim().toLowerCase()}%`);
    where.push(
      `(lower(mp.first_name) LIKE $${params.length}
        OR lower(mp.last_name) LIKE $${params.length}
        OR lower(mp.email) LIKE $${params.length}
        OR lower(mp.username) LIKE $${params.length}
        OR lower(concat(mp.first_name, ' ', mp.last_name)) LIKE $${params.length})`,
    );
  }
  if (rankGroup) {
    params.push(rankGroup);
    where.push(`ml.rank_group = $${params.length}`);
  }
  if (levelCode) {
    params.push(levelCode);
    where.push(`ml.code = $${params.length}`);
  }
  if (role) {
    params.push(role);
    where.push(
      `EXISTS (
         SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = mp.id AND r.code = $${params.length}
       )`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, (page - 1) * limit);

  const [rows, countRes] = await Promise.all([
    query(
      `SELECT mp.id, mp.first_name, mp.last_name, mp.email, mp.username, mp.status,
              mp.completed_trips, mp.last_progression_at, mp.created_at,
              ml.id AS level_id, ml.code AS level_code, ml.display_name AS level_name,
              ml.rank AS level_rank, ml.rank_group, ml.level_number, ml.description AS level_description,
              (
                SELECT COALESCE(json_agg(json_build_object('code', r.code, 'name', r.name)), '[]'::json)
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = mp.id
              ) AS roles,
              (
                SELECT COUNT(*)::INT FROM membership_upgrade_requests ur
                WHERE ur.member_id = mp.id AND ur.status = 'pending'
              ) AS pending_upgrades,
              (
                SELECT COUNT(*)::INT FROM role_promotion_requests rpr
                WHERE rpr.member_id = mp.id AND rpr.status = 'pending'
              ) AS pending_role_promotions
       FROM member_profiles mp
       LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
       ${whereSql}
       ORDER BY ml.rank ASC NULLS LAST, mp.last_name ASC, mp.first_name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    query(
      `SELECT COUNT(*)::INT AS n
       FROM member_profiles mp
       LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
       ${whereSql}`,
      params.slice(0, -2),
    ),
  ]);

  return {
    items: rows.rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      email: r.email,
      username: r.username,
      status: r.status,
      completedTrips: Number(r.completed_trips || 0),
      lastProgressionAt: r.last_progression_at,
      createdAt: r.created_at,
      level: r.level_id
        ? formatLevel({
            id: r.level_id,
            code: r.level_code,
            name: r.level_name,
            display_name: r.level_name,
            rank: r.level_rank,
            rank_group: r.rank_group,
            level_number: r.level_number,
            description: r.level_description,
          })
        : null,
      roles: r.roles || [],
      pendingUpgrades: Number(r.pending_upgrades || 0),
      pendingRolePromotions: Number(r.pending_role_promotions || 0),
    })),
    page,
    limit,
    total: Number(countRes.rows[0]?.n || 0),
  };
}

async function getMemberProgressionDetail(actor, memberId) {
  await assertProgressionAdmin(actor);
  const progress = await memberProgressService.getMyProgress(memberId);

  const [rolePromos, pendingUpgrade] = await Promise.all([
    query(
      `SELECT rpr.*, ml.display_name AS trigger_level_name
       FROM role_promotion_requests rpr
       LEFT JOIN membership_levels ml ON ml.id = rpr.trigger_level_id
       WHERE rpr.member_id = $1
       ORDER BY rpr.created_at DESC
       LIMIT 20`,
      [memberId],
    ),
    query(
      `SELECT ur.*, fl.display_name AS from_level_name, tl.display_name AS to_level_name,
              rb.first_name AS recommender_first_name, rb.last_name AS recommender_last_name
       FROM membership_upgrade_requests ur
       LEFT JOIN membership_levels fl ON fl.id = ur.from_level_id
       JOIN membership_levels tl ON tl.id = ur.to_level_id
       JOIN member_profiles rb ON rb.id = ur.recommended_by
       WHERE ur.member_id = $1 AND ur.status = 'pending'
       ORDER BY ur.created_at DESC
       LIMIT 5`,
      [memberId],
    ),
  ]);

  return {
    ...progress,
    rolePromotionRequests: rolePromos.rows.map((r) => ({
      id: r.id,
      currentRole: r.current_role_code,
      requestedRole: r.requested_role_code,
      status: r.status,
      triggerLevelName: r.trigger_level_name,
      reviewNotes: r.review_notes,
      reviewedAt: r.reviewed_at,
      createdAt: r.created_at,
    })),
    pendingUpgradeRequests: pendingUpgrade.rows.map((u) => ({
      id: u.id,
      status: u.status,
      fromLevel: u.from_level_name,
      toLevel: u.to_level_name,
      recommendedBy: `${u.recommender_first_name || ''} ${u.recommender_last_name || ''}`.trim(),
      recommendationNotes: u.recommendation_notes,
      createdAt: u.created_at,
    })),
  };
}

module.exports = {
  getHierarchy,
  getDashboardStats,
  listMemberProgression,
  getMemberProgressionDetail,
};
