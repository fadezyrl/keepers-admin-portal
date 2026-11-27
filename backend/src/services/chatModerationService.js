const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { hasPermission } = require('../middleware/auth');
const {
  REPORT_REASONS,
  REPORT_STATUSES,
} = require('../constants/chatModeration');
const chatService = require('./chatService');
const memberService = require('./memberService');

const DETAILS_MAX = 1000;

function isModerator(actor) {
  return (
    hasPermission(actor, 'chat.moderate') ||
    hasPermission(actor, 'trips.manage') ||
    (actor.roles || []).includes('super_admin') ||
    (actor.roles || []).includes('admin')
  );
}

function assertModerator(actor) {
  if (!isModerator(actor) && !hasPermission(actor, 'chat.moderate')) {
    throw new AppError(403, 'FORBIDDEN', 'Moderation access required');
  }
}

function normalizeReason(reason) {
  const value = String(reason || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!REPORT_REASONS.includes(value)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Reason must be one of: ${REPORT_REASONS.join(', ')}`,
    );
  }
  return value;
}

function normalizeDetails(details) {
  if (details == null || details === '') return null;
  const trimmed = String(details).trim();
  if (!trimmed) return null;
  if (trimmed.length > DETAILS_MAX) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Details must be at most ${DETAILS_MAX} characters`,
    );
  }
  return trimmed;
}

function mapReportRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    reportType: row.report_type,
    reason: row.reason,
    details: row.details || null,
    status: row.status,
    conversationId: row.conversation_id || null,
    messageId: row.message_id || null,
    reporterId: row.reporter_id,
    reportedUserId: row.reported_user_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewNotes: row.review_notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reporter: row.reporter_id
      ? {
          id: row.reporter_id,
          name: row.reporter_name || null,
          avatar: row.reporter_avatar || null,
        }
      : null,
    reportedUser: row.reported_user_id
      ? {
          id: row.reported_user_id,
          name: row.reported_user_name || null,
          avatar: row.reported_user_avatar || null,
        }
      : null,
    reviewer: row.reviewed_by
      ? {
          id: row.reviewed_by,
          name: row.reviewer_name || null,
        }
      : null,
    message: row.message_id
      ? {
          id: row.message_id,
          type: row.message_type || null,
          content: row.message_deleted_at ? null : row.message_content || null,
          deletedAt: row.message_deleted_at || null,
          createdAt: row.message_created_at || null,
        }
      : null,
    conversation: row.conversation_id
      ? {
          id: row.conversation_id,
          type: row.conversation_type || null,
          tripId: row.trip_id || null,
          tripTitle: row.trip_title || null,
        }
      : null,
  };
}

function mapBlockRow(row) {
  return {
    id: row.id,
    blockedUserId: row.blocked_user_id,
    reason: row.reason || null,
    createdAt: row.created_at,
    user: {
      id: row.blocked_user_id,
      name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Member',
      avatar: row.avatar_url || null,
    },
  };
}

