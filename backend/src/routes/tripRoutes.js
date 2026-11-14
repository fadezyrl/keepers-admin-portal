const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const tripService = require('../services/tripService');
const { validate } = require('../validators/validate');
const { tripSchema } = require('../validators/schemas');
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
  '/mine/assigned',
  asyncHandler(async (req, res) => {
    const data = await tripService.listMyAssignedTrips(req.user, {
      status: req.query.status,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.get(
  '/registrations',
  requirePermission('registrations.manage', 'trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await tripService.listRegistrations({
      tripId: req.query.tripId,
      status: req.query.status || 'all',
      q: req.query.q,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.post(
  '/registrations/:registrationId/review',
  requirePermission('registrations.manage', 'trips.manage', 'trips.manage_own'),
  asyncHandler(async (req, res) => {
    const data = await tripService.reviewRegistration(
      req.params.registrationId,
      req.body,
      req.user,
      req,
    );
    return ok(res, data, 'Registration updated');
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const data = await tripService.getTrip(req.params.id, req.user.id, req.user);
    return ok(res, data);
  }),
);

router.post(
  '/',
  requirePermission('trips.create', 'trips.manage'),
  validate(tripSchema),
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
  '/:id/media',
  requirePermission('trips.manage', 'trips.manage_own', 'media.manage'),
  asyncHandler(async (req, res) => {
    const media = await tripService.addTripMedia(req.params.id, req.body, req.user);
    const data = await tripService.getTrip(req.params.id, req.user.id, req.user);
    return ok(res, { media, trip: data }, 'Media attached');
  }),
);

router.delete(
  '/:id/media/:mediaId',
  requirePermission('trips.manage', 'trips.manage_own', 'media.manage'),
  asyncHandler(async (req, res) => {
    const data = await tripService.deleteTripMedia(
      req.params.id,
      req.params.mediaId,
      req.user,
      req,
    );
    return ok(res, data, 'Media deleted');
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
  '/:id/permanent',
  requirePermission('trips.manage', 'trips.create', 'trips.manage_own'),
  asyncHandler(async (req, res) => {
    const data = await tripService.permanentlyDeleteTrip(req.params.id, req.user, req);
    return ok(res, data, 'Trip permanently deleted');
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

router.get(
  '/:id/pre-marshalls',
  requirePermission('trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await tripService.listPreMarshallAssignments(req.params.id, req.user);
    return ok(res, data);
  }),
);

router.post(
  '/:id/pre-marshalls',
  requirePermission('trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await tripService.assignPreMarshall(
      req.params.id,
      { userId: req.body.userId, notes: req.body.notes },
      req.user,
      req,
    );
    return ok(res, data, 'Pre-Marshall assigned');
  }),
);

router.delete(
  '/:id/pre-marshalls/:userId',
  requirePermission('trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await tripService.unassignPreMarshall(
      req.params.id,
      req.params.userId,
      req.user,
      req,
    );
    return ok(res, data, 'Pre-Marshall unassigned');
  }),
);

module.exports = router;
