const { query } = require('../config/db');
const { AppError } = require('../utils/AppError');

const TREND_LIMIT = 8;

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round1(value) {
  const n = num(value);
  if (n == null) return null;
  return Math.round(n * 10) / 10;
}

async function getMemberProfile(userId) {
  const res = await query(
    `SELECT mp.id, mp.first_name, mp.last_name, mp.completed_trips,
            mp.membership_level_id,
            ml.code AS membership_code, ml.name AS membership_name, ml.rank AS membership_rank,
            ml.description AS membership_description
     FROM member_profiles mp
     LEFT JOIN membership_levels ml ON ml.id = mp.membership_level_id
     WHERE mp.id = $1 AND mp.deleted_at IS NULL`,
    [userId],
  );
  if (!res.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Member not found');
  return res.rows[0];
}

async function getLevels() {
  const res = await query(
    `SELECT id, code, name, rank, description,
            min_completed_trips, min_average_rating
     FROM membership_levels
     WHERE is_active = TRUE
     ORDER BY rank ASC`,
  );
  return res.rows;
}

async function getStats(userId) {
  const [counts, categoryAvg, trend, criteria] = await Promise.all([
    query(
      `SELECT
         (
           SELECT COUNT(*)::INT
           FROM trip_attendance ta
           JOIN trips t ON t.id = ta.trip_id
           WHERE ta.user_id = $1
             AND ta.attended = TRUE
             AND t.status = 'completed'
             AND t.deleted_at IS NULL
         ) AS completed_trips,
         (
           SELECT COUNT(*)::INT
           FROM trip_attendance ta
           JOIN trips t ON t.id = ta.trip_id
           WHERE ta.user_id = $1
             AND ta.attended = TRUE
             AND t.deleted_at IS NULL
         ) AS attended_drives,
         (
           SELECT COUNT(*)::INT
           FROM trip_ratings tr
           WHERE tr.member_id = $1
         ) AS ratings_received,
         (
           SELECT AVG(tr.overall_score)
           FROM trip_ratings tr
           WHERE tr.member_id = $1
             AND tr.overall_score IS NOT NULL
         ) AS overall_average`,
      [userId],
    ),
    query(
      `SELECT rc.id, rc.code, rc.name, rc.display_order,
              AVG(member_scores.score)::float AS average,
              COUNT(member_scores.score)::INT AS sample_size
       FROM rating_criteria rc
       LEFT JOIN (
         SELECT trs.criterion_id, trs.score
         FROM trip_rating_scores trs
         JOIN trip_ratings tr ON tr.id = trs.rating_id
         WHERE tr.member_id = $1
       ) member_scores ON member_scores.criterion_id = rc.id
       WHERE rc.is_active = TRUE
       GROUP BY rc.id, rc.code, rc.name, rc.display_order
       ORDER BY rc.display_order ASC, rc.name ASC`,
      [userId],
    ),
    query(
      `SELECT tr.overall_score, tr.created_at, t.id AS trip_id, t.title, t.trip_date
       FROM trip_ratings tr
       JOIN trips t ON t.id = tr.trip_id
       WHERE tr.member_id = $1
         AND tr.overall_score IS NOT NULL
         AND t.deleted_at IS NULL
       ORDER BY t.trip_date DESC NULLS LAST, tr.created_at DESC
       LIMIT $2`,
      [userId, TREND_LIMIT],
    ),
    query(
      `SELECT id, code, name, description, min_score, max_score, display_order
       FROM rating_criteria
       WHERE is_active = TRUE
       ORDER BY display_order ASC, name ASC`,
    ),
  ]);

  const row = counts.rows[0] || {};
  return {
    completedTrips: Number(row.completed_trips || 0),
    attendedDrives: Number(row.attended_drives || 0),
    ratingsReceived: Number(row.ratings_received || 0),
    overallAverage: round1(row.overall_average),
    categoryAverages: categoryAvg.rows.map((c) => ({
      criterionId: c.id,
      code: c.code,
      name: c.name,
      average: c.sample_size > 0 ? round1(c.average) : null,
      sampleSize: Number(c.sample_size || 0),
    })),
    ratingTrend: trend.rows
      .map((t) => ({
        tripId: t.trip_id,
        title: t.title,
        date: t.trip_date,
        overall: round1(t.overall_score),
        ratedAt: t.created_at,
      }))
      .reverse(),
    criteria: criteria.rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      minScore: c.min_score,
      maxScore: c.max_score,
      displayOrder: c.display_order,
    })),
  };
}

