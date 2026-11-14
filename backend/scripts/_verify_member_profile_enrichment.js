/**
 * Live DB verification of member profile enrichment + VIN privacy.
 * Does not start HTTP — calls memberService directly.
 */
require('dotenv').config();

const memberService = require('../src/services/memberService');
const { query } = require('../src/config/db');

async function main() {
  const members = await query(
    `SELECT id, first_name, last_name
     FROM member_profiles
     WHERE deleted_at IS NULL AND status = 'approved'
     ORDER BY created_at DESC
     LIMIT 5`,
  );

  if (!members.rows.length) {
    console.log(JSON.stringify({ ok: false, reason: 'no members' }));
    process.exit(2);
  }

  const target = members.rows[0];
  const peer = members.rows[1] || members.rows[0];

  const before = await query(
    `SELECT id, vin FROM vehicles
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY is_primary DESC LIMIT 1`,
    [target.id],
  );

  let restored = false;
  const originalVin = before.rows[0]?.vin || null;
  if (before.rows[0] && !originalVin) {
    await query(`UPDATE vehicles SET vin = $1 WHERE id = $2`, [
      'TESTVINPRIVACY123',
      before.rows[0].id,
    ]);
    restored = true;
  }

  const memberPerms = ['members.read', 'trips.read'];
  const asSelf = await memberService.getMemberById(target.id, {
    id: target.id,
    roles: ['member'],
    permissions: memberPerms,
  });
  const asPeer = await memberService.getMemberById(target.id, {
    id: peer.id,
    roles: ['member'],
    permissions: memberPerms,
  });
  const asAdmin = await memberService.getMemberById(target.id, {
    id: peer.id,
    roles: ['admin'],
    permissions: ['members.manage', ...memberPerms],
  });

  if (restored) {
    await query(`UPDATE vehicles SET vin = NULL WHERE id = $1`, [
      before.rows[0].id,
    ]);
  }

  const peerVehicle = asPeer.vehicle;
  const peerHasVinKey = peerVehicle ? Object.prototype.hasOwnProperty.call(peerVehicle, 'vin') : false;

  const result = {
    ok: false,
    target: `${target.first_name} ${target.last_name}`.trim(),
    vehiclePresent: Boolean(asPeer.vehicle),
    selfVinPresent: Boolean(asSelf.vehicle?.vin),
    peerHasVinKey,
    peerVinValue: peerVehicle?.vin ?? null,
    adminVinPresent: Boolean(asAdmin.vehicle?.vin),
    ratingsReceived: asPeer.ratings?.ratingsReceived,
    overallAverage: asPeer.ratings?.overallAverage,
    categoryCount: asPeer.ratings?.categoryAverages?.length ?? 0,
    attendanceTotal: asPeer.attendance?.total,
    progressionHistory: asPeer.progressionHistory,
    gender: asPeer.gender,
    membership: asPeer.membership,
  };

  result.ok =
    result.peerVinValue == null &&
    result.peerHasVinKey === false &&
    typeof result.attendanceTotal === 'number' &&
    typeof result.progressionHistory?.junior === 'number' &&
    typeof result.progressionHistory?.marshall === 'number' &&
    Array.isArray(asPeer.ratings?.categoryAverages);

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
