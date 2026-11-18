require('dotenv').config();
const { query } = require('../src/config/db');

async function main() {
  const cols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'trips' AND column_name = 'category'`,
  );
  const dist = await query(
    `SELECT category, COUNT(*)::int AS n
     FROM trips WHERE deleted_at IS NULL
     GROUP BY category ORDER BY category`,
  );
  console.log(JSON.stringify({ hasCategory: cols.rows.length > 0, distribution: dist.rows }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
