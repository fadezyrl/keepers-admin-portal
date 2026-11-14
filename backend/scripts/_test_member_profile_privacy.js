/**
 * Verifies member profile enrichment + VIN privacy on GET /members/:id.
 * Requires a running API and two approved members (viewer vs target).
 *
 * Usage (from backend/):
 *   node scripts/_test_member_profile_privacy.js
 *
 * Env:
 *   API_BASE_URL (default http://127.0.0.1:4000)
 *   TEST_VIEWER_EMAIL / TEST_VIEWER_PASSWORD  — ordinary member
 *   TEST_TARGET_EMAIL / TEST_TARGET_PASSWORD  — member with a vehicle VIN
 *   TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD    — admin with members.manage
 */
require('dotenv').config();

const API = (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(
  /\/$/,
  '',
);

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok || !json?.data?.session?.access_token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(json)}`);
  }
  return {
    token: json.data.session.access_token,
    userId: json.data.user?.id,
  };
}

async function getMember(token, id) {
  const res = await fetch(`${API}/members/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`GET /members/${id} failed: ${JSON.stringify(json)}`);
  }
  return json.data;
}

async function main() {
  const viewerEmail = process.env.TEST_VIEWER_EMAIL;
  const viewerPassword = process.env.TEST_VIEWER_PASSWORD;
  const targetEmail = process.env.TEST_TARGET_EMAIL;
  const targetPassword = process.env.TEST_TARGET_PASSWORD;
  const adminEmail = process.env.TEST_ADMIN_EMAIL;
  const adminPassword = process.env.TEST_ADMIN_PASSWORD;

  if (!viewerEmail || !viewerPassword || !targetEmail || !targetPassword) {
    console.log(
      JSON.stringify({
        skipped: true,
        reason:
          'Set TEST_VIEWER_EMAIL/PASSWORD and TEST_TARGET_EMAIL/PASSWORD to run live privacy checks',
      }),
    );
    process.exit(0);
  }

  const viewer = await login(viewerEmail, viewerPassword);
  const target = await login(targetEmail, targetPassword);

  const asSelf = await getMember(target.token, target.userId);
  const asPeer = await getMember(viewer.token, target.userId);

  const selfVin = asSelf.vehicle?.vin || null;
  const peerVin = asPeer.vehicle?.vin;
  const hasRatingsShape =
    asPeer.ratings &&
    typeof asPeer.ratings.ratingsReceived === 'number' &&
    Array.isArray(asPeer.ratings.categoryAverages);
  const hasAttendance =
    asPeer.attendance && typeof asPeer.attendance.total === 'number';
  const hasProgression =
    asPeer.progressionHistory &&
    typeof asPeer.progressionHistory.junior === 'number' &&
    typeof asPeer.progressionHistory.marshall === 'number';

  let adminVinOk = true;
  if (adminEmail && adminPassword && selfVin) {
    const admin = await login(adminEmail, adminPassword);
    const asAdmin = await getMember(admin.token, target.userId);
    adminVinOk = asAdmin.vehicle?.vin === selfVin;
  }

  const peerVinHidden = peerVin === undefined || peerVin === null;
  const ok =
    hasRatingsShape &&
    hasAttendance &&
    hasProgression &&
    peerVinHidden &&
    adminVinOk &&
    (!selfVin || asSelf.vehicle?.vin === selfVin);

  console.log(
    JSON.stringify(
      {
        ok,
        hasRatingsShape,
        hasAttendance,
        hasProgression,
        selfHasVin: Boolean(selfVin),
        peerVinHidden,
        adminVinOk,
        progressionHistory: asPeer.progressionHistory,
        ratingsReceived: asPeer.ratings?.ratingsReceived,
        overallAverage: asPeer.ratings?.overallAverage,
      },
      null,
      2,
    ),
  );

  if (!ok) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
