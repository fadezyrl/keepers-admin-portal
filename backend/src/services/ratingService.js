const { query, withTransaction } = require('../config/db');
const { AppError } = require('../utils/AppError');
const { writeAudit } = require('./auditService');
const { createNotification } = require('./notificationService');
const { presets: cachePresets } = require('./cacheInvalidationService');
const { hasPermission } = require('../middleware/auth');

async function listCriteria({ includeInactive = false } = {}) {
  const res = await query(
    `SELECT * FROM rating_criteria
     WHERE ($1::boolean OR is_active = TRUE)
     ORDER BY display_order, name`,
    [includeInactive],
  );
  return res.rows;
}

async function upsertCriterion(payload, actor, req) {
  if (!hasPermission(actor, 'settings.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot manage rating criteria');
  }

  if (payload.id) {
    const updated = await query(
      `UPDATE rating_criteria SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         min_score = COALESCE($3, min_score),
         max_score = COALESCE($4, max_score),
         display_order = COALESCE($5, display_order),
         is_active = COALESCE($6, is_active)
       WHERE id = $7 RETURNING *`,
      [
        payload.name ?? null,
        payload.description ?? null,
        payload.minScore ?? null,
        payload.maxScore ?? null,
        payload.displayOrder ?? null,
        payload.isActive ?? null,
        payload.id,
      ],
    );
    if (!updated.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Criterion not found');
    await writeAudit({
      actorId: actor.id,
      action: 'rating_criteria.update',
      entityType: 'rating_criteria',
      entityId: payload.id,
      req,
    });
    return updated.rows[0];
  }

  const inserted = await query(
    `INSERT INTO rating_criteria (code, name, description, min_score, max_score, display_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, TRUE))
     RETURNING *`,
    [
      payload.code,
      payload.name,
      payload.description || null,
      payload.minScore || 1,
      payload.maxScore || 5,
      payload.displayOrder || 0,
      payload.isActive,
    ],
  );

  await writeAudit({
    actorId: actor.id,
    action: 'rating_criteria.create',
    entityType: 'rating_criteria',
    entityId: inserted.rows[0].id,
    req,
  });
  return inserted.rows[0];
}

async function createRating(payload, actor, req) {
  if (!hasPermission(actor, 'ratings.create')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot create ratings');
  }

  const { tripId, memberId, scores, privateFeedback, publicNotes, recommendUpgradeTo } = payload;

  if (memberId === actor.id) {
    throw new AppError(400, 'INVALID', 'Cannot rate yourself');
  }

  const tripRes = await query(
    `SELECT id, organizer_id, status FROM trips WHERE id = $1 AND deleted_at IS NULL`,
    [tripId],
  );
  const trip = tripRes.rows[0];
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');

  const canManageAll = hasPermission(actor, 'trips.manage');
  const isOrganizer = trip.organizer_id === actor.id;
  if (!canManageAll && !isOrganizer) {
    throw new AppError(403, 'FORBIDDEN', 'Only the drive organizer or admin can rate participants');
  }

  const attendance = await query(
    `SELECT attended FROM trip_attendance WHERE trip_id = $1 AND user_id = $2`,
    [tripId, memberId],
  );
  if (!attendance.rows[0] || attendance.rows[0].attended !== true) {
    throw new AppError(
      400,
      'NOT_ELIGIBLE',
      'Member must have verified attendance before they can be rated',
    );
  }

  const criteria = await listCriteria();
  const criteriaById = new Map(criteria.map((c) => [c.id, c]));
  const criteriaByCode = new Map(criteria.map((c) => [c.code, c]));

  if (!Array.isArray(scores) || scores.length === 0) {
    throw new AppError(400, 'VALIDATION_ERROR', 'At least one criterion score is required');
  }

  const normalized = scores.map((s) => {
    const criterion =
      (s.criterionId && criteriaById.get(s.criterionId)) ||
      (s.code && criteriaByCode.get(s.code));
    if (!criterion) throw new AppError(400, 'INVALID_CRITERION', 'Unknown rating criterion');
    const score = Number(s.score);
    if (score < criterion.min_score || score > criterion.max_score) {
      throw new AppError(400, 'INVALID_SCORE', `Score out of range for ${criterion.name}`);
    }
    return { criterionId: criterion.id, score };
  });

  const overall =
    normalized.reduce((sum, s) => sum + s.score, 0) / normalized.length;

  const rating = await withTransaction(async (client) => {
    const existingRating = await client.query(
      `SELECT id FROM trip_ratings
       WHERE trip_id = $1 AND member_id = $2 AND rated_by = $3`,
      [tripId, memberId, actor.id],
    );
    if (existingRating.rows[0] && payload.allowUpdate !== true) {
      throw new AppError(
        409,
        'ALREADY_RATED',
        'This member has already been rated for this drive',
      );
    }

    const inserted = await client.query(
      `INSERT INTO trip_ratings (trip_id, member_id, rated_by, overall_score, private_feedback, public_notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (trip_id, member_id, rated_by) DO UPDATE SET
         overall_score = EXCLUDED.overall_score,
         private_feedback = EXCLUDED.private_feedback,
         public_notes = EXCLUDED.public_notes,
         updated_at = NOW()
       RETURNING *`,
      [tripId, memberId, actor.id, overall, privateFeedback || null, publicNotes || null],
    );

    const ratingId = inserted.rows[0].id;
    await client.query(`DELETE FROM trip_rating_scores WHERE rating_id = $1`, [ratingId]);

    for (const s of normalized) {
      await client.query(
        `INSERT INTO trip_rating_scores (rating_id, criterion_id, score) VALUES ($1,$2,$3)`,
        [ratingId, s.criterionId, s.score],
      );
    }

    let upgradeRequest = null;
    if (recommendUpgradeTo) {
      if (!hasPermission(actor, 'upgrades.recommend')) {
        throw new AppError(403, 'FORBIDDEN', 'Cannot recommend upgrades');
      }

      const member = await client.query(
        `SELECT membership_level_id FROM member_profiles WHERE id = $1`,
        [memberId],
      );
      const toLevel = await client.query(
        `SELECT id FROM membership_levels WHERE lower(code) = lower($1) OR lower(name) = lower($1)`,
        [recommendUpgradeTo],
      );
      if (!toLevel.rows[0]) throw new AppError(400, 'INVALID_LEVEL', 'Unknown membership level');

      const upgrade = await client.query(
        `INSERT INTO membership_upgrade_requests (
           member_id, from_level_id, to_level_id, recommended_by, trip_id, rating_id, recommendation_notes, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
         RETURNING *`,
        [
          memberId,
          member.rows[0]?.membership_level_id || null,
          toLevel.rows[0].id,
          actor.id,
          tripId,
          ratingId,
          payload.recommendationNotes || null,
        ],
      );
      upgradeRequest = upgrade.rows[0];
    }

    return { rating: inserted.rows[0], upgradeRequest };
  });

  await writeAudit({
    actorId: actor.id,
    action: 'rating.create',
    entityType: 'trip_ratings',
    entityId: rating.rating.id,
    metadata: { tripId, memberId, recommendUpgradeTo: recommendUpgradeTo || null },
    req,
  });

  return rating;
}

async function listUpgradeRequests({
  status = 'pending',
  page = 1,
  limit = 20,
  recommendedBy = null,
} = {}) {
  const params = [];
  const where = [];
  if (status && status !== 'all') {
    params.push(status);
    where.push(`ur.status = $${params.length}`);
  }
  if (recommendedBy) {
    params.push(recommendedBy);
    where.push(`ur.recommended_by = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, (page - 1) * limit);

  const res = await query(
    `SELECT ur.*,
            mp.first_name AS member_first_name, mp.last_name AS member_last_name, mp.username AS member_username,
            rb.first_name AS recommender_first_name, rb.last_name AS recommender_last_name,
            fl.name AS from_level_name, tl.name AS to_level_name,
            t.title AS trip_title
     FROM membership_upgrade_requests ur
     JOIN member_profiles mp ON mp.id = ur.member_id
     JOIN member_profiles rb ON rb.id = ur.recommended_by
     LEFT JOIN membership_levels fl ON fl.id = ur.from_level_id
     JOIN membership_levels tl ON tl.id = ur.to_level_id
     LEFT JOIN trips t ON t.id = ur.trip_id
     ${whereSql}
     ORDER BY ur.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return res.rows;
}

async function listMyUpgradeRecommendations(actor, { status = 'all', page = 1, limit = 50 } = {}) {
  if (!hasPermission(actor, 'upgrades.recommend') && !hasPermission(actor, 'upgrades.review')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot view upgrade recommendations');
  }
  return listUpgradeRequests({
    status,
    page,
    limit,
    recommendedBy: actor.id,
  });
}

async function reviewUpgradeRequest(id, { decision, decisionNotes }, actor, req) {
  if (!hasPermission(actor, 'upgrades.review')) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot review upgrade requests');
  }

  if (!['approved', 'rejected'].includes(decision)) {
    throw new AppError(400, 'INVALID_DECISION', 'Decision must be approved or rejected');
  }

  const existing = await query(`SELECT * FROM membership_upgrade_requests WHERE id = $1`, [id]);
  if (!existing.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Upgrade request not found');
  const reqRow = existing.rows[0];

  if (reqRow.status !== 'pending') {
    throw new AppError(409, 'ALREADY_REVIEWED', 'Request already reviewed');
  }

  // Marshall must never approve their own recommendation
  if (reqRow.recommended_by === actor.id) {
    throw new AppError(403, 'FORBIDDEN', 'Cannot review your own upgrade recommendation');
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE membership_upgrade_requests SET
         status = $1, reviewed_by = $2, reviewed_at = NOW(), decision_notes = $3
       WHERE id = $4`,
      [decision, actor.id, decisionNotes || null, id],
    );

    if (decision === 'approved') {
      const member = await client.query(
        `SELECT membership_level_id FROM member_profiles WHERE id = $1 FOR UPDATE`,
        [reqRow.member_id],
      );

      await client.query(
        `UPDATE member_profiles SET membership_level_id = $1 WHERE id = $2`,
        [reqRow.to_level_id, reqRow.member_id],
      );

      await client.query(
        `INSERT INTO membership_history (
           member_id, from_level_id, to_level_id, change_reason, upgrade_request_id, changed_by
         ) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          reqRow.member_id,
          member.rows[0]?.membership_level_id || null,
          reqRow.to_level_id,
          'upgrade_approved',
          id,
          actor.id,
        ],
      );
    }
  });

  await writeAudit({
    actorId: actor.id,
    action: `upgrade.${decision}`,
    entityType: 'membership_upgrade_requests',
    entityId: id,
    metadata: { decisionNotes },
    req,
  });

  await createNotification({
    userId: reqRow.member_id,
    type: 'upgrade',
    title: decision === 'approved' ? 'Membership upgraded' : 'Upgrade request declined',
    body:
      decision === 'approved'
        ? 'Your membership level has been updated.'
        : 'A membership upgrade recommendation was not approved.',
    data: { upgradeRequestId: id, decision },
  });

  await createNotification({
    userId: reqRow.recommended_by,
    type: 'upgrade',
    title: `Upgrade recommendation ${decision}`,
    body: `Your recommendation was ${decision}.`,
    data: { upgradeRequestId: id, decision },
  });

  cachePresets.rating(`upgrade.${decision}`);
  return query(`SELECT * FROM membership_upgrade_requests WHERE id = $1`, [id]).then(
    (r) => r.rows[0],
  );
}

