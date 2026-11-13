const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const eventService = require('../services/eventService');
const {
  authenticate,
  requireApprovedMember,
  requirePermission,
} = require('../middleware/auth');

const router = express.Router();

router.get(
  '/',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const includeUnpublished =
      req.query.includeUnpublished === 'true' &&
      (req.user.permissions || []).some((p) =>
        ['events.manage', 'announcements.manage', 'dashboard.read'].includes(p),
      );
    const data = await eventService.listEvents({
      status: req.query.status,
      includeUnpublished,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.get(
  '/:id',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await eventService.getEvent(req.params.id);
    return ok(res, data);
  }),
);

router.post(
  '/',
  authenticate,
  requirePermission('events.manage', 'announcements.manage'),
  asyncHandler(async (req, res) => {
    const data = await eventService.upsertEvent(req.body, req.user, req);
    return created(res, data, 'Event saved');
  }),
);

router.patch(
  '/:id',
  authenticate,
  requirePermission('events.manage', 'announcements.manage'),
  asyncHandler(async (req, res) => {
    const data = await eventService.upsertEvent(
      { ...req.body, id: req.params.id },
      req.user,
      req,
    );
    return ok(res, data, 'Event updated');
  }),
);

router.post(
  '/:id/status',
  authenticate,
  requirePermission('events.manage', 'announcements.manage'),
  asyncHandler(async (req, res) => {
    const data = await eventService.setEventStatus(
      req.params.id,
      req.body.status,
      req.user,
      req,
    );
    return ok(res, data, 'Event status updated');
  }),
);

router.delete(
  '/:id',
  authenticate,
  requirePermission('events.manage', 'announcements.manage'),
  asyncHandler(async (req, res) => {
    const data = await eventService.deleteEvent(req.params.id, req.user, req);
    return ok(res, data);
  }),
);

module.exports = router;
