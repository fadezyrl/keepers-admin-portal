/**
 * Ownership-aware registration review + capacity / re-review guards.
 */
const { query } = require('../src/config/db');
const tripService = require('../src/services/tripService');
const { AppError } = require('../src/utils/AppError');

async function makeTrip(organizerId, { maxParticipants = 2, status = 'published' } = {}) {
  const res = await query(
    `INSERT INTO trips (
       title, description, destination, trip_date, max_participants, status,
       published_at, cancelled_at, created_by, organizer_id
     ) VALUES (
       'Reg Review Spec', 'auto', 'Range', CURRENT_DATE + 14, $2, $3,
       CASE WHEN $3 = 'published' THEN NOW() ELSE NULL END,
       CASE WHEN $3 = 'cancelled' THEN NOW() ELSE NULL END,
       $1, $1
     ) RETURNING id`,
    [organizerId, maxParticipants, status],
  );
  return res.rows[0].id;
}

async function makePending(tripId, userId) {
  const res = await query(
    `INSERT INTO trip_registrations (trip_id, user_id, status)
     VALUES ($1, $2, 'pending')
     RETURNING id`,
    [tripId, userId],
  );
  return res.rows[0].id;
}

async function cleanupTrip(tripId) {
  await query(`DELETE FROM trip_registrations WHERE trip_id = $1`, [tripId]);
  await query(`DELETE FROM trips WHERE id = $1`, [tripId]);
}

