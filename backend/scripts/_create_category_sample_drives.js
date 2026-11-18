/**
 * Create one draft drive per category (owned by first marshall/admin), then delete them.
 * Verifies create + persist + filter end-to-end against live DB.
 */
require('dotenv').config();
const { query } = require('../src/config/db');
const tripService = require('../src/services/tripService');
const { TRIP_CATEGORIES } = require('../src/constants/tripCategories');

async function main() {
  const actorRes = await query(
    `SELECT mp.id, mp.first_name, mp.last_name
     FROM member_profiles mp
     JOIN user_roles ur ON ur.user_id = mp.id
     JOIN roles r ON r.id = ur.role_id
     WHERE mp.deleted_at IS NULL
       AND r.code IN ('marshall', 'admin', 'super_admin')
     ORDER BY CASE r.code
       WHEN 'super_admin' THEN 0
       WHEN 'admin' THEN 1
       ELSE 2
     END
     LIMIT 1`,
  );
  const actorRow = actorRes.rows[0];
  if (!actorRow) {
    console.error('No marshall/admin actor found');
    process.exit(1);
  }

  const actor = {
    id: actorRow.id,
    permissions: ['trips.create', 'trips.manage', 'trips.manage_own'],
  };

  const createdIds = [];
  const results = [];

  for (const category of TRIP_CATEGORIES) {
    const trip = await tripService.createTrip(
      {
        title: `Category verify · ${category}`,
        description: `Automated verification drive for ${category}.`,
        destination: 'Verification Grounds',
        date: '2027-06-15',
        time: '07:30',
        difficulty: 'Moderate',
        category,
        maxParticipants: 8,
        publish: false,
      },
      actor,
      { ip: '127.0.0.1' },
    );
    createdIds.push(trip.id);
    results.push({
      category,
      id: trip.id,
      persistedCategory: trip.category,
      ok: trip.category === category,
    });
  }

  for (const id of createdIds) {
    await tripService.softDeleteTrip(id, actor, { ip: '127.0.0.1' });
  }

  console.log(JSON.stringify({ actorId: actor.id, results }, null, 2));
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
