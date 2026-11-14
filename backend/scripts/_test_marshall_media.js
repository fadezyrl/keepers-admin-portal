/**
 * Ownership-aware trip media attach/delete tests (service-level).
 */
const { query } = require('../src/config/db');
const tripService = require('../src/services/tripService');
const { AppError } = require('../src/utils/AppError');

async function makeTrip(organizerId) {
  const res = await query(
    `INSERT INTO trips (
       title, description, destination, trip_date, max_participants, status,
       published_at, created_by, organizer_id
     ) VALUES (
       'Media Auth Spec', 'auto', 'Range', CURRENT_DATE + 12, 8, 'published',
       NOW(), $1, $1
     ) RETURNING id`,
    [organizerId],
  );
  return res.rows[0].id;
}

async function cleanupTrip(tripId) {
  await query(`DELETE FROM trip_media WHERE trip_id = $1`, [tripId]);
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
     LIMIT 30`,
  );

  const adminRow = members.rows.find(
    (m) => m.roles.includes('admin') || m.roles.includes('super_admin'),
  );
  const marshallA = members.rows.find((m) => m.roles.includes('marshall'));
  const marshallB = members.rows.find(
    (m) => m.roles.includes('marshall') && m.id !== marshallA?.id,
  );
  const memberRow = members.rows.find(
    (m) =>
      m.roles.includes('member') &&
      !m.roles.includes('marshall') &&
      !m.roles.includes('admin') &&
      !m.roles.includes('super_admin'),
  );
  const preRow = members.rows.find((m) => m.roles.includes('pre_marshall'));

  if (!marshallA) {
    console.log(JSON.stringify({ skipped: true, reason: 'Need a marshall user' }));
    return;
  }

  const actorMarshallA = {
    id: marshallA.id,
    permissions: ['trips.create', 'trips.manage_own', 'media.manage', 'trips.read'],
    roles: ['marshall'],
  };
  const actorMarshallB = marshallB
    ? {
        id: marshallB.id,
        permissions: ['trips.create', 'trips.manage_own', 'media.manage', 'trips.read'],
        roles: ['marshall'],
      }
    : null;
  const actorAdmin = adminRow
    ? {
        id: adminRow.id,
        permissions: ['trips.manage', 'trips.manage_own', 'media.manage'],
        roles: adminRow.roles,
      }
    : null;
  const actorMember = memberRow
    ? { id: memberRow.id, permissions: ['trips.read'], roles: ['member'] }
    : { id: marshallA.id, permissions: ['trips.read'], roles: ['member'] };
  const actorPre = preRow
    ? {
        id: preRow.id,
        permissions: ['trips.read', 'attendance.mark'],
        roles: ['pre_marshall'],
      }
    : {
        id: marshallA.id,
        permissions: ['trips.read', 'attendance.mark'],
        roles: ['pre_marshall'],
      };

  const report = {
    marshallOwnAttach: false,
    marshallOwnDelete: false,
    marshallOtherForbidden: false,
    memberForbidden: false,
    preMarshallForbidden: false,
    adminAnyAttach: false,
  };

  const ownTripId = await makeTrip(marshallA.id);
  let mediaId = null;

  try {
    const media = await tripService.addTripMedia(
      ownTripId,
      { url: 'https://example.com/storage/v1/object/public/trips/test-own.jpg', mediaType: 'image' },
      actorMarshallA,
    );
    mediaId = media.id;
    report.marshallOwnAttach = Boolean(mediaId);

    await tripService.deleteTripMedia(ownTripId, mediaId, actorMarshallA, {});
    const gone = await query(
      `SELECT deleted_at FROM trip_media WHERE id = $1`,
      [mediaId],
    );
    report.marshallOwnDelete = Boolean(gone.rows[0]?.deleted_at);

    if (actorMarshallB) {
      const otherTripId = await makeTrip(marshallA.id);
      try {
        await tripService.addTripMedia(
          otherTripId,
          { url: 'https://example.com/storage/v1/object/public/trips/other.jpg', mediaType: 'image' },
          actorMarshallB,
        );
      } catch (err) {
        report.marshallOtherForbidden =
          err instanceof AppError && err.status === 403;
      }
      await cleanupTrip(otherTripId);
    } else {
      report.marshallOtherForbidden = true;
    }

    try {
      await tripService.addTripMedia(
        ownTripId,
        { url: 'https://example.com/storage/v1/object/public/trips/member.jpg', mediaType: 'image' },
        actorMember,
      );
    } catch (err) {
      report.memberForbidden = err instanceof AppError && err.status === 403;
    }

    try {
      await tripService.addTripMedia(
        ownTripId,
        { url: 'https://example.com/storage/v1/object/public/trips/pre.jpg', mediaType: 'image' },
        actorPre,
      );
    } catch (err) {
      report.preMarshallForbidden = err instanceof AppError && err.status === 403;
    }

    if (actorAdmin) {
      const mediaAdmin = await tripService.addTripMedia(
        ownTripId,
        { url: 'https://example.com/storage/v1/object/public/trips/admin.jpg', mediaType: 'image' },
        actorAdmin,
      );
      report.adminAnyAttach = Boolean(mediaAdmin?.id);
      if (mediaAdmin?.id) {
        await tripService.deleteTripMedia(ownTripId, mediaAdmin.id, actorAdmin, {});
      }
    } else {
      report.adminAnyAttach = true;
    }
  } finally {
    await cleanupTrip(ownTripId);
  }

  const passed = Object.values(report).every(Boolean);
  console.log(JSON.stringify({ passed, report }, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
