const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const {
  authenticate,
  requireApprovedMember,
  requirePermission,
} = require('../middleware/auth');
const chatService = require('../services/chatService');
const chatModerationService = require('../services/chatModerationService');
const { validate } = require('../validators/validate');
const {
  reportMessageSchema,
  reportMemberSchema,
  blockUserSchema,
  reviewReportSchema,
} = require('../validators/schemas');
const { env } = require('../config/env');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes },
});

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many messages — slow down' },
  },
});

const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMIT', message: 'Too many reports — slow down' },
  },
});

router.use(authenticate, requireApprovedMember);

router.get(
  '/inbox',
  requirePermission('chat.read', 'chat.moderate', 'trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await chatService.listInbox(req.user, {
      limit: Number(req.query.limit || 50),
    });
    return ok(res, data);
  }),
);

router.get(
  '/conversations/:id',
  requirePermission('chat.read', 'chat.moderate', 'trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await chatService.getConversation(req.params.id, req.user);
    return ok(res, data);
  }),
);

router.get(
  '/conversations/:id/messages',
  requirePermission('chat.read', 'chat.moderate', 'trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await chatService.listMessages(req.params.id, req.user, {
      before: req.query.before || null,
      after: req.query.after || null,
      limit: Number(req.query.limit || 40),
    });
    return ok(res, data);
  }),
);

router.post(
  '/trips/:tripId/group',
  requirePermission('chat.read', 'chat.moderate', 'trips.manage'),
  asyncHandler(async (req, res) => {
    const data = await chatService.openGroupForTrip(req.params.tripId, req.user);
    return ok(res, data);
  }),
);

router.post(
  '/trips/:tripId/private',
  requirePermission('chat.read', 'chat.send'),
  asyncHandler(async (req, res) => {
    const data = await chatService.openPrivateForTrip(req.params.tripId, req.user);
    return ok(res, data);
  }),
);

router.post(
  '/trips/:tripId/private/:memberId',
  requirePermission('chat.read', 'trips.manage_own', 'trips.manage', 'chat.moderate'),
  asyncHandler(async (req, res) => {
    const data = await chatService.openPrivateAsMarshall(
      req.params.tripId,
      req.params.memberId,
      req.user,
    );
    return ok(res, data);
  }),
);

router.post(
  '/conversations/:id/messages',
  requirePermission('chat.send', 'chat.moderate'),
  sendLimiter,
  asyncHandler(async (req, res) => {
    const data = await chatService.sendMessage(req.params.id, req.user, req.body);
    return created(res, data, 'Message sent');
  }),
);

router.post(
  '/conversations/:id/attachments',
  requirePermission('chat.send', 'chat.moderate'),
  sendLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const data = await chatService.uploadChatAttachment(
      req.params.id,
      req.user,
      req.file,
      {
        kind: req.body.kind || req.body.messageType,
        durationMs: req.body.durationMs,
        width: req.body.width,
        height: req.body.height,
        waveform: req.body.waveform,
        thumbnailUrl: req.body.thumbnailUrl,
      },
    );
    return created(res, data, 'Attachment uploaded');
  }),
);

router.post(
  '/conversations/:id/read',
  requirePermission('chat.read', 'chat.moderate'),
  asyncHandler(async (req, res) => {
    const data = await chatService.ackRead(req.params.id, req.user, {
      upToMessageId: req.body.upToMessageId || null,
    });
    return ok(res, data);
  }),
);

router.post(
  '/conversations/:id/delivered',
  requirePermission('chat.read', 'chat.moderate'),
  asyncHandler(async (req, res) => {
    const data = await chatService.ackDelivered(
      req.params.id,
      req.user,
      req.body.messageIds || [],
    );
    return ok(res, data);
  }),
);

router.post(
  '/messages/:id/report',
  requirePermission('chat.read'),
  reportLimiter,
  validate(reportMessageSchema),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.reportMessage(
      req.params.id,
      req.user,
      req.body,
    );
    return created(res, data, 'Report submitted');
  }),
);

router.post(
  '/members/:userId/report',
  requirePermission('chat.read'),
  reportLimiter,
  validate(reportMemberSchema),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.reportMember(
      req.params.userId,
      req.user,
      req.body,
    );
    return created(res, data, 'Report submitted');
  }),
);

router.get(
  '/blocks',
  requirePermission('chat.read'),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.listBlockedUsers(req.user);
    return ok(res, data);
  }),
);

router.post(
  '/blocks',
  requirePermission('chat.read'),
  validate(blockUserSchema),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.blockUser(
      req.body.userId,
      req.user,
      { reason: req.body.reason },
    );
    return created(res, data, 'Member blocked');
  }),
);

router.delete(
  '/blocks/:userId',
  requirePermission('chat.read'),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.unblockUser(
      req.params.userId,
      req.user,
    );
    return ok(res, data, 'Member unblocked');
  }),
);

router.get(
  '/reports',
  requirePermission('chat.moderate'),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.listReports(req.user, {
      status: req.query.status || null,
      reportType: req.query.reportType || null,
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 20),
    });
    return ok(res, data);
  }),
);

router.get(
  '/reports/:id',
  requirePermission('chat.moderate'),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.getReport(req.params.id, req.user);
    return ok(res, data);
  }),
);

router.patch(
  '/reports/:id',
  requirePermission('chat.moderate'),
  validate(reviewReportSchema),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.reviewReport(
      req.params.id,
      req.user,
      req.body,
    );
    return ok(res, data, 'Report updated');
  }),
);

router.get(
  '/moderation-actions',
  requirePermission('chat.moderate'),
  asyncHandler(async (req, res) => {
    const data = await chatModerationService.listModerationActions(req.user, {
      page: Number(req.query.page || 1),
      limit: Number(req.query.limit || 30),
    });
    return ok(res, data);
  }),
);

router.delete(
  '/messages/:id',
  requirePermission('chat.send', 'chat.moderate'),
  asyncHandler(async (req, res) => {
    const data = await chatService.softDeleteMessage(
      req.params.id,
      req.user,
      req.body.reason,
    );
    return ok(res, data, 'Message deleted');
  }),
);

module.exports = router;
