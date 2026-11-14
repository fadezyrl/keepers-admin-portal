require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    return null;
  }
  return value;
}

const databaseUrl =
  required('DATABASE_URL') || required('database_url');

const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  databaseUrl,
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseJwtSecret: required('SUPABASE_JWT_SECRET'),
  corsOrigins,
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 52428800),
  nextRevalidateUrl: required('NEXT_REVALIDATE_URL'),
  revalidateSecret: required('REVALIDATE_SECRET'),
  firebaseProjectId: required('FIREBASE_PROJECT_ID') || 'keepers-68d3e',
  /** Optional. Required for multi-instance chat presence / FCM suppress. */
  redisUrl: required('REDIS_URL'),
};

function assertRuntimeConfig() {
  const missing = [];
  if (!env.databaseUrl) missing.push('DATABASE_URL (or database_url)');
  if (!env.supabaseUrl) missing.push('SUPABASE_URL');
  if (!env.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!env.supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

module.exports = { env, assertRuntimeConfig };
