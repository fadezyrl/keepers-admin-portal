const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');

let adminClient = null;
let anonClient = null;

function getAdminClient() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return null;
  }
  if (!adminClient) {
    adminClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return adminClient;
}

function getAnonClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return null;
  }
  if (!anonClient) {
    anonClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return anonClient;
}

module.exports = { getAdminClient, getAnonClient };
