const { query } = require('../src/config/db');

async function main() {
  const setting = await query(
    `SELECT key, value FROM app_settings
     WHERE key IN ('trip_join_allow_waitlist','trip_join_requires_approval')`,
  );
  const perm = await query(
    `SELECT r.code, p.code AS perm
     FROM roles r
     JOIN role_permissions rp ON rp.role_id = r.id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE r.code = 'pre_marshall'
     ORDER BY p.code`,
  );
  console.log('settings', setting.rows);
  console.log('pre_marshall perms', perm.rows);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