async function getUpgradeState(userId, profile, levels, stats) {
  const currentRank = profile.membership_rank ?? 0;
  const current =
    levels.find((l) => l.id === profile.membership_level_id) ||
    levels.find((l) => l.code === profile.membership_code) ||
    null;
  const next = levels.find((l) => l.rank > currentRank) || null;

  const upgrades = await query(
    `SELECT ur.id, ur.status, ur.recommendation_notes, ur.decision_notes,
            ur.created_at, ur.reviewed_at,
            fl.code AS from_code, fl.name AS from_name,
            tl.code AS to_code, tl.name AS to_name,
            rb.first_name AS recommender_first_name,
            rb.last_name AS recommender_last_name
     FROM membership_upgrade_requests ur
     LEFT JOIN membership_levels fl ON fl.id = ur.from_level_id
     JOIN membership_levels tl ON tl.id = ur.to_level_id
     JOIN member_profiles rb ON rb.id = ur.recommended_by
     WHERE ur.member_id = $1
     ORDER BY ur.created_at DESC
     LIMIT 20`,
    [userId],
  );

  const history = await query(
    `SELECT mh.id, mh.change_reason, mh.created_at,
            fl.code AS from_code, fl.name AS from_name,
            tl.code AS to_code, tl.name AS to_name
     FROM membership_history mh
     LEFT JOIN membership_levels fl ON fl.id = mh.from_level_id
     JOIN membership_levels tl ON tl.id = mh.to_level_id
     WHERE mh.member_id = $1
     ORDER BY mh.created_at DESC
     LIMIT 20`,
    [userId],
  );

  const pending = upgrades.rows.find((u) => u.status === 'pending') || null;
  const latest = upgrades.rows[0] || null;

  const requirements = [];
  let eligibleForRecommendation = false;
  let remainingDrives = null;
  let progressRatio = null;

  if (next) {
    const minTrips = Number(next.min_completed_trips || 0);
    const minAvg = num(next.min_average_rating);
    const completed = stats.completedTrips;
    const avg = stats.overallAverage;

    if (minTrips > 0) {
      remainingDrives = Math.max(0, minTrips - completed);
      progressRatio = Math.min(1, completed / minTrips);
      requirements.push({
        code: 'completed_trips',
        label: `Complete ${minTrips} drives`,
        current: completed,
        required: minTrips,
        met: completed >= minTrips,
      });
    } else {
      progressRatio = null;
      requirements.push({
        code: 'completed_trips',
        label: 'No fixed drive-count gate for the next level',
        current: completed,
        required: null,
        met: true,
      });
    }

    if (minAvg != null) {
      requirements.push({
        code: 'average_rating',
        label: `Maintain an average rating of at least ${minAvg}`,
        current: avg,
        required: minAvg,
        met: avg != null && avg >= minAvg,
      });
    }

    requirements.push({
      code: 'marshall_recommendation',
      label: 'A Marshall must recommend your upgrade after a drive',
      current: pending || latest?.status === 'approved' ? 1 : 0,
      required: 1,
      met: Boolean(pending) || latest?.status === 'approved',
    });

    requirements.push({
      code: 'admin_approval',
      label: 'Admin approval is required after a Marshall recommendation',
      current: latest?.status === 'approved' ? 1 : 0,
      required: 1,
      met: latest?.status === 'approved',
    });

    const quantitativeMet = requirements
      .filter((r) => r.code === 'completed_trips' || r.code === 'average_rating')
      .every((r) => r.met);
    eligibleForRecommendation = quantitativeMet && !pending;
  }

  let upgradeStatus = 'none';
  if (pending) upgradeStatus = 'pending_admin';
  else if (latest?.status === 'approved') upgradeStatus = 'approved';
  else if (latest?.status === 'rejected') upgradeStatus = 'rejected';
  else if (eligibleForRecommendation) upgradeStatus = 'awaiting_recommendation';

  return {
    currentLevel: current
      ? {
          id: current.id,
          code: current.code,
          name: current.name,
          rank: current.rank,
          description: current.description,
        }
      : profile.membership_code
        ? {
            id: profile.membership_level_id,
            code: profile.membership_code,
            name: profile.membership_name,
            rank: profile.membership_rank,
            description: profile.membership_description,
          }
        : null,
    nextLevel: next
      ? {
          id: next.id,
          code: next.code,
          name: next.name,
          rank: next.rank,
          description: next.description,
          minCompletedTrips: Number(next.min_completed_trips || 0),
          minAverageRating: num(next.min_average_rating),
        }
      : null,
    completedTrips: stats.completedTrips,
    remainingDrives,
    progressRatio,
    eligibleForRecommendation,
    upgradeStatus,
    activeRecommendation: pending
      ? {
          id: pending.id,
          status: pending.status,
          toLevel: pending.to_name,
          toCode: pending.to_code,
          fromLevel: pending.from_name,
          recommendedBy: `${pending.recommender_first_name || ''} ${pending.recommender_last_name || ''}`.trim(),
          notes: pending.recommendation_notes || null,
          createdAt: pending.created_at,
        }
      : null,
    latestDecision: latest
      ? {
          id: latest.id,
          status: latest.status,
          toLevel: latest.to_name,
          toCode: latest.to_code,
          fromLevel: latest.from_name,
          recommendedBy: `${latest.recommender_first_name || ''} ${latest.recommender_last_name || ''}`.trim(),
          recommendationNotes: latest.recommendation_notes || null,
          decisionNotes: latest.decision_notes || null,
          createdAt: latest.created_at,
          reviewedAt: latest.reviewed_at,
        }
      : null,
    requirements,
    upgradeHistory: upgrades.rows.map((u) => ({
      id: u.id,
      status: u.status,
      fromLevel: u.from_name,
      toLevel: u.to_name,
      recommendedBy: `${u.recommender_first_name || ''} ${u.recommender_last_name || ''}`.trim(),
      recommendationNotes: u.recommendation_notes || null,
      decisionNotes: u.decision_notes || null,
      createdAt: u.created_at,
      reviewedAt: u.reviewed_at,
    })),
    membershipHistory: history.rows.map((h) => ({
      id: h.id,
      fromLevel: h.from_name,
      toLevel: h.to_name,
      reason: h.change_reason,
      createdAt: h.created_at,
    })),
  };
}