async function logModerationAction({
  actorId,
  action,
  conversationId = null,
  messageId = null,
  targetUserId = null,
  reason = null,
  metadata = null,
}) {
  await query(
    `INSERT INTO chat_moderation_actions (
       actor_id, action, conversation_id, message_id, target_user_id, reason, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      actorId,
      action,
      conversationId,
      messageId,
      targetUserId,
      reason,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );
}

async function getBlockedUserIds(blockerId) {
  if (!blockerId) return [];
  const res = await query(
    `SELECT blocked_user_id FROM chat_user_blocks WHERE blocker_id = $1`,
    [blockerId],
  );
  return res.rows.map((r) => r.blocked_user_id);
}

async function isUserBlocked(blockerId, blockedUserId) {
  if (!blockerId || !blockedUserId || blockerId === blockedUserId) return false;
  const res = await query(
    `SELECT 1 FROM chat_user_blocks
     WHERE blocker_id = $1 AND blocked_user_id = $2
     LIMIT 1`,
    [blockerId, blockedUserId],
  );
  return Boolean(res.rows[0]);
}

async function reportMessage(messageId, actor, { reason, details } = {}) {
  if (!actor?.id) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  const normalizedReason = normalizeReason(reason);
  const normalizedDetails = normalizeDetails(details);

  const msg = await query(`SELECT * FROM messages WHERE id = $1`, [messageId]);
  if (!msg.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Message not found');
  const row = msg.rows[0];

  await chatService.assertCanAccessConversation(row.conversation_id, actor);

  if (row.sender_id === actor.id) {
    throw new AppError(400, 'VALIDATION_ERROR', 'You cannot report your own message');
  }

  const existing = await query(
    `SELECT id FROM chat_reports
     WHERE reporter_id = $1
       AND message_id = $2
       AND report_type = 'message'
       AND status IN ('open', 'reviewing')
     LIMIT 1`,
    [actor.id, messageId],
  );
  if (existing.rows[0]) {
    throw new AppError(
      409,
      'DUPLICATE_REPORT',
      'You already reported this message',
    );
  }

  let inserted;
  try {
    inserted = await query(
      `INSERT INTO chat_reports (
         reporter_id, conversation_id, message_id, reported_user_id,
         reason, details, report_type, status
       ) VALUES ($1,$2,$3,$4,$5,$6,'message','open')
       RETURNING *`,
      [
        actor.id,
        row.conversation_id,
        messageId,
        row.sender_id,
        normalizedReason,
        normalizedDetails,
      ],
    );
  } catch (err) {
    if (err?.code === '23505') {
      throw new AppError(
        409,
        'DUPLICATE_REPORT',
        'You already reported this message',
      );
    }
    throw err;
  }

  await logModerationAction({
    actorId: actor.id,
    action: 'report_message',
    conversationId: row.conversation_id,
    messageId,
    targetUserId: row.sender_id,
    reason: normalizedReason,
    metadata: { details: normalizedDetails },
  });

  return mapReportRow(inserted.rows[0]);
}

async function reportMember(reportedUserId, actor, payload = {}) {
  if (!actor?.id) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  if (!reportedUserId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Member id is required');
  }
  if (reportedUserId === actor.id) {
    throw new AppError(400, 'VALIDATION_ERROR', 'You cannot report yourself');
  }

  const normalizedReason = normalizeReason(payload.reason);
  const normalizedDetails = normalizeDetails(payload.details);
  const conversationId = payload.conversationId || null;

  const profile = await query(
    `SELECT id FROM member_profiles
     WHERE id = $1 AND deleted_at IS NULL`,
    [reportedUserId],
  );
  if (!profile.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Member not found');

  if (conversationId) {
    await chatService.assertCanAccessConversation(conversationId, actor);
    const targetInChat = await query(
      `SELECT 1 FROM conversation_participants
       WHERE conversation_id = $1 AND user_id = $2
       LIMIT 1`,
      [conversationId, reportedUserId],
    );
    if (!targetInChat.rows[0] && !isModerator(actor)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Reported member is not part of this conversation',
      );
    }
  }

  const existing = await query(
    `SELECT id FROM chat_reports
     WHERE reporter_id = $1
       AND reported_user_id = $2
       AND report_type = 'member'
       AND status IN ('open', 'reviewing')
     LIMIT 1`,
    [actor.id, reportedUserId],
  );
  if (existing.rows[0]) {
    throw new AppError(
      409,
      'DUPLICATE_REPORT',
      'You already have an open report for this member',
    );
  }

  let inserted;
  try {
    inserted = await query(
      `INSERT INTO chat_reports (
         reporter_id, conversation_id, message_id, reported_user_id,
         reason, details, report_type, status
       ) VALUES ($1,$2,NULL,$3,$4,$5,'member','open')
       RETURNING *`,
      [
        actor.id,
        conversationId,
        reportedUserId,
        normalizedReason,
        normalizedDetails,
      ],
    );
  } catch (err) {
    if (err?.code === '23505') {
      throw new AppError(
        409,
        'DUPLICATE_REPORT',
        'You already have an open report for this member',
      );
    }
    throw err;
  }

  await logModerationAction({
    actorId: actor.id,
    action: 'report_member',
    conversationId,
    targetUserId: reportedUserId,
    reason: normalizedReason,
    metadata: { details: normalizedDetails },
  });

  return mapReportRow(inserted.rows[0]);
}

async function blockUser(blockedUserId, actor, { reason } = {}) {
  if (!actor?.id) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  if (!blockedUserId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'User id is required');
  }
  if (blockedUserId === actor.id) {
    throw new AppError(400, 'VALIDATION_ERROR', 'You cannot block yourself');
  }

  const profile = await query(
    `SELECT id FROM member_profiles
     WHERE id = $1 AND deleted_at IS NULL`,
    [blockedUserId],
  );
  if (!profile.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Member not found');

  const reasonText = reason ? String(reason).trim().slice(0, 500) || null : null;

  let inserted;
  try {
    inserted = await query(
      `INSERT INTO chat_user_blocks (blocker_id, blocked_user_id, reason)
       VALUES ($1,$2,$3)
       ON CONFLICT (blocker_id, blocked_user_id) DO UPDATE
         SET reason = COALESCE(EXCLUDED.reason, chat_user_blocks.reason),
             updated_at = NOW()
       RETURNING *`,
      [actor.id, blockedUserId, reasonText],
    );
  } catch (err) {
    if (err?.code === '23514') {
      throw new AppError(400, 'VALIDATION_ERROR', 'You cannot block yourself');
    }
    throw err;
  }

  await logModerationAction({
    actorId: actor.id,
    action: 'block_user',
    targetUserId: blockedUserId,
    reason: reasonText,
  });

  const enriched = await query(
    `SELECT b.*, p.first_name, p.last_name, p.avatar_url
     FROM chat_user_blocks b
     JOIN member_profiles p ON p.id = b.blocked_user_id
     WHERE b.id = $1`,
    [inserted.rows[0].id],
  );
  return mapBlockRow(enriched.rows[0]);
}

async function unblockUser(blockedUserId, actor) {
  if (!actor?.id) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  if (!blockedUserId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'User id is required');
  }

  const res = await query(
    `DELETE FROM chat_user_blocks
     WHERE blocker_id = $1 AND blocked_user_id = $2
     RETURNING *`,
    [actor.id, blockedUserId],
  );
  if (!res.rows[0]) {
    throw new AppError(404, 'NOT_FOUND', 'Block not found');
  }

  await logModerationAction({
    actorId: actor.id,
    action: 'unblock_user',
    targetUserId: blockedUserId,
  });

  return { blockedUserId, unblocked: true };
}

async function listBlockedUsers(actor) {
  if (!actor?.id) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  const res = await query(
    `SELECT b.*, p.first_name, p.last_name, p.avatar_url
     FROM chat_user_blocks b
     JOIN member_profiles p ON p.id = b.blocked_user_id
     WHERE b.blocker_id = $1
     ORDER BY b.created_at DESC`,
    [actor.id],
  );
  return { items: res.rows.map(mapBlockRow) };
}

const REPORT_SELECT = `
  SELECT
    r.*,
    trim(both ' ' FROM concat_ws(' ', rp.first_name, rp.last_name)) AS reporter_name,
    rp.avatar_url AS reporter_avatar,
    trim(both ' ' FROM concat_ws(' ', tu.first_name, tu.last_name)) AS reported_user_name,
    tu.avatar_url AS reported_user_avatar,
    trim(both ' ' FROM concat_ws(' ', rv.first_name, rv.last_name)) AS reviewer_name,
    m.message_type,
    m.content AS message_content,
    m.deleted_at AS message_deleted_at,
    m.created_at AS message_created_at,
    c.type AS conversation_type,
    c.trip_id,
    t.title AS trip_title
  FROM chat_reports r
  LEFT JOIN member_profiles rp ON rp.id = r.reporter_id
  LEFT JOIN member_profiles tu ON tu.id = r.reported_user_id
  LEFT JOIN member_profiles rv ON rv.id = r.reviewed_by
  LEFT JOIN messages m ON m.id = r.message_id
  LEFT JOIN conversations c ON c.id = r.conversation_id
  LEFT JOIN trips t ON t.id = c.trip_id
`;

async function listReports(actor, { status = null, reportType = null, page = 1, limit = 20 } = {}) {
  assertModerator(actor);
  if (!hasPermission(actor, 'chat.moderate') && !isModerator(actor)) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot review reports');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const params = [];
  const where = [];
  if (status) {
    if (!REPORT_STATUSES.includes(status)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid report status');
    }
    params.push(status);
    where.push(`r.status = $${params.length}`);
  }
  if (reportType) {
    if (!['message', 'member'].includes(reportType)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid report type');
    }
    params.push(reportType);
    where.push(`r.report_type = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM chat_reports r ${whereSql}`,
    params,
  );

  params.push(safeLimit);
  params.push(offset);
  const res = await query(
    `${REPORT_SELECT}
     ${whereSql}
     ORDER BY r.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    items: res.rows.map(mapReportRow),
    page: safePage,
    limit: safeLimit,
    total: countRes.rows[0]?.total || 0,
  };
}