async function correctRating(ratingId, payload, actor, req) {
  // Controlled correction: Admin only (not Marshall re-submit)
  if (!hasPermission(actor, 'upgrades.review') && !hasPermission(actor, 'trips.manage')) {
    throw new AppError(403, 'FORBIDDEN', 'Only Admins can correct ratings');
  }

  const reason = (payload.reason || '').trim();
  if (reason.length < 3) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Correction reason is required');
  }

  const existing = await query(`SELECT * FROM trip_ratings WHERE id = $1`, [ratingId]);
  if (!existing.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Rating not found');
  const row = existing.rows[0];

  const prevScoresRes = await query(
    `SELECT rs.criterion_id AS "criterionId", rc.code, rc.name, rs.score
     FROM trip_rating_scores rs
     JOIN rating_criteria rc ON rc.id = rs.criterion_id
     WHERE rs.rating_id = $1`,
    [ratingId],
  );
  const previousScores = prevScoresRes.rows;

  let normalized = previousScores.map((s) => ({
    criterionId: s.criterionId,
    score: Number(s.score),
  }));

  if (Array.isArray(payload.scores) && payload.scores.length > 0) {
    const criteria = await listCriteria({ includeInactive: true });
    const criteriaById = new Map(criteria.map((c) => [c.id, c]));
    const criteriaByCode = new Map(criteria.map((c) => [c.code, c]));
    normalized = payload.scores.map((s) => {
      const criterion =
        (s.criterionId && criteriaById.get(s.criterionId)) ||
        (s.code && criteriaByCode.get(s.code));
      if (!criterion) throw new AppError(400, 'INVALID_CRITERION', 'Unknown rating criterion');
      const score = Number(s.score);
      if (score < criterion.min_score || score > criterion.max_score) {
        throw new AppError(400, 'INVALID_SCORE', `Score out of range for ${criterion.name}`);
      }
      return { criterionId: criterion.id, score };
    });
  }

  const overall =
    normalized.reduce((sum, s) => sum + s.score, 0) / Math.max(normalized.length, 1);
  const nextPrivate =
    payload.privateFeedback !== undefined ? payload.privateFeedback : row.private_feedback;
  const nextPublic =
    payload.publicNotes !== undefined ? payload.publicNotes : row.public_notes;

  const updated = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO trip_rating_history (
         rating_id, changed_by,
         previous_overall_score, new_overall_score,
         previous_scores, new_scores,
         previous_private_feedback, new_private_feedback,
         previous_public_notes, new_public_notes,
         reason
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)`,
      [
        ratingId,
        actor.id,
        row.overall_score,
        overall,
        JSON.stringify(previousScores),
        JSON.stringify(normalized),
        row.private_feedback,
        nextPrivate || null,
        row.public_notes,
        nextPublic || null,
        reason,
      ],
    );

    const result = await client.query(
      `UPDATE trip_ratings SET
         overall_score = $1,
         private_feedback = $2,
         public_notes = $3,
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [overall, nextPrivate || null, nextPublic || null, ratingId],
    );

    await client.query(`DELETE FROM trip_rating_scores WHERE rating_id = $1`, [ratingId]);
    for (const s of normalized) {
      await client.query(
        `INSERT INTO trip_rating_scores (rating_id, criterion_id, score) VALUES ($1,$2,$3)`,
        [ratingId, s.criterionId, s.score],
      );
    }

    return result.rows[0];
  });

  await writeAudit({
    actorId: actor.id,
    action: 'rating.correct',
    entityType: 'trip_ratings',
    entityId: ratingId,
    metadata: { reason, previousOverall: row.overall_score, newOverall: overall },
    req,
  });

  cachePresets.rating('rating.correct');
  return getRatingDetail(ratingId);
}

