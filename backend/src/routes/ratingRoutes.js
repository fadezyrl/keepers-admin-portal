const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const ratingService = require('../services/ratingService');
const {
  authenticate,
  requireApprovedMember,
  requirePermission,
} = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requireApprovedMember);

router.get(
  '/criteria',
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const data = await ratingService.listCriteria({ includeInactive });
    return ok(res, data);
  }),
);

router.post(
  '/criteria',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const data = await ratingService.upsertCriterion(req.body, req.user, req);
    return ok(res, data, 'Criterion saved');
  }),
);

router.get(
  '/',
  requirePermission('ratings.create', 'upgrades.review', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const data = await ratingService.listRatings({
      tripId: req.query.tripId,
      memberId: req.query.memberId,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 20),
    });
    return ok(res, data);
  }),
);

router.post(
  '/',
  requirePermission('ratings.create'),
  asyncHandler(async (req, res) => {
    const data = await ratingService.createRating(req.body, req.user, req);
    return created(res, data, 'Rating submitted');
  }),
);

router.get(
  '/upgrades/mine',
  requirePermission('upgrades.recommend', 'upgrades.review'),
  asyncHandler(async (req, res) => {
    const data = await ratingService.listMyUpgradeRecommendations(req.user, {
      status: req.query.status || 'all',
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
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
      limit: Number(req.query.limit || 20),
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
      { decision: req.body.decision, decisionNotes: req.body.decisionNotes },
      req.user,
      req,
    );
    return ok(res, data, 'Upgrade request reviewed');
  }),
);

module.exports = router;
