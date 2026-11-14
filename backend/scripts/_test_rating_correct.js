const { query } = require('../src/config/db');
const ratingService = require('../src/services/ratingService');

async function main() {
  const rating = (
    await query(`SELECT id FROM trip_ratings ORDER BY created_at DESC LIMIT 1`)
  ).rows[0];
  if (!rating) {
    console.log(JSON.stringify({ skipped: true, reason: 'No ratings in DB' }));
    return;
  }

  const admin = {
    id: (
      await query(
        `SELECT mp.id FROM member_profiles mp
         JOIN user_roles ur ON ur.user_id = mp.id
         JOIN roles r ON r.id = ur.role_id
         WHERE r.code IN ('admin','super_admin') LIMIT 1`,
      )
    ).rows[0]?.id,
    permissions: ['upgrades.review', 'trips.manage'],
    roles: ['admin'],
  };
  if (!admin.id) {
    console.log(JSON.stringify({ skipped: true, reason: 'No admin' }));
    return;
  }

  const detail = await ratingService.getRatingDetail(rating.id);
  const scores = (detail.scores || []).map((s) => ({
    criterionId: s.criterionId,
    score: Number(s.score),
  }));
  if (!scores.length) {
    console.log(JSON.stringify({ skipped: true, reason: 'Rating has no scores' }));
    return;
  }

  const marshall = {
    id: detail.rated_by,
    permissions: ['ratings.create'],
    roles: ['marshall'],
  };

  let marshallBlocked = false;
  try {
    await ratingService.correctRating(
      rating.id,
      { reason: 'marshall should fail', scores },
      marshall,
      {},
    );
  } catch (err) {
    marshallBlocked = err.code === 'FORBIDDEN';
  }

  const corrected = await ratingService.correctRating(
    rating.id,
    {
      reason: 'Admin QA correction smoke test',
      scores,
      publicNotes: detail.public_notes || 'QA note',
    },
    admin,
    {},
  );

  console.log(
    JSON.stringify(
      {
        marshallBlocked,
        historyCount: (corrected.history || []).length,
        ok: marshallBlocked && (corrected.history || []).length >= 1,
      },
      null,
      2,
    ),
  );
  if (!marshallBlocked || !(corrected.history || []).length) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
