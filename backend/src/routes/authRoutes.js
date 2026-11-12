const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { validate } = require('../validators/validate');
const { signupSchema, loginSchema } = require('../validators/authValidators');
const authService = require('../services/authService');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/signup',
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const data = await authService.signup(req.body, req);
    return created(res, data, data.message);
  }),
);

router.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const data = await authService.login(req.body.email, req.body.password);
    if (data.accessBlocked) {
      return res.status(403).json({
        success: false,
        error: {
          code: data.blockReason,
          message: data.message,
        },
        data: {
          session: null,
          user: data.user,
        },
      });
    }
    return ok(res, data, 'Logged in');
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await authService.me(req.user.id);
    return ok(res, data);
  }),
);

router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const data = await authService.requestPasswordReset(
      req.body.email,
      req.body.redirectTo,
    );
    return ok(res, data);
  }),
);

router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await authService.changePassword(
      req.user.id,
      req.user.email || req.user.profile?.email,
      req.body.currentPassword,
      req.body.nextPassword,
    );
    return ok(res, data, data.message);
  }),
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const data = await authService.setPasswordWithRecoveryToken(
      req.body.accessToken,
      req.body.password,
    );
    return ok(res, data, data.message);
  }),
);

router.post(
  '/delete-account',
  authenticate,
  asyncHandler(async (req, res) => {
    const data = await authService.deleteAccount(
      req.user.id,
      req.user.email || req.user.profile?.email,
      req.body.password,
      req,
    );
    return ok(res, data, data.message);
  }),
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { getAnonClient } = require('../config/supabase');
    const { AppError } = require('../utils/AppError');
    const anon = getAnonClient();
    if (!anon) {
      throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Supabase Auth is not configured');
    }
    const refreshToken = req.body.refreshToken;
    if (!refreshToken) {
      throw new AppError(400, 'VALIDATION_ERROR', 'refreshToken is required');
    }
    const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) {
      throw new AppError(401, 'UNAUTHORIZED', 'Unable to refresh session');
    }
    return ok(res, { session: data.session }, 'Session refreshed');
  }),
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    const { getAdminClient } = require('../config/supabase');
    const admin = getAdminClient();
    if (admin) {
      try {
        await admin.auth.admin.signOut(req.accessToken, 'local');
      } catch {
        // best-effort
      }
    }
    return ok(res, { loggedOut: true }, 'Logged out');
  }),
);

module.exports = router;
