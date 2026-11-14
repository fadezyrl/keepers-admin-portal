const express = require('express');
const multer = require('multer');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const contentService = require('../services/contentService');
const deviceTokenService = require('../services/deviceTokenService');
const { env } = require('../config/env');
const {
  authenticate,
  requireApprovedMember,
  requirePermission,
  optionalAuth,
} = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes },
});

const router = express.Router();

router.get(
  '/home',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await contentService.getHomeFeed(req.user.id);
    return ok(res, data);
  }),
);

router.get(
  '/versions',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await contentService.getContentVersions(req.user.id);
    return ok(res, data);
  }),
);

router.get(
  '/hero-slides',
  authenticate,
  requirePermission('media.manage', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.activeOnly === 'true';
    const data = await contentService.listHeroSlides({ activeOnly });
    return ok(res, data);
  }),
);

router.post(
  '/hero-slides',
  authenticate,
  requirePermission('media.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.upsertHeroSlide(req.body, req.user, req);
    return ok(res, data, 'Hero slide saved');
  }),
);

router.delete(
  '/hero-slides/:id',
  authenticate,
  requirePermission('media.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.deleteHeroSlide(req.params.id, req.user, req);
    return ok(res, data);
  }),
);

router.get(
  '/gallery',
  authenticate,
  requirePermission('media.manage', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.activeOnly === 'true';
    const data = await contentService.listGallery({ activeOnly });
    return ok(res, data);
  }),
);

router.post(
  '/gallery',
  authenticate,
  requirePermission('media.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.upsertGalleryItem(req.body, req.user, req);
    return ok(res, data, 'Gallery item saved');
  }),
);

router.delete(
  '/gallery/:id',
  authenticate,
  requirePermission('media.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.deleteGalleryItem(req.params.id, req.user, req);
    return ok(res, data);
  }),
);

router.get(
  '/sponsors',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.activeOnly !== 'false';
    const data = await contentService.listSponsors({ activeOnly });
    return ok(res, data);
  }),
);

router.post(
  '/sponsors',
  authenticate,
  requirePermission('sponsors.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.upsertSponsor(req.body, req.user, req);
    return ok(res, data, 'Sponsor saved');
  }),
);

router.post(
  '/sponsors/reorder',
  authenticate,
  requirePermission('sponsors.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.reorderSponsors(
      req.body.orderedIds || req.body.ids,
      req.user,
      req,
    );
    return ok(res, data, 'Sponsors reordered');
  }),
);

router.delete(
  '/sponsors/:id',
  authenticate,
  requirePermission('sponsors.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.deleteSponsor(req.params.id, req.user, req);
    return ok(res, data);
  }),
);

router.get(
  '/documents',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await contentService.listDocuments();
    return ok(res, data);
  }),
);

router.get(
  '/documents/:slug',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await contentService.getDocumentBySlug(req.params.slug);
    return ok(res, data);
  }),
);

router.patch(
  '/documents/:slug',
  authenticate,
  requirePermission('documents.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.updateDocument(req.params.slug, req.body, req.user, req);
    return ok(res, data, 'Document updated');
  }),
);

router.get(
  '/announcements',
  authenticate,
  requirePermission('announcements.manage', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const data = await contentService.listAnnouncements({ status: req.query.status });
    return ok(res, data);
  }),
);

router.post(
  '/announcements',
  authenticate,
  requirePermission('announcements.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.createAnnouncement(req.body, req.user, req);
    return created(res, data, 'Announcement created');
  }),
);

router.post(
  '/announcements/:id/publish',
  authenticate,
  requirePermission('announcements.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.publishAnnouncement(req.params.id, req.user, req);
    return ok(res, data, 'Announcement published');
  }),
);

router.post(
  '/notifications/devices/register',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await deviceTokenService.registerDeviceToken(req.user.id, req.body || {});
    return ok(res, data, 'Device registered');
  }),
);

router.delete(
  '/notifications/devices/:id',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await deviceTokenService.deactivateDeviceToken(req.user.id, req.params.id);
    return ok(res, data, 'Device deactivated');
  }),
);

router.post(
  '/notifications/devices/deactivate',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (body.fcmToken) {
      const data = await deviceTokenService.deactivateTokenByValue(req.user.id, body.fcmToken);
      return ok(res, data || { success: true }, 'Device deactivated');
    }
    const data = await deviceTokenService.deactivateAllForUser(req.user.id);
    return ok(res, data, 'Devices deactivated');
  }),
);

router.get(
  '/notifications',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await contentService.listNotifications(req.user.id, {
      unreadOnly: req.query.unreadOnly === 'true',
      limit: req.query.limit ? Number(req.query.limit) : 100,
      offset: req.query.offset ? Number(req.query.offset) : 0,
    });
    return ok(res, data);
  }),
);

router.post(
  '/notifications/:id/read',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await contentService.markNotificationRead(req.user.id, req.params.id);
    return ok(res, data);
  }),
);

router.post(
  '/notifications/read-all',
  authenticate,
  requireApprovedMember,
  asyncHandler(async (req, res) => {
    const data = await contentService.markAllNotificationsRead(req.user.id);
    return ok(res, data);
  }),
);

router.get(
  '/settings',
  authenticate,
  requirePermission('settings.manage', 'dashboard.read'),
  asyncHandler(async (req, res) => {
    const data = await contentService.listSettings();
    return ok(res, data);
  }),
);

router.patch(
  '/settings/:key',
  authenticate,
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const data = await contentService.updateSetting(req.params.key, req.body.value, req.user, req);
    return ok(res, data);
  }),
);

const ALLOWED_BUCKETS = new Set([
  'avatars',
  'vehicles',
  'trips',
  'gallery',
  'sponsors',
  'documents',
]);

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/svg+xml',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
]);

router.post(
  '/media/upload',
  authenticate,
  requireApprovedMember,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_FILE', message: 'File is required' },
      });
    }
    if (!ALLOWED_MIME.has(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TYPE', message: 'File type not allowed' },
      });
    }

    const bucket = req.body.bucket || 'gallery';
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_BUCKET', message: 'Unknown storage bucket' },
      });
    }

    // Members can upload own avatar/vehicle; broader media needs media.manage
    if (!['avatars', 'vehicles'].includes(bucket)) {
      const { hasPermission } = require('../middleware/auth');
      if (!hasPermission(req.user, 'media.manage') && !hasPermission(req.user, 'trips.create')) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Cannot upload to this bucket' },
        });
      }
    }

    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
    const path = `${req.user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const data = await contentService.uploadFile({
      bucket,
      path,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });
    return created(res, data, 'Uploaded');
  }),
);

module.exports = router;
