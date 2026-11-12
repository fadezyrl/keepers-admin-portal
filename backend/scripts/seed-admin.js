/**
 * Create an initial Super Admin user.
 * Usage:
 *   node scripts/seed-admin.js --email admin@keepers.ae --password '***' --first Admin --last Keepers --username admin
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + DATABASE_URL.
 * Never logs the password.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { Client } = require('pg');

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env[fallback] || null;
}

async function main() {
  const email = arg('email', 'SEED_ADMIN_EMAIL');
  const password = arg('password', 'SEED_ADMIN_PASSWORD');
  const firstName = arg('first', 'SEED_ADMIN_FIRST') || 'Admin';
  const lastName = arg('last', 'SEED_ADMIN_LAST') || 'Keepers';
  const username = arg('username', 'SEED_ADMIN_USERNAME') || 'admin';

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL || process.env.database_url;

  if (!email || !password) {
    console.error('Missing --email / --password (or SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)');
    process.exit(1);
  }
  if (!supabaseUrl || !serviceKey || !databaseUrl) {
    console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or DATABASE_URL');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, username },
  });

  if (error || !created?.user) {
    console.error('Auth user create failed:', error?.message || 'unknown');
    process.exit(1);
  }

  const userId = created.user.id;
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const advanced = await client.query(
      `SELECT id FROM membership_levels WHERE code = 'advanced' LIMIT 1`,
    );
    const superAdmin = await client.query(
      `SELECT id FROM roles WHERE code = 'super_admin' LIMIT 1`,
    );

    await client.query(
      `INSERT INTO member_profiles (
         id, first_name, last_name, username, email, membership_level_id, status, approved_at, agreement_accepted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'approved', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         status = 'approved',
         approved_at = COALESCE(member_profiles.approved_at, NOW()),
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name`,
      [
        userId,
        firstName,
        lastName,
        username,
        email.toLowerCase(),
        advanced.rows[0]?.id || null,
      ],
    );

    if (superAdmin.rows[0]) {
      await client.query(
        `INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2)
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, superAdmin.rows[0].id],
      );
    }

    await client.query(
      `INSERT INTO notification_preferences (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    console.log('Super Admin seeded successfully');
    console.log('userId:', userId);
    console.log('email:', email);
    console.log('username:', username);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('seed-admin failed:', e.message);
  process.exit(1);
});