async function main() {
  const members = await query(
    `SELECT mp.id,
            COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
     FROM member_profiles mp
     LEFT JOIN user_roles ur ON ur.user_id = mp.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE mp.status = 'approved' AND mp.deleted_at IS NULL
     GROUP BY mp.id
     LIMIT 40`,
  );

  const marshallA = members.rows.find((m) => m.roles.includes('marshall'));
  const marshallB = members.rows.find(
    (m) => m.roles.includes('marshall') && m.id !== marshallA?.id,
  );
  const memberRows = members.rows.filter(
    (m) => m.id !== marshallA?.id && m.id !== marshallB?.id,
  );
  const adminRow = members.rows.find(
    (m) => m.roles.includes('admin') || m.roles.includes('super_admin'),
  );

  if (!marshallA || memberRows.length < 2) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason: 'Need marshall + at least 2 other approved members',
      }),
    );
    return;
  }

  const actorMarshallA = {
    id: marshallA.id,
    permissions: ['trips.create', 'trips.manage_own', 'trips.read'],
    roles: ['marshall'],
  };
  const actorMarshallB = marshallB
    ? {
        id: marshallB.id,
        permissions: ['trips.create', 'trips.manage_own', 'trips.read'],
        roles: ['marshall'],
      }
    : null;
  const actorAdmin = adminRow
    ? {
        id: adminRow.id,
        permissions: ['registrations.manage', 'trips.manage'],
        roles: adminRow.roles,
      }
    : null;
  const actorMember = {
    id: memberRows[0].id,
    permissions: ['trips.read'],
    roles: ['member'],
  };
  const actorPre = {
    id: memberRows[0].id,
    permissions: ['trips.read', 'attendance.mark'],
    roles: ['pre_marshall'],
  };

  const report = {
    marshallApproveOwn: false,
    marshallRejectOwn: false,
    marshallOtherForbidden: false,
    memberForbidden: false,
    preMarshallForbidden: false,
    alreadyReviewed: false,
    cancelledTripBlocked: false,
    tripFull: false,
    concurrentNoOverbook: false,
    adminAny: false,
  };

  const ownTripId = await makeTrip(marshallA.id, { maxParticipants: 3 });
  const rejectTripId = await makeTrip(marshallA.id, { maxParticipants: 3 });
  const closedTripId = await makeTrip(marshallA.id, {
    maxParticipants: 3,
    status: 'cancelled',
  });
  const fullTripId = await makeTrip(marshallA.id, { maxParticipants: 1 });
  const raceTripId = await makeTrip(marshallA.id, { maxParticipants: 1 });
  const otherTripId = marshallB ? await makeTrip(marshallB.id, { maxParticipants: 3 }) : null;

  try {
    const approveRegId = await makePending(ownTripId, memberRows[0].id);
    await tripService.reviewRegistration(
      approveRegId,
      { status: 'registered' },
      actorMarshallA,
      {},
    );
    const approved = await query(`SELECT status FROM trip_registrations WHERE id = $1`, [
      approveRegId,
    ]);
    report.marshallApproveOwn = approved.rows[0]?.status === 'registered';

    try {
      await tripService.reviewRegistration(
        approveRegId,
        { status: 'rejected' },
        actorMarshallA,
        {},
      );
    } catch (err) {
      report.alreadyReviewed =
        err instanceof AppError && err.code === 'ALREADY_REVIEWED';
    }

    const rejectRegId = await makePending(rejectTripId, memberRows[0].id);
    await tripService.reviewRegistration(
      rejectRegId,
      { status: 'rejected' },
      actorMarshallA,
      {},
    );
    const rejected = await query(`SELECT status FROM trip_registrations WHERE id = $1`, [
      rejectRegId,
    ]);
    report.marshallRejectOwn = rejected.rows[0]?.status === 'rejected';

    if (otherTripId && actorMarshallB) {
      const foreignReg = await makePending(otherTripId, memberRows[0].id);
      try {
        await tripService.reviewRegistration(
          foreignReg,
          { status: 'registered' },
          actorMarshallA,
          {},
        );
      } catch (err) {
        report.marshallOtherForbidden =
          err instanceof AppError && err.status === 403;
      }
    } else {
      report.marshallOtherForbidden = true;
    }

    const memberReg = await makePending(ownTripId, memberRows[1].id);
    try {
      await tripService.reviewRegistration(
        memberReg,
        { status: 'registered' },
        actorMember,
        {},
      );
    } catch (err) {
      report.memberForbidden = err instanceof AppError && err.status === 403;
    }

    try {
      await tripService.reviewRegistration(
        memberReg,
        { status: 'registered' },
        actorPre,
        {},
      );
    } catch (err) {
      report.preMarshallForbidden = err instanceof AppError && err.status === 403;
    }

    const closedReg = await makePending(closedTripId, memberRows[0].id);
    try {
      await tripService.reviewRegistration(
        closedReg,
        { status: 'registered' },
        actorMarshallA,
        {},
      );
    } catch (err) {
      report.cancelledTripBlocked =
        err instanceof AppError && err.code === 'TRIP_CLOSED';
    }

    await query(
      `INSERT INTO trip_registrations (trip_id, user_id, status)
       VALUES ($1, $2, 'registered')`,
      [fullTripId, memberRows[0].id],
    );
    const fullPending = await makePending(fullTripId, memberRows[1].id);
    try {
      await tripService.reviewRegistration(
        fullPending,
        { status: 'registered' },
        actorMarshallA,
        {},
      );
    } catch (err) {
      report.tripFull = err instanceof AppError && err.code === 'TRIP_FULL';
    }

    // Waitlist rows do not hold capacity; concurrent approve→registered is the
    // overbook race the FOR UPDATE lock must prevent (admin-style transition).
    if (actorAdmin) {
      const raceA = (
        await query(
          `INSERT INTO trip_registrations (trip_id, user_id, status)
           VALUES ($1, $2, 'waitlist') RETURNING id`,
          [raceTripId, memberRows[0].id],
        )
      ).rows[0].id;
      const raceB = (
        await query(
          `INSERT INTO trip_registrations (trip_id, user_id, status)
           VALUES ($1, $2, 'waitlist') RETURNING id`,
          [raceTripId, memberRows[1].id],
        )
      ).rows[0].id;
      const results = await Promise.allSettled([
        tripService.reviewRegistration(
          raceA,
          { status: 'registered' },
          actorAdmin,
          {},
        ),
        tripService.reviewRegistration(
          raceB,
          { status: 'registered' },
          actorAdmin,
          {},
        ),
      ]);
      const registeredCount = (
        await query(
          `SELECT COUNT(*)::int AS n FROM trip_registrations
           WHERE trip_id = $1 AND status = 'registered'`,
          [raceTripId],
        )
      ).rows[0].n;
      const oneFull = results.some(
        (r) =>
          r.status === 'rejected' &&
          r.reason instanceof AppError &&
          r.reason.code === 'TRIP_FULL',
      );
      const oneOk = results.some((r) => r.status === 'fulfilled');
      report.concurrentNoOverbook = registeredCount === 1 && oneOk && oneFull;
    } else {
      report.concurrentNoOverbook = true;
    }

    if (actorAdmin) {
      const adminTrip = await makeTrip(marshallA.id, { maxParticipants: 3 });
      const adminReg = await makePending(adminTrip, memberRows[0].id);
      await tripService.reviewRegistration(
        adminReg,
        { status: 'registered' },
        actorAdmin,
        {},
      );
      const adminStatus = await query(
        `SELECT status FROM trip_registrations WHERE id = $1`,
        [adminReg],
      );
      report.adminAny = adminStatus.rows[0]?.status === 'registered';
      await cleanupTrip(adminTrip);
    } else {
      report.adminAny = true;
    }
  } finally {
    await cleanupTrip(ownTripId);
    await cleanupTrip(rejectTripId);
    await cleanupTrip(closedTripId);
    await cleanupTrip(fullTripId);
    await cleanupTrip(raceTripId);
    if (otherTripId) await cleanupTrip(otherTripId);
  }

  const passed = Object.values(report).every(Boolean);
  console.log(JSON.stringify({ passed, report }, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
