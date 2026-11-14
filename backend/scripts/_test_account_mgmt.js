/**
 * Smoke tests for member deactivate / permanent-delete APIs.
 * Requires a running API with Admin credentials in env:
 *   API_BASE, ADMIN_EMAIL, ADMIN_PASSWORD
 * Optional: TEST_MEMBER_EMAIL for a disposable test member.
 */
const API = process.env.API_BASE || 'http://127.0.0.1:4000/api';

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('SKIP: set ADMIN_EMAIL and ADMIN_PASSWORD');
    process.exit(0);
  }

  const login = await req('POST', '/auth/login', { body: { email, password } });
  assert(login.status === 200 && login.json?.data?.session?.access_token, 'Admin login failed');
  const token = login.json.data.session.access_token;
  console.log('OK login');

  // Non-admin forbidden: hit permanent-delete without token
  const unauth = await req('POST', '/members/00000000-0000-0000-0000-000000000001/permanent-delete', {
    body: { confirmEmail: 'x@y.z' },
  });
  assert(unauth.status === 401, `Expected 401 unauth, got ${unauth.status}`);
  console.log('OK unauth permanent-delete blocked');

  // Impact endpoint requires members.manage
  const members = await req('GET', '/members?limit=5&status=approved', { token });
  assert(members.status === 200, 'List members failed');
  const target = (members.json.data?.items || []).find(
    (m) => m.email !== email && !(m.roles || []).some((r) => ['admin', 'super_admin'].includes(r.code)),
  );
  if (!target) {
    console.log('SKIP: no non-admin approved member to inspect');
    process.exit(0);
  }

  const impact = await req('GET', `/members/${target.id}/deletion-impact`, { token });
  assert(impact.status === 200, `deletion-impact failed: ${impact.status}`);
  assert(impact.json.data?.member?.email === target.email, 'Impact email mismatch');
  console.log('OK deletion-impact', {
    trips: impact.json.data.ownedTrips?.length,
    assignments: impact.json.data.preMarshallAssignments?.length,
  });

  // Deactivate then reactivate (reversible)
  const deact = await req('POST', `/members/${target.id}/status`, {
    token,
    body: { status: 'suspended', reason: 'account-mgmt smoke test' },
  });
  assert(deact.status === 200, `deactivate failed: ${deact.status} ${deact.json?.error?.message}`);
  assert(deact.json.data?.status === 'suspended', 'status not suspended');
  console.log('OK deactivate');

  const react = await req('POST', `/members/${target.id}/status`, {
    token,
    body: { status: 'approved' },
  });
  assert(react.status === 200 && react.json.data?.status === 'approved', 'reactivate failed');
  console.log('OK reactivate');

  // Permanent delete without email confirmation must fail
  const badConfirm = await req('POST', `/members/${target.id}/permanent-delete`, {
    token,
    body: { confirmEmail: 'wrong@example.com', tripActions: [] },
  });
  assert(badConfirm.status === 400, `Expected 400 confirm, got ${badConfirm.status}`);
  console.log('OK confirm-email required');

  // Self-delete blocked
  const me = await req('GET', '/auth/me', { token });
  const selfId = me.json.data?.id || me.json.data?.user?.id;
  if (selfId) {
    const selfDel = await req('POST', `/members/${selfId}/permanent-delete`, {
      token,
      body: { confirmEmail: email },
    });
    assert(selfDel.status === 400 || selfDel.status === 403, `self-delete should fail, got ${selfDel.status}`);
    console.log('OK self-delete blocked');
  }

  console.log('Account management smoke checks passed (no permanent delete executed).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
