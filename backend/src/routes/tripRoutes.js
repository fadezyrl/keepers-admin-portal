const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const tripService = require('../services/tripService');
const {
  authenticate,
  requireApprovedMember,
  requirePermission,
  hasPermission,
} = require('../middleware/auth');

const router = express.Router();

router.use(authenticate, requireApprovedMember);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeDrafts = hasPermission(req.user, 'trips.manage');
    const data = await tripService.listTrips({
      filter: req.query.filter || 'all',
      q: req.query.q,
      status: req.query.status,
      from: req.query.from,
      to: req.query.to,
      userId: req.user.id,
      includeDrafts: includeDrafts && req.query.includeDrafts === 'true',
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.get(
  '/calendar',
  asyncHandler(async (req, res) => {
    const includeDrafts = hasPermission(req.user, 'trips.manage') && req.query.includeDrafts === 'true';
    const data = await tripService.calendar({
      from: req.query.from,
      to: req.query.to,
      userId: req.user.id,
      includeDrafts,
    });
    return ok(res, data);
  }),
);

router.get(
  '/mine/organized',
  requirePermission('trips.create', 'trips.manage_own', 'trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await tripService.listMyOrganizedTrips(req.user, {
      status: req.query.status,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = await tripService.getTrip(req.params.id, req.user.id);
    return ok(res, data);
  }),
);

router.post(
  '/',
  requirePermission('trips.create', 'trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await tripService.createTrip(req.body, req.user, req);
    return created(res, data, 'Trip created');
  }),
);

router.patch(
  '/:id',
  requirePermission('trips.manage', 'trips.manage_own'),
  asyncHandler(async (req, res) => {
    const data = await tripService.updateTrip(req.params.id, req.body, req.user, req);
    return ok(res, data, 'Trip updated');
  }),
);

router.post(
  '/:id/status',
  requirePermission('trips.manage', 'trips.manage_own'),
  asyncHandler(async (req, res) => {
    const data = await tripService.setTripStatus(
      req.params.id,
      req.body.status,
      req.user,
      req,
      req.body.reason,
    );
    return ok(res, data, 'Trip status updated');
  }),
);

router.delete(
  '/:id',
  requirePermission('trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await tripService.softDeleteTrip(req.params.id, req.user, req);
    return ok(res, data, 'Trip deleted');
  }),
);

router.post(
  '/:id/join',
  asyncHandler(async (req, res) => {
    const data = await tripService.joinTrip(req.params.id, req.user, req);
    return ok(res, data, 'Joined trip');
  }),
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const data = await tripService.cancelRegistration(req.params.id, req.user, req);
    return ok(res, data, 'Registration cancelled');
  }),
);

router.post(
  '/:id/attendance',
  requirePermission('attendance.mark'),
  asyncHandler(async (req, res) => {
    const data = await tripService.markAttendance(
      req.params.id,
      {
        userId: req.body.userId,
        attended: req.body.attended !== false,
        notes: req.body.notes,
      },
      req.user,
      req,
    );
    return ok(res, data, 'Attendance recorded');
  }),
);

module.exports = router;
