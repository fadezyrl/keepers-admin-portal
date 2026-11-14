require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/config/db');
const { getAdminClient } = require('../src/config/supabase');
const memberService = require('../src/services/memberService');

async function main() {
  const adminClient = getAdminClient();
  const adminRow = (
    await query(
      `SELECT mp.id FROM member_profiles mp
       JOIN user_roles ur ON ur.user_id = mp.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code IN ('admin','super_admin') AND mp.deleted_at IS NULL
       LIMIT 1`,
    )
  ).rows[0];
  const actor = {
    id: adminRow.id,
    permissions: ['members.manage', 'roles.assign', 'admins.manage', 'trips.manage'],
    roles: ['admin'],
  };
  const stamp = Date.now();
  const email = `cancel.del.${stamp}@keepers.invalid`;
  const { data: created, error } = await adminClient.auth.admin.createUser({
    email,
    password: `TmpCancel${stamp}!a`,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;
  const level = (await query(`SELECT id FROM membership_levels LIMIT 1`)).rows[0];
  await query(
    `INSERT INTO member_profiles (
       id, first_name, last_name, username, email, status, membership_level_id, approved_at
     ) VALUES ($1, 'C', 'D', $2, $3, 'approved', $4, NOW())`,
    [userId, `c_${stamp}`, email, level.id],
  );
  const trip = (
    await query(
      `INSERT INTO trips (
         title, description, destination, trip_date, max_participants, status,
         published_at, created_by, organizer_id
       ) VALUES (
         'Cancel path', 'x', 'T', CURRENT_DATE + 20, 5, 'published', NOW(), $1, $1
       ) RETURNING id`,
      [userId],
    )
  ).rows[0];
  const other = (
    await query(
      `SELECT id FROM member_profiles
       WHERE id <> $1 AND deleted_at IS NULL AND status = 'approved'
       LIMIT 1`,
      [userId],
    )
  ).rows[0];
  if (other) {
    await query(
      `INSERT INTO trip_registrations (trip_id, user_id, status)
       VALUES ($1, $2, 'registered')
       ON CONFLICT DO NOTHING`,
      [trip.id, other.id],
    );
  }
  const res = await memberService.permanentlyDeleteMember(
    userId,
    { confirmEmail: email, tripActions: [{ tripId: trip.id, action: 'cancel' }] },
    actor,
    {},
  );
  const t = (await query(`SELECT status, organizer_id FROM trips WHERE id = $1`, [trip.id]))
    .rows[0];
  console.log(
    JSON.stringify({
      ok: res.permanentlyDeleted,
      tripStatus: t.status,
      organizerIsAdmin: t.organizer_id === actor.id,
    }),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