async function getMyProgress(userId) {
  const profile = await getMemberProfile(userId);
  const [levels, stats] = await Promise.all([getLevels(), getStats(userId)]);
  const progression = await getUpgradeState(userId, profile, levels, stats);

  return {
    member: {
      id: profile.id,
      firstName: profile.first_name,
      lastName: profile.last_name,
      name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
    },
    membership: progression.currentLevel,
    stats: {
      completedTrips: stats.completedTrips,
      attendedDrives: stats.attendedDrives,
      ratingsReceived: stats.ratingsReceived,
      overallAverage: stats.overallAverage,
    },
    performance: {
      overallAverage: stats.overallAverage,
      ratingsReceived: stats.ratingsReceived,
      categoryAverages: stats.categoryAverages,
      ratingTrend: stats.ratingTrend,
      criteria: stats.criteria,
    },
    progression,
    levels: levels.map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      rank: l.rank,
      description: l.description,
      minCompletedTrips: Number(l.min_completed_trips || 0),
      minAverageRating: num(l.min_average_rating),
    })),
  };
}

function buildHistoryFilter(filter, params) {
  const clauses = [`(reg.id IS NOT NULL OR att.id IS NOT NULL)`];
  const f = (filter || 'all').toLowerCase();

  if (f === 'attended' || f === 'completed') {
    clauses.push(`att.attended = TRUE`);
    if (f === 'completed') {
      clauses.push(`t.status = 'completed'`);
    }
  } else if (f === 'absent') {
    clauses.push(`att.attended = FALSE`);
  } else if (f === 'cancelled') {
    clauses.push(`reg.status = 'cancelled'`);
  } else if (f === 'upcoming') {
    clauses.push(`t.status = 'published'`);
    clauses.push(`t.trip_date >= CURRENT_DATE`);
    clauses.push(`reg.status IN ('registered', 'waitlist')`);
  }

  return { whereSql: clauses.join(' AND '), filter: f };
}