async function getReport(reportId, actor) {
  assertModerator(actor);
  const res = await query(`${REPORT_SELECT} WHERE r.id = $1`, [reportId]);
  if (!res.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Report not found');
  return mapReportRow(res.rows[0]);
}

async function reviewReport(reportId, actor, payload = {}) {
  assertModerator(actor);
  if (!hasPermission(actor, 'chat.moderate')) {
    throw new AppError(403, 'FORBIDDEN', 'chat.moderate permission required');
  }

  const reportRes = await query(`SELECT * FROM chat_reports WHERE id = $1`, [
    reportId,
  ]);
  if (!reportRes.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Report not found');
  const report = reportRes.rows[0];

  const action = String(payload.action || '').trim();
  const allowedActions = [
    'dismiss',
    'resolve',
    'delete_message',
    'suspend_member',
  ];
  if (!allowedActions.includes(action)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Action must be one of: ${allowedActions.join(', ')}`,
    );
  }

  const reviewNotes = normalizeDetails(payload.reviewNotes);
  let nextStatus = report.status;
  const metadata = { action, reviewNotes };

  if (action === 'dismiss') {
    nextStatus = 'dismissed';
    await logModerationAction({
      actorId: actor.id,
      action: 'dismiss_report',
      conversationId: report.conversation_id,
      messageId: report.message_id,
      targetUserId: report.reported_user_id,
      reason: report.reason,
      metadata,
    });
  } else if (action === 'resolve') {
    nextStatus = 'resolved';
    await logModerationAction({
      actorId: actor.id,
      action: 'resolve_report',
      conversationId: report.conversation_id,
      messageId: report.message_id,
      targetUserId: report.reported_user_id,
      reason: report.reason,
      metadata,
    });
  } else if (action === 'delete_message') {
    if (!report.message_id) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'This report has no message to delete',
      );
    }
    await chatService.softDeleteMessage(
      report.message_id,
      actor,
      reviewNotes || `Moderation: ${report.reason}`,
    );
    nextStatus = 'resolved';
    metadata.deletedMessageId = report.message_id;
  } else if (action === 'suspend_member') {
    if (!report.reported_user_id) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'This report has no member to act against',
      );
    }
    if (!hasPermission(actor, 'members.manage')) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'members.manage permission required to suspend',
      );
    }
    await memberService.setMemberStatus(
      report.reported_user_id,
      {
        status: 'suspended',
        reason:
          reviewNotes ||
          `Suspended from chat report (${report.reason})`,
      },
      actor,
      null,
    );
    nextStatus = 'resolved';
    await logModerationAction({
      actorId: actor.id,
      action: 'suspend_member',
      conversationId: report.conversation_id,
      messageId: report.message_id,
      targetUserId: report.reported_user_id,
      reason: report.reason,
      metadata,
    });
  }

  await query(
    `UPDATE chat_reports
     SET status = $1,
         reviewed_by = $2,
         review_notes = COALESCE($3, review_notes),
         updated_at = NOW()
     WHERE id = $4`,
    [nextStatus, actor.id, reviewNotes, reportId],
  );

  return getReport(reportId, actor);
}

async function listModerationActions(actor, { page = 1, limit = 30 } = {}) {
  assertModerator(actor);
  const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM chat_moderation_actions`,
  );
  const res = await query(
    `SELECT
       a.*,
       trim(both ' ' FROM concat_ws(' ', p.first_name, p.last_name)) AS actor_name,
       trim(both ' ' FROM concat_ws(' ', t.first_name, t.last_name)) AS target_name
     FROM chat_moderation_actions a
     LEFT JOIN member_profiles p ON p.id = a.actor_id
     LEFT JOIN member_profiles t ON t.id = a.target_user_id
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
    [safeLimit, offset],
  );

  return {
    items: res.rows.map((row) => ({
      id: row.id,
      action: row.action,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      targetUserId: row.target_user_id,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.created_at,
      actor: { id: row.actor_id, name: row.actor_name || null },
      targetUser: row.target_user_id
        ? { id: row.target_user_id, name: row.target_name || null }
        : null,
    })),
    page: safePage,
    limit: safeLimit,
    total: countRes.rows[0]?.total || 0,
  };
}

module.exports = {
  reportMessage,
  reportMember,
  blockUser,
  unblockUser,
  listBlockedUsers,
  listReports,
  getReport,
  reviewReport,
  listModerationActions,
  getBlockedUserIds,
  isUserBlocked,
  normalizeReason,
  normalizeDetails,
  REPORT_REASONS,
};
