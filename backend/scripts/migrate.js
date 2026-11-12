/**
 * Apply SQL migrations in order. Additive only.
 * Never prints connection strings or secrets.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const url = process.env.database_url || process.env.DATABASE_URL;
if (!url) {
  console.error('Missing database_url / DATABASE_URL');
  process.exit(1);
}

const migrationsDir = path.join(__dirname, '..', 'migrations');

async function main() {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });

  await client.connect();
  console.log('Connected. Applying migrations...');

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      notes TEXT
    );
  `);

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    const existing = await client.query(
      'SELECT 1 FROM public.schema_migrations WHERE id = $1',
      [id],
    );
    if (existing.rowCount > 0) {
      console.log(`SKIP  ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`APPLY ${file} ...`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      // Ensure tracking row even if migration SQL forgot it
      await client.query(
        `INSERT INTO public.schema_migrations (id, notes)
         VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [id, `Applied via migrate.js`],
      );
      await client.query('COMMIT');
      console.log(`OK    ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`FAIL  ${file}:`, err.message);
      process.exitCode = 1;
      break;
    }
  }

  const applied = await client.query(
    'SELECT id, applied_at FROM public.schema_migrations ORDER BY applied_at',
  );
  console.log('Applied migrations:', applied.rows.map((r) => r.id).join(', '));

  const tables = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY 1
  `);
  console.log('Public tables:', tables.rows.length);
  for (const t of tables.rows) console.log(' -', t.table_name);

  await client.end();
}

main().catch((e) => {
  console.error('Migration runner error:', e.message);
  process.exit(1);
});
