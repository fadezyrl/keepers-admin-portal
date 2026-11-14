/**
 * Service-level account management tests (deactivate + permanent delete).
 * Creates a disposable Auth user, then cleans it up via permanent delete.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../src/config/db');
const { getAdminClient } = require('../src/config/supabase');
const memberService = require('../src/services/memberService');
const { AppError } = require('../src/utils/AppError');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const adminClient = getAdminClient();
  assert(adminClient, 'Supabase admin client required');

  const adminRow = (
    await query(
      `SELECT mp.id FROM member_profiles mp
       JOIN user_roles ur ON ur.user_id = mp.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.code IN ('admin','super_admin') AND mp.deleted_at IS NULL
       LIMIT 1`,
    )
  ).rows[0];
  assert(adminRow, 'Need an admin member in DB');

  const actor = {
    id: adminRow.id,
    permissions: ['members.manage', 'roles.assign', 'admins.manage', 'trips.manage'],
    roles: ['admin'],
  };
  const nonAdmin = {
    id: adminRow.id,
    permissions: ['members.read'],
    roles: ['member'],
  };

  const stamp = Date.now();
  const email = `delete.me.${stamp}@keepers.invalid`;
  const username = `del_${stamp}`.slice(0, 24);

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email,
    password: `TmpDelete${stamp}!a`,
    email_confirm: true,
    user_metadata: { first_name: 'Temp', last_name: 'Delete' },
  });
  assert(!createErr && created?.user?.id, `createUser failed: ${createErr?.message}`);
  const userId = created.user.id;

  const level = (
    await query(`SELECT id FROM membership_levels WHERE code = 'keeper' LIMIT 1`)
  ).rows[0];
  await query(
    `INSERT INTO member_profiles (
       id, first_name, last_name, username, email, status, membership_level_id, approved_at
     ) VALUES ($1, 'Temp', 'Delete', $2, $3, 'approved', $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       username = EXCLUDED.username,
       email = EXCLUDED.email,
       status = 'approved',
       deleted_at = NULL`,
    [userId, username, email, level?.id || null],
  );
  const memberRole = (await query(`SELECT id FROM roles WHERE code = 'member'`)).rows[0];
  const marshallRole = (await query(`SELECT id FROM roles WHERE code = 'marshall'`)).rows[0];
  await query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, memberRole.id, actor.id],
  );
  await query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [userId, marshallRole.id, actor.id],
  );

  const trip = (
    await query(
      `INSERT INTO trips (
         title, description, destination, trip_date, max_participants, status,
         published_at, created_by, organizer_id
       ) VALUES (
         'Owned by disposable marshall', 'auto', 'Test', CURRENT_DATE + 14, 8, 'published',
         NOW(), $1, $1
       ) RETURNING id`,
      [userId],
    )
  ).rows[0];

  // Non-admin cannot inspect impact
  let forbidden = false;
  try {
    await memberService.getDeletionImpact(userId, nonAdmin);
  } catch (err) {
    forbidden = err instanceof AppError && err.status === 403;
  }
  assert(forbidden, 'Non-admin should be forbidden from deletion-impact');

  // Deactivate / reactivate
  const suspended = await memberService.setMemberStatus(
    userId,
    { status: 'suspended', reason: 'test' },
    actor,
    {},
  );
  assert(suspended.status === 'suspended', 'Expected suspended');

  const reactivated = await memberService.setMemberStatus(
    userId,
    { status: 'approved' },
    actor,
    {},
  );
  assert(reactivated.status === 'approved', 'Expected reactivated');

  const impact = await memberService.getDeletionImpact(userId, actor);
  assert(impact.ownedTrips.some((t) => t.id === trip.id), 'Owned trip missing from impact');

  // Bad email confirmation
  let confirmBlocked = false;
  try {
    await memberService.permanentlyDeleteMember(
      userId,
      { confirmEmail: 'wrong@example.com', tripActions: [] },
      actor,
      {},
    );
  } catch (err) {
    confirmBlocked = err instanceof AppError && err.code === 'CONFIRMATION_REQUIRED';
  }
  assert(confirmBlocked, 'Wrong email must block deletion');

  // Permanent delete with retain_admin for owned trip
  const result = await memberService.permanentlyDeleteMember(
    userId,
    {
      confirmEmail: email,
      tripActions: [{ tripId: trip.id, action: 'retain_admin' }],
    },
    actor,
    {},
  );
  assert(result.permanentlyDeleted === true, 'Expected permanentlyDeleted');

  const profile = (
    await query(`SELECT * FROM member_profiles WHERE id = $1`, [userId])
  ).rows[0];
  assert(profile?.deleted_at, 'Profile should remain soft-deleted');
  assert(profile.first_name === 'Deleted', 'PII should be scrubbed');
  assert(String(profile.email).startsWith('deleted+'), 'Email should be anonymized');

  const tripRow = (await query(`SELECT organizer_id, status FROM trips WHERE id = $1`, [trip.id]))
    .rows[0];
  assert(tripRow.organizer_id === actor.id, 'Trip should be retained under admin');
  assert(tripRow.status === 'published', 'Trip should not be auto-cancelled on retain_admin');

  const { data: authUser } = await adminClient.auth.admin.getUserById(userId);
  assert(!authUser?.user, 'Auth user should be deleted');

  // Repeated delete is safe
  let repeatSafe = false;
  try {
    await memberService.permanentlyDeleteMember(
      userId,
      { confirmEmail: email, tripActions: [] },
      actor,
      {},
    );
  } catch (err) {
    repeatSafe = err instanceof AppError && err.status === 404;
  }
  assert(repeatSafe, 'Repeat delete should 404');

  // Cleanup test trip
  await query(`UPDATE trips SET deleted_at = NOW() WHERE id = $1`, [trip.id]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        deactivateReactivate: true,
        permanentDelete: true,
        authRemoved: true,
        tripRetainedUnderAdmin: true,
        nonAdminForbidden: true,
        repeatSafe: true,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
