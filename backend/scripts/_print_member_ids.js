require('dotenv').config();
const { query } = require('../src/config/db');

query(
  `SELECT id, first_name, last_name, username
   FROM member_profiles
   WHERE deleted_at IS NULL AND status = 'approved'
   ORDER BY created_at DESC
   LIMIT 5`,
)
  .then((r) => {
    console.log(JSON.stringify(r.rows, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
