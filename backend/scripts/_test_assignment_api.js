const { query } = require('../src/config/db');
const tripService = require('../src/services/tripService');

async function main() {
  const admin = {
    id: (
      await query(
        `SELECT mp.id FROM member_profiles mp
         JOIN user_roles ur ON ur.user_id = mp.id
         JOIN roles r ON r.id = ur.role_id
         WHERE r.code IN ('admin','super_admin') AND mp.deleted_at IS NULL
         LIMIT 1`,
      )
    ).rows[0]?.id,
    permissions: ['trips.manage', 'trips.read', 'roles.assign'],
    roles: ['admin'],
  };
  if (!admin.id) {
    console.log(JSON.stringify({ skipped: true, reason: 'No admin member' }));
    return;
  }

  const pre = (
    await query(
      `SELECT mp.id FROM member_profiles mp
       JOIN user_roles ur ON ur.user_id = mp.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code = 'pre_marshall' AND mp.deleted_at IS NULL
       LIMIT 1`,
    )
  ).rows[0];

  const trip = (
    await query(
      `INSERT INTO trips (title, description, destination, trip_date, max_participants, status, published_at)
       VALUES ('Assignment Test Drive', 'auto', 'Test', CURRENT_DATE + 3, 10, 'published', NOW())
       RETURNING id, title`,
    )
  ).rows[0];

  const report = { tripId: trip.id, assigned: false, listed: 0, assignedTrips: 0 };

  if (pre) {
    await tripService.assignPreMarshall(
      trip.id,
      { userId: pre.id, notes: 'QA assignment' },
      admin,
      {},
    );
    const listed = await tripService.listPreMarshallAssignments(trip.id, admin);
    report.assigned = listed.some((a) => a.userId === pre.id);
    report.listed = listed.length;

    const assignedTrips = await tripService.listMyAssignedTrips(
      { id: pre.id, permissions: ['trips.read'], roles: ['pre_marshall'] },
      {},
    );
    report.assignedTrips = assignedTrips.items.filter((t) => t.id === trip.id).length;

    await tripService.unassignPreMarshall(trip.id, pre.id, admin, {});
  } else {
    report.skippedPreMarshall = true;
  }

  await query(`DELETE FROM trip_pre_marshall_assignments WHERE trip_id = $1`, [trip.id]);
  await query(`DELETE FROM trips WHERE id = $1`, [trip.id]);
  console.log(JSON.stringify(report, null, 2));
  if (pre && (!report.assigned || report.assignedTrips !== 1)) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
