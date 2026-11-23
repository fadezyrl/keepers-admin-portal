const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const {
  authenticate,
  requireApprovedMember,
  requirePermission,
} = require('../middleware/auth');
const progressionService = require('../services/progressionService');
const rolePromotionService = require('../services/rolePromotionService');
const ratingService = require('../services/ratingService');

const router = express.Router();

router.use(authenticate);

/** Public hierarchy for approved members (stable, cacheable) */
router.get(
  '/levels',
  requireApprovedMember,
  asyncHandler(async (_req, res) => {
    const data = await progressionService.getHierarchy();
    return ok(res, data);
  }),
);

router.get(
  '/dashboard',
  requirePermission('upgrades.review', 'members.manage', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const data = await progressionService.getDashboardStats(req.user);
    return ok(res, data);
  }),
);

router.get(
  '/members',
  requirePermission('upgrades.review', 'members.manage', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const data = await progressionService.listMemberProgression(req.user, {
      q: req.query.q,
      rankGroup: req.query.rankGroup || req.query.rank || null,
      levelCode: req.query.levelCode || req.query.level || null,
      role: req.query.role || null,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 25),
    });
    return ok(res, data);
  }),
);

router.get(
  '/members/:id',
  requirePermission('upgrades.review', 'members.manage', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const data = await progressionService.getMemberProgressionDetail(
      req.user,
      req.params.id,
    );
    return ok(res, data);
  }),
);

router.get(
  '/upgrades',
  requirePermission('upgrades.review', 'upgrades.recommend'),
  asyncHandler(async (req, res) => {
    const data = await ratingService.listUpgradeRequests({
      status: req.query.status || 'pending',
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.post(
  '/upgrades/:id/review',
  requirePermission('upgrades.review'),
  asyncHandler(async (req, res) => {
    const data = await ratingService.reviewUpgradeRequest(
      req.params.id,
      {
        decision: req.body.decision,
        decisionNotes: req.body.decisionNotes || req.body.notes,
      },
      req.user,
      req,
    );
    return ok(res, data, `Upgrade ${req.body.decision}`);
  }),
);

router.get(
  '/role-promotions',
  requirePermission('upgrades.review', 'roles.assign'),
  asyncHandler(async (req, res) => {
    const data = await rolePromotionService.listRolePromotionRequests({
      status: req.query.status || 'pending',
      requestedRole: req.query.role || null,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.post(
  '/role-promotions/:id/review',
  requirePermission('upgrades.review', 'roles.assign'),
  asyncHandler(async (req, res) => {
    const data = await rolePromotionService.reviewRolePromotionRequest(
      req.params.id,
      {
        decision: req.body.decision,
        reviewNotes: req.body.reviewNotes || req.body.notes,
      },
      req.user,
      req,
    );
    return ok(res, data, `Role promotion ${req.body.decision}`);
  }),
);

module.exports = router;
