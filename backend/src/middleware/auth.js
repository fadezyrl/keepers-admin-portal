const { getAdminClient, getAnonClient } = require('../config/supabase');
const { query } = require('../config/db');
const { fail } = require('../utils/response');
const { AppError } = require('../utils/AppError');

async function loadAuthContext(userId) {
  const profileRes = await query(
    `SELECT mp.*, ml.code AS membership_code, ml.name AS membership_name,
            ml.display_name AS membership_display_name,
            ml.rank AS membership_rank, ml.rank_group AS membership_rank_group,
            ml.level_number AS membership_level_number
     FROM member_profiles mp
     LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
     WHERE mp.id = $1 AND mp.deleted_at IS NULL`,
    [userId],
  );

  const profile = profileRes.rows[0] || null;

  const rolesRes = await query(
    `SELECT r.code, r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1`,
    [userId],
  );

  const permsRes = await query(
    `SELECT DISTINCT p.code
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1`,
    [userId],
  );

  return {
    profile,
    roles: rolesRes.rows.map((r) => r.code),
    permissions: permsRes.rows.map((p) => p.code),
  };
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return fail(res, 401, 'UNAUTHORIZED', 'Missing bearer token');
    }

    const client = getAdminClient() || getAnonClient();
    if (!client) {
      return fail(
        res,
        503,
        'AUTH_NOT_CONFIGURED',
        'Supabase Auth is not configured on the server',
      );
    }

    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) {
      return fail(res, 401, 'UNAUTHORIZED', 'Invalid or expired token');
    }

    const ctx = await loadAuthContext(data.user.id);
    req.user = {
      id: data.user.id,
      email: data.user.email,
      authUser: data.user,
      profile: ctx.profile,
      roles: ctx.roles,
      permissions: ctx.permissions,
    };
    req.accessToken = token;
    return next();
  } catch (err) {
    return next(err);
  }
}

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return next();
  }
  return authenticate(req, res, next);
}

function requireApprovedMember(req, res, next) {
  if (!req.user?.profile) {
    return fail(res, 403, 'PROFILE_REQUIRED', 'Member profile not found');
  }
  if (req.user.profile.status === 'pending') {
    return fail(res, 403, 'PENDING_APPROVAL', 'Your membership is pending Admin approval');
  }
  if (req.user.profile.status === 'rejected') {
    return fail(res, 403, 'REJECTED', 'Your membership application was rejected');
  }
  if (req.user.profile.status === 'suspended') {
    return fail(res, 403, 'SUSPENDED', 'Your account has been deactivated');
  }
  if (req.user.profile.deleted_at) {
    return fail(res, 403, 'ACCOUNT_DELETED', 'This account has been permanently deleted');
  }
  if (req.user.profile.status !== 'approved') {
    return fail(res, 403, 'FORBIDDEN', 'Account is not active');
  }
  return next();
}

function requirePermission(...needed) {
  return (req, res, next) => {
    const perms = new Set(req.user?.permissions || []);
    const roles = new Set(req.user?.roles || []);
    if (roles.has('super_admin')) return next();
    const ok = needed.some((p) => perms.has(p));
    if (!ok) {
      return fail(res, 403, 'FORBIDDEN', 'Insufficient permissions', { required: needed });
    }
    return next();
  };
}

function requireRole(...rolesNeeded) {
  return (req, res, next) => {
    const roles = new Set(req.user?.roles || []);
    if (roles.has('super_admin')) return next();
    const ok = rolesNeeded.some((r) => roles.has(r));
    if (!ok) {
      return fail(res, 403, 'FORBIDDEN', 'Insufficient role', { required: rolesNeeded });
    }
    return next();
  };
}

function hasPermission(user, code) {
  if (!user) return false;
  if ((user.roles || []).includes('super_admin')) return true;
  return (user.permissions || []).includes(code);
}

function assertPermission(user, code) {
  if (!hasPermission(user, code)) {
    throw new AppError(403, 'FORBIDDEN', `Missing permission: ${code}`);
  }
}

module.exports = {
  authenticate,
  optionalAuth,
  requireApprovedMember,
  requirePermission,
  requireRole,
  hasPermission,
  assertPermission,
  loadAuthContext,
};
