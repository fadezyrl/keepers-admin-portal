const { query } = require('../src/config/db');

async function main() {
  const m = await query(
    `SELECT id FROM member_profiles WHERE status='approved' AND deleted_at IS NULL LIMIT 1`,
  );
  if (!m.rows[0]) {
    console.log(JSON.stringify({ ok: false, reason: 'no member' }));
    return;
  }
  const role = await query(`SELECT id FROM roles WHERE code='pre_marshall'`);
  await query(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [m.rows[0].id, role.rows[0].id],
  );
  console.log(JSON.stringify({ ok: true, preMarshallUserId: m.rows[0].id }));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
