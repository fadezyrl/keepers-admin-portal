const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { getDashboardStats } = require('../services/dashboardService');
const { authenticate, requirePermission } = require('../middleware/auth');
const { query } = require('../config/db');

const router = express.Router();

router.get(
  '/stats',
  authenticate,
  requirePermission('dashboard.read'),
  asyncHandler(async (_req, res) => {
    const data = await getDashboardStats();
    return ok(res, data);
  }),
);

router.get(
  '/roles',
  authenticate,
  requirePermission('roles.assign', 'dashboard.read'),
  asyncHandler(async (_req, res) => {
    const roles = await query(`SELECT id, code, name, description FROM roles ORDER BY name`);
    const permissions = await query(
      `SELECT id, code, name, description FROM permissions ORDER BY code`,
    );
    const grants = await query(
      `SELECT r.code AS role_code, p.code AS permission_code
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
       ORDER BY r.code, p.code`,
    );
    const counts = await query(
      `SELECT r.code AS role_code, COUNT(ur.user_id)::int AS member_count
       FROM roles r
       LEFT JOIN user_roles ur ON ur.role_id = r.id
       LEFT JOIN member_profiles mp
         ON mp.id = ur.user_id AND mp.deleted_at IS NULL
       GROUP BY r.code`,
    );
    const uniqueRes = await query(
      `SELECT COUNT(DISTINCT ur.user_id)::int AS unique_members
       FROM user_roles ur
       JOIN member_profiles mp ON mp.id = ur.user_id AND mp.deleted_at IS NULL`,
    );
    const organized = await query(
      `SELECT organizer_id AS user_id, COUNT(*)::int AS trip_count
       FROM trips
       WHERE deleted_at IS NULL AND organizer_id IS NOT NULL
       GROUP BY organizer_id`,
    );
    const assigned = await query(
      `SELECT a.user_id,
              COUNT(*)::int AS drive_count,
              COALESCE(
                json_agg(t.title ORDER BY t.trip_date DESC)
                  FILTER (WHERE t.id IS NOT NULL),
                '[]'::json
              ) AS titles
       FROM trip_pre_marshall_assignments a
       JOIN trips t ON t.id = a.trip_id AND t.deleted_at IS NULL
       GROUP BY a.user_id`,
    );

    const permissionsByRole = {};
    for (const row of grants.rows) {
      if (!permissionsByRole[row.role_code]) permissionsByRole[row.role_code] = [];
      permissionsByRole[row.role_code].push(row.permission_code);
    }
    const memberCountByRole = {};
    for (const row of counts.rows) {
      memberCountByRole[row.role_code] = row.member_count;
    }
    const organizedTripCountByUserId = {};
    for (const row of organized.rows) {
      organizedTripCountByUserId[row.user_id] = row.trip_count;
    }
    const assignedDrivesByUserId = {};
    for (const row of assigned.rows) {
      const titles = Array.isArray(row.titles) ? row.titles : [];
      assignedDrivesByUserId[row.user_id] = {
        count: row.drive_count,
        titles: titles.slice(0, 4),
      };
    }

    return ok(res, {
      roles: roles.rows.map((r) => ({
        ...r,
        permissions: permissionsByRole[r.code] || [],
        memberCount: memberCountByRole[r.code] || 0,
      })),
      permissions: permissions.rows,
      permissionsByRole,
      memberCountByRole,
      uniqueMembers: uniqueRes.rows[0]?.unique_members || 0,
      organizedTripCountByUserId,
      assignedDrivesByUserId,
    });
  }),
);

router.get(
  '/membership-levels',
  authenticate,
  asyncHandler(async (_req, res) => {
    const levels = await query(
      `SELECT id, code, name, display_name AS "displayName",
              rank, rank_group AS "rankGroup", level_number AS "levelNumber",
              description,
              min_completed_trips AS "minCompletedTrips",
              min_average_rating AS "minAverageRating"
       FROM membership_levels WHERE is_active = TRUE ORDER BY rank`,
    );
    return ok(res, levels.rows);
  }),
);

module.exports = router;
