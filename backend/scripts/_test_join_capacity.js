/**
 * Concurrent last-slot capacity race test using the same locking pattern as joinTrip.
 * Does not create auth users — exercises SELECT … FOR UPDATE + occupancy count.
 */
const { withTransaction, query } = require('../src/config/db');

async function attemptClaim(tripId, label) {
  return withTransaction(async (client) => {
    const tripRes = await client.query(
      `SELECT * FROM trips WHERE id = $1 AND deleted_at IS NULL FOR UPDATE OF t`,
      [tripId],
    ).catch(async () => {
      // FOR UPDATE OF alias may fail depending on query shape — match joinTrip
      return client.query(
        `SELECT t.* FROM trips t WHERE t.id = $1 AND t.deleted_at IS NULL FOR UPDATE OF t`,
        [tripId],
      );
    });

    const trip = tripRes.rows[0];
    if (!trip) throw new Error(`${label}: trip missing`);
    if (trip.status !== 'published') throw new Error(`${label}: closed`);

    const countRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM trip_registrations
       WHERE trip_id = $1 AND status IN ('registered', 'pending')`,
      [tripId],
    );
    if (countRes.rows[0].n >= trip.max_participants) {
      const err = new Error(`${label}: TRIP_FULL`);
      err.code = 'TRIP_FULL';
      throw err;
    }

    // Simulate holding the seat with a short critical section delay
    await new Promise((r) => setTimeout(r, 50));

    const inserted = await client.query(
      `INSERT INTO trip_registrations (trip_id, user_id, status)
       VALUES ($1, $2, 'registered')
       RETURNING id, status`,
      [tripId, label === 'A' ? 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    );
    return { label, status: inserted.rows[0].status };
  });
}

async function main() {
  // Use a real approved member for FK, or skip if none
  const members = await query(
    `SELECT id FROM member_profiles WHERE status = 'approved' AND deleted_at IS NULL LIMIT 2`,
  );
  if (members.rows.length < 2) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: 'Need at least 2 approved members to run capacity race test',
      }),
    );
    return;
  }

  const userA = members.rows[0].id;
  const userB = members.rows[1].id;

  const tripId = (
    await query(
      `INSERT INTO trips (
         title, description, destination, trip_date, max_participants, status, published_at
       ) VALUES (
         'Capacity Race Test', 'auto', 'Test Range', CURRENT_DATE + 7, 1, 'published', NOW()
       ) RETURNING id`,
    )
  ).rows[0].id;

  const claim = async (userId, label) =>
    withTransaction(async (client) => {
      const tripRes = await client.query(
        `SELECT t.* FROM trips t WHERE t.id = $1 AND t.deleted_at IS NULL FOR UPDATE OF t`,
        [tripId],
      );
      const trip = tripRes.rows[0];
      const countRes = await client.query(
        `SELECT COUNT(*)::int AS n FROM trip_registrations
         WHERE trip_id = $1 AND status IN ('registered', 'pending')`,
        [tripId],
      );
      if (countRes.rows[0].n >= trip.max_participants) {
        const err = new Error('TRIP_FULL');
        err.code = 'TRIP_FULL';
        throw err;
      }
      await new Promise((r) => setTimeout(r, 80));
      await client.query(
        `INSERT INTO trip_registrations (trip_id, user_id, status)
         VALUES ($1,$2,'registered')
         ON CONFLICT (trip_id, user_id) DO UPDATE
           SET status = 'registered', cancelled_at = NULL, updated_at = NOW()`,
        [tripId, userId],
      );
      return { label, ok: true };
    });

  const results = await Promise.allSettled([
    claim(userA, 'A'),
    claim(userB, 'B'),
  ]);

  const regs = await query(
    `SELECT user_id, status FROM trip_registrations WHERE trip_id = $1`,
    [tripId],
  );
  const registered = regs.rows.filter((r) => r.status === 'registered');

  const report = {
    settled: results.map((r) =>
      r.status === 'fulfilled'
        ? { ok: true, label: r.value.label }
        : { ok: false, code: r.reason?.code || 'ERROR', message: r.reason?.message },
    ),
    registeredCount: registered.length,
    capacityRespected: registered.length <= 1,
  };
  console.log(JSON.stringify(report, null, 2));

  await query(`DELETE FROM trip_registrations WHERE trip_id = $1`, [tripId]);
  await query(`DELETE FROM trips WHERE id = $1`, [tripId]);

  if (!report.capacityRespected) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
