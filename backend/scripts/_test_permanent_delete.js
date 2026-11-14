const { query } = require('../src/config/db');
const tripService = require('../src/services/tripService');
const { AppError } = require('../src/utils/AppError');

async function makeTrip(createdBy) {
  const res = await query(
    `INSERT INTO trips (
       title, description, destination, trip_date, max_participants, status,
       published_at, created_by, organizer_id
     ) VALUES (
       'Permanent Delete Spec', 'auto', 'Range', CURRENT_DATE + 10, 5, 'published',
       NOW(), $1, $1
     ) RETURNING id, created_by`,
    [createdBy],
  );
  return res.rows[0];
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
     LIMIT 20`,
  );

  const adminRow = members.rows.find(
    (m) => m.roles.includes('admin') || m.roles.includes('super_admin'),
  );
  const marshallA = members.rows.find((m) => m.roles.includes('marshall')) || members.rows[0];
  const marshallB =
    members.rows.find((m) => m.id !== marshallA?.id && m.roles.includes('marshall')) ||
    members.rows.find((m) => m.id !== marshallA?.id);

  if (!marshallA) {
    console.log(JSON.stringify({ skipped: true, reason: 'Need approved members' }));
    return;
  }

  const actorAdmin = adminRow
    ? {
        id: adminRow.id,
        permissions: ['trips.manage', 'trips.create', 'trips.manage_own'],
        roles: adminRow.roles,
      }
    : null;

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
  const actorMember = {
    id: marshallA.id,
    permissions: ['trips.read'],
    roles: ['member'],
  };
  const actorPre = {
    id: marshallA.id,
    permissions: ['trips.read', 'members.read'],
    roles: ['pre_marshall'],
  };

  const report = {
    marshallOwnDelete: false,
    marshallOtherForbidden: false,
    memberForbidden: false,
    preMarshallForbidden: false,
    adminAnyDelete: false,
    repeatNotFound: false,
  };

  // 1) Marshall deletes own
  const own = await makeTrip(marshallA.id);
  await tripService.permanentlyDeleteTrip(own.id, actorMarshallA, {});
  const gone = await query(`SELECT 1 FROM trips WHERE id = $1`, [own.id]);
  report.marshallOwnDelete = gone.rowCount === 0;

  // 2) Marshall cannot delete another's
  if (actorMarshallB) {
    const other = await makeTrip(marshallA.id);
    try {
      await tripService.permanentlyDeleteTrip(other.id, actorMarshallB, {});
    } catch (err) {
      report.marshallOtherForbidden =
        err instanceof AppError && err.status === 403;
    }
    await query(`DELETE FROM trips WHERE id = $1`, [other.id]);
  } else {
    report.marshallOtherForbidden = 'skipped_no_second_marshall';
  }

  // 3) Member forbidden
  const mTrip = await makeTrip(marshallA.id);
  try {
    await tripService.permanentlyDeleteTrip(mTrip.id, actorMember, {});
  } catch (err) {
    report.memberForbidden = err instanceof AppError && err.status === 403;
  }

  // 4) Pre-Marshall forbidden
  try {
    await tripService.permanentlyDeleteTrip(mTrip.id, actorPre, {});
  } catch (err) {
    report.preMarshallForbidden = err instanceof AppError && err.status === 403;
  }
  await query(`DELETE FROM trips WHERE id = $1`, [mTrip.id]);

  // 5) Admin deletes any + repeat 404
  if (actorAdmin) {
    const adminTarget = await makeTrip(marshallA.id);
    await tripService.permanentlyDeleteTrip(adminTarget.id, actorAdmin, {});
    const still = await query(`SELECT 1 FROM trips WHERE id = $1`, [adminTarget.id]);
    report.adminAnyDelete = still.rowCount === 0;
    try {
      await tripService.permanentlyDeleteTrip(adminTarget.id, actorAdmin, {});
    } catch (err) {
      report.repeatNotFound =
        err instanceof AppError && err.status === 404;
    }
  } else {
    report.adminAnyDelete = 'skipped_no_admin';
    report.repeatNotFound = 'skipped_no_admin';
  }

  console.log(JSON.stringify(report, null, 2));
  const failed = Object.entries(report).filter(
    ([, v]) => v !== true && typeof v !== 'string',
  );
  if (failed.length) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