async function getMyTrips(userId, { filter = 'all', page = 1, limit = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const offset = (safePage - 1) * safeLimit;
  const params = [userId];
  const { whereSql } = buildHistoryFilter(filter, params);

  const countRes = await query(
    `SELECT COUNT(*)::INT AS total
     FROM trips t
     LEFT JOIN trip_registrations reg
       ON reg.trip_id = t.id AND reg.user_id = $1
     LEFT JOIN trip_attendance att
       ON att.trip_id = t.id AND att.user_id = $1
     WHERE t.deleted_at IS NULL
       AND ${whereSql}`,
    params,
  );

  params.push(safeLimit, offset);
  const res = await query(
    `SELECT t.id, t.title, t.destination, t.trip_date, t.trip_time, t.status,
            t.cover_image_url,
            org.first_name AS organizer_first_name,
            org.last_name AS organizer_last_name,
            reg.status AS registration_status,
            att.attended AS attended,
            att.marked_at AS attendance_marked_at,
            tr.id AS rating_id,
            tr.overall_score AS rating_overall,
            tr.created_at AS rated_at,
            rb.first_name AS rater_first_name,
            rb.last_name AS rater_last_name,
            (
              SELECT ml.name
              FROM membership_history mh
              JOIN membership_levels ml ON ml.id = mh.to_level_id
              WHERE mh.member_id = $1
                AND mh.created_at <= COALESCE(t.trip_date::timestamptz, t.created_at)
              ORDER BY mh.created_at DESC
              LIMIT 1
            ) AS membership_at_time
     FROM trips t
     LEFT JOIN member_profiles org ON org.id = t.organizer_id
     LEFT JOIN trip_registrations reg
       ON reg.trip_id = t.id AND reg.user_id = $1
     LEFT JOIN trip_attendance att
       ON att.trip_id = t.id AND att.user_id = $1
     LEFT JOIN LATERAL (
       SELECT r.*
       FROM trip_ratings r
       WHERE r.trip_id = t.id AND r.member_id = $1
       ORDER BY r.created_at DESC
       LIMIT 1
     ) tr ON TRUE
     LEFT JOIN member_profiles rb ON rb.id = tr.rated_by
     WHERE t.deleted_at IS NULL
       AND ${whereSql}
     ORDER BY t.trip_date DESC NULLS LAST, t.created_at DESC
     LIMIT $2 OFFSET $3`,
    params,
  );

  const items = res.rows.map((row) => {
    let attendanceStatus = 'registered';
    if (row.attended === true) attendanceStatus = 'attended';
    else if (row.attended === false) attendanceStatus = 'absent';
    else if (row.registration_status === 'cancelled') attendanceStatus = 'cancelled';
    else if (row.registration_status === 'waitlist') attendanceStatus = 'waitlist';
    else if (row.registration_status === 'rejected') attendanceStatus = 'rejected';
    else if (
      row.status === 'published' &&
      row.trip_date &&
      new Date(row.trip_date) >= new Date(new Date().toDateString())
    ) {
      attendanceStatus = 'upcoming';
    }

    return {
      tripId: row.id,
      title: row.title,
      destination: row.destination,
      date: row.trip_date,
      time: row.trip_time,
      status: row.status,
      coverImage: row.cover_image_url || null,
      organizerName: `${row.organizer_first_name || ''} ${row.organizer_last_name || ''}`.trim() || null,
      registrationStatus: row.registration_status || null,
      attendanceStatus,
      attended: row.attended,
      membershipAtTime: row.membership_at_time || null,
      rating: row.rating_id
        ? {
            id: row.rating_id,
            overall: round1(row.rating_overall),
            ratedAt: row.rated_at,
            marshallName: `${row.rater_first_name || ''} ${row.rater_last_name || ''}`.trim() || null,
          }
        : null,
    };
  });

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: Number(countRes.rows[0]?.total || 0),
      hasMore: offset + items.length < Number(countRes.rows[0]?.total || 0),
    },
  };
}