async function getRatingDetail(ratingId) {
  const res = await query(
    `SELECT tr.*,
            mp.first_name AS member_first_name, mp.last_name AS member_last_name,
            rb.first_name AS rater_first_name, rb.last_name AS rater_last_name,
            t.title AS trip_title,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'criterionId', rs.criterion_id,
                 'code', rc.code,
                 'name', rc.name,
                 'score', rs.score
               ))
               FROM trip_rating_scores rs
               JOIN rating_criteria rc ON rc.id = rs.criterion_id
               WHERE rs.rating_id = tr.id),
              '[]'::json
            ) AS scores,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', h.id,
                 'reason', h.reason,
                 'previousOverall', h.previous_overall_score,
                 'newOverall', h.new_overall_score,
                 'changedBy', h.changed_by,
                 'createdAt', h.created_at
               ) ORDER BY h.created_at DESC)
               FROM trip_rating_history h
               WHERE h.rating_id = tr.id),
              '[]'::json
            ) AS history
     FROM trip_ratings tr
     JOIN member_profiles mp ON mp.id = tr.member_id
     JOIN member_profiles rb ON rb.id = tr.rated_by
     JOIN trips t ON t.id = tr.trip_id
     WHERE tr.id = $1`,
    [ratingId],
  );
  if (!res.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Rating not found');
  return res.rows[0];
}

async function listRatings({ tripId, memberId, page = 1, limit = 20 } = {}) {
  const where = [];
  const params = [];
  if (tripId) {
    params.push(tripId);
    where.push(`tr.trip_id = $${params.length}`);
  }
  if (memberId) {
    params.push(memberId);
    where.push(`tr.member_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit, (page - 1) * limit);

  const res = await query(
    `SELECT tr.*,
            mp.first_name AS member_first_name, mp.last_name AS member_last_name,
            rb.first_name AS rater_first_name, rb.last_name AS rater_last_name,
            t.title AS trip_title,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'criterionId', rs.criterion_id,
                 'code', rc.code,
                 'name', rc.name,
                 'score', rs.score
               ))
               FROM trip_rating_scores rs
               JOIN rating_criteria rc ON rc.id = rs.criterion_id
               WHERE rs.rating_id = tr.id),
              '[]'::json
            ) AS scores
     FROM trip_ratings tr
     JOIN member_profiles mp ON mp.id = tr.member_id
     JOIN member_profiles rb ON rb.id = tr.rated_by
     JOIN trips t ON t.id = tr.trip_id
     ${whereSql}
     ORDER BY tr.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return res.rows;
}

module.exports = {
  listCriteria,
  upsertCriterion,
  createRating,
  correctRating,
  getRatingDetail,
  listUpgradeRequests,
  listMyUpgradeRecommendations,
  reviewUpgradeRequest,
  listRatings,
};
