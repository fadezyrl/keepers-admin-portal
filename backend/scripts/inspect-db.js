/**
 * Non-destructive Supabase/Postgres inspection.
 * Prints schema metadata only — never connection strings, passwords, or PII.
 */
require('dotenv').config();
const { Client } = require('pg');

const url = process.env.database_url || process.env.DATABASE_URL;
if (!url) {
  console.log('NO_DB_URL');
  process.exit(1);
}

try {
  const u = new URL(url.replace(/^postgres(ql)?:/i, 'http:'));
  console.log('HOST_PRESENT:', Boolean(u.hostname));
  console.log('HOST_LOOKS_SUPABASE:', /supabase/i.test(u.hostname));
  console.log('DB_NAME:', u.pathname.replace(/^\//, '').split('?')[0] || '(empty)');
  console.log('PORT:', u.port || '(default)');
  console.log('HAS_USER:', Boolean(u.username));
  console.log('HAS_PASSWORD:', Boolean(u.password));
} catch (e) {
  console.log('URL_PARSE_ERROR:', e.message);
}

(async () => {
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
  });

  try {
    await client.connect();
    console.log('CONNECT: OK');

    const ver = await client.query('select version()');
    console.log('PG_VERSION:', String(ver.rows[0].version).split(' ').slice(0, 2).join(' '));

    const schemas = await client.query(`
      select schema_name from information_schema.schemata
      where schema_name not in ('pg_catalog','information_schema','pg_toast')
      order by 1
    `);
    console.log('SCHEMAS:', schemas.rows.map((r) => r.schema_name).join(', '));

    const tables = await client.query(`
      select table_schema, table_name
      from information_schema.tables
      where table_schema in ('public','auth','storage')
        and table_type = 'BASE TABLE'
      order by table_schema, table_name
    `);
    console.log('TABLE_COUNT:', tables.rows.length);
    for (const t of tables.rows) {
      console.log('TABLE:', `${t.table_schema}.${t.table_name}`);
    }

    const exts = await client.query('select extname from pg_extension order by 1');
    console.log('EXTENSIONS:', exts.rows.map((r) => r.extname).join(', '));

    const hasAuth = tables.rows.some(
      (r) => r.table_schema === 'auth' && r.table_name === 'users',
    );
    if (hasAuth) {
      const c = await client.query('select count(*)::int as n from auth.users');
      console.log('AUTH_USERS_COUNT:', c.rows[0].n);
    }

    const publicCols = await client.query(`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `);
    console.log('PUBLIC_COLUMNS:', publicCols.rows.length);
    for (const c of publicCols.rows) {
      console.log('COL:', `${c.table_name}.${c.column_name}:${c.data_type}`);
    }

    const rls = await client.query(`
      select c.relname as table_name, c.relrowsecurity as rls_enabled
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by 1
    `);
    for (const row of rls.rows) {
      console.log('RLS:', `${row.table_name}=${row.rls_enabled}`);
    }
  } catch (e) {
    console.log('CONNECT_ERROR:', e.code || '', e.message);
    process.exitCode = 1;
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
})();