async function getMyTripPerformance(userId, tripId) {
  const tripRes = await query(
    `SELECT t.id, t.title, t.description, t.destination, t.meeting_point,
            t.trip_date, t.trip_time, t.status, t.cover_image_url, t.difficulty,
            org.first_name AS organizer_first_name,
            org.last_name AS organizer_last_name,
            reg.status AS registration_status,
            att.attended, att.marked_at, att.notes AS attendance_notes
     FROM trips t
     LEFT JOIN member_profiles org ON org.id = t.organizer_id
     LEFT JOIN trip_registrations reg
       ON reg.trip_id = t.id AND reg.user_id = $2
     LEFT JOIN trip_attendance att
       ON att.trip_id = t.id AND att.user_id = $2
     WHERE t.id = $1 AND t.deleted_at IS NULL`,
    [tripId, userId],
  );
  const trip = tripRes.rows[0];
  if (!trip) throw new AppError(404, 'NOT_FOUND', 'Trip not found');
  if (!trip.registration_status && trip.attended == null) {
    throw new AppError(403, 'FORBIDDEN', 'This trip is not in your history');
  }

  const ratingRes = await query(
    `SELECT tr.id, tr.overall_score, tr.public_notes, tr.created_at, tr.updated_at,
            rb.first_name AS rater_first_name, rb.last_name AS rater_last_name,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'criterionId', rs.criterion_id,
                 'code', rc.code,
                 'name', rc.name,
                 'score', rs.score,
                 'minScore', rc.min_score,
                 'maxScore', rc.max_score
               ) ORDER BY rc.display_order, rc.name)
               FROM trip_rating_scores rs
               JOIN rating_criteria rc ON rc.id = rs.criterion_id
               WHERE rs.rating_id = tr.id),
              '[]'::json
            ) AS scores
     FROM trip_ratings tr
     JOIN member_profiles rb ON rb.id = tr.rated_by
     WHERE tr.trip_id = $1 AND tr.member_id = $2
     ORDER BY tr.created_at DESC
     LIMIT 1`,
    [tripId, userId],
  );

  const rating = ratingRes.rows[0] || null;

  return {
    trip: {
      id: trip.id,
      title: trip.title,
      description: trip.description,
      destination: trip.destination,
      meetingPoint: trip.meeting_point,
      date: trip.trip_date,
      time: trip.trip_time,
      status: trip.status,
      coverImage: trip.cover_image_url,
      difficulty: trip.difficulty,
      organizerName: `${trip.organizer_first_name || ''} ${trip.organizer_last_name || ''}`.trim() || null,
    },
    attendance: {
      status:
        trip.attended === true
          ? 'attended'
          : trip.attended === false
            ? 'absent'
            : trip.registration_status || 'unknown',
      attended: trip.attended,
      markedAt: trip.marked_at,
      notes: trip.attendance_notes || null,
      registrationStatus: trip.registration_status,
    },
    rating: rating
      ? {
          id: rating.id,
          overall: round1(rating.overall_score),
          feedback: rating.public_notes || null,
          ratedAt: rating.created_at,
          updatedAt: rating.updated_at,
          marshallName: `${rating.rater_first_name || ''} ${rating.rater_last_name || ''}`.trim(),
          scores: (rating.scores || []).map((s) => ({
            criterionId: s.criterionId,
            code: s.code,
            name: s.name,
            score: Number(s.score),
            minScore: s.minScore,
            maxScore: s.maxScore,
          })),
        }
      : null,
  };
}

module.exports = {
  getMyProgress,
  getMyTrips,
  getMyTripPerformance,
  /** Shared rating/attendance aggregates for public member profiles */
  getStats,
};
