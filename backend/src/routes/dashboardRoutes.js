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
    const permissionsByRole = {};
    for (const row of grants.rows) {
      if (!permissionsByRole[row.role_code]) permissionsByRole[row.role_code] = [];
      permissionsByRole[row.role_code].push(row.permission_code);
    }
    return ok(res, {
      roles: roles.rows.map((r) => ({
        ...r,
        permissions: permissionsByRole[r.code] || [],
      })),
      permissions: permissions.rows,
      permissionsByRole,
    });
  }),
);

router.get(
  '/membership-levels',
  authenticate,
  asyncHandler(async (_req, res) => {
    const levels = await query(
      `SELECT id, code, name, rank, description FROM membership_levels WHERE is_active = TRUE ORDER BY rank`,
    );
    return ok(res, levels.rows);
  }),
);

module.exports = router;
