const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const memberService = require('../services/memberService');
const memberProgressService = require('../services/memberProgressService');
const {
  authenticate,
  requireApprovedMember,
  requirePermission,
} = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.get(
  '/directory',
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await memberService.directory({
      q: req.query.q,
      membership: req.query.membership,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.get(
  '/',
  requirePermission('members.manage', 'members.read', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const data = await memberService.listMembers({
      q: req.query.q,
      status: req.query.status,
      membership: req.query.membership,
      role: req.query.role,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 20),
    });
    return ok(res, data);
  }),
);

/** Authenticated member's own progress — never accepts a client member id */
router.get(
  '/me/progress',
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await memberProgressService.getMyProgress(req.user.id);
    return ok(res, data);
  }),
);

router.get(
  '/me/trips',
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await memberProgressService.getMyTrips(req.user.id, {
      filter: req.query.filter || 'all',
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 20),
    });
    return ok(res, data);
  }),
);

router.get(
  '/me/trips/:tripId',
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await memberProgressService.getMyTripPerformance(
      req.user.id,
      req.params.tripId,
    );
    return ok(res, data);
  }),
);

router.patch(
  '/me',
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await memberService.updateOwnProfile(req.user.id, req.body, req);
    return ok(res, data, 'Profile updated');
  }),
);

router.get(
  '/:id',
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await memberService.getMemberById(req.params.id, req.user);
    return ok(res, data);
  }),
);

router.post(
  '/:id/status',
  requirePermission('members.manage'),
  asyncHandler(async (req, res) => {
    const data = await memberService.setMemberStatus(
      req.params.id,
      { status: req.body.status, reason: req.body.reason },
      req.user,
      req,
    );
    return ok(res, data, 'Member status updated');
  }),
);

router.post(
  '/:id/roles',
  requirePermission('roles.assign'),
  asyncHandler(async (req, res) => {
    const data = await memberService.assignRole(req.params.id, req.body.role, req.user, req);
    return ok(res, data, 'Role assigned');
  }),
);

router.delete(
  '/:id/roles/:role',
  requirePermission('roles.assign'),
  asyncHandler(async (req, res) => {
    const data = await memberService.removeRole(req.params.id, req.params.role, req.user, req);
    return ok(res, data, 'Role removed');
  }),
);

router.get(
  '/:id/deletion-impact',
  requirePermission('members.manage'),
  asyncHandler(async (req, res) => {
    const data = await memberService.getDeletionImpact(req.params.id, req.user);
    return ok(res, data);
  }),
);

router.post(
  '/:id/permanent-delete',
  requirePermission('members.manage'),
  asyncHandler(async (req, res) => {
    const data = await memberService.permanentlyDeleteMember(
      req.params.id,
      {
        confirmEmail: req.body.confirmEmail,
        tripActions: req.body.tripActions,
        reason: req.body.reason,
      },
      req.user,
      req,
    );
    return ok(res, data, 'Member permanently deleted');
  }),
);

module.exports = router;
