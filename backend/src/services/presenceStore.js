/**
 * Shared viewing presence for FCM suppression.
 *
 * Production multi-instance: set REDIS_URL (ioredis).
 * Without Redis: in-process Map only — safe for single-instance deploys
 * (documented limitation; do not run multiple API instances without Redis).
 */
const { env } = require('../config/env');

let redis = null;
let redisReady = false;
const memory = new Map(); // key -> Set(deviceId)

function key(conversationId, userId) {
  return `chat:viewing:${conversationId}:${userId}`;
}

function memoryGet(k) {
  if (!memory.has(k)) memory.set(k, new Set());
  return memory.get(k);
}

async function initPresenceStore() {
  if (!env.redisUrl) {
    console.warn(
      '[presence] REDIS_URL not set — using in-memory presence (single-instance only). ' +
        'Multi-instance deploys MUST set REDIS_URL or FCM suppression will be inconsistent.',
    );
    return { mode: 'memory' };
  }

  try {
    // Lazy require so local/dev without ioredis still boots if dep missing.
    const Redis = require('ioredis');
    redis = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    await redis.connect();
    redisReady = true;
    console.log('[presence] Redis presence store connected');
    return { mode: 'redis' };
  } catch (err) {
    redis = null;
    redisReady = false;
    console.warn(
      '[presence] Redis connect failed — falling back to in-memory (single-instance):',
      err instanceof Error ? err.message : err,
    );
    return { mode: 'memory', error: String(err) };
  }
}

/**
 * Mark a device as actively viewing a conversation.
 */
async function setViewing(conversationId, userId, deviceId, viewing) {
  if (!conversationId || !userId || !deviceId) return;
  const k = key(conversationId, userId);

  if (redisReady && redis) {
    if (viewing) {
      await redis.sadd(k, deviceId);
      await redis.expire(k, 120);
    } else {
      await redis.srem(k, deviceId);
    }
    return;
  }

  const set = memoryGet(k);
  if (viewing) set.add(deviceId);
  else set.delete(deviceId);
  if (set.size === 0) memory.delete(k);
}

/**
 * True if ANY of this user's devices is actively viewing the conversation.
 * Used to suppress FCM for that user (not proof of delivery/read).
 */
async function isUserViewing(conversationId, userId) {
  if (!conversationId || !userId) return false;
  const k = key(conversationId, userId);

  if (redisReady && redis) {
    const n = await redis.scard(k);
    return n > 0;
  }

  const set = memory.get(k);
  return Boolean(set && set.size > 0);
}

/**
 * Heartbeat refresh so TTL does not expire while the thread is open.
 */
async function touchViewing(conversationId, userId, deviceId) {
  if (!conversationId || !userId || !deviceId) return;
  const k = key(conversationId, userId);
  if (redisReady && redis) {
    const isMember = await redis.sismember(k, deviceId);
    if (isMember) await redis.expire(k, 120);
    return;
  }
  // memory: no TTL; cleared explicitly on leave/disconnect
}

function getPresenceMode() {
  return redisReady ? 'redis' : 'memory';
}

module.exports = {
  initPresenceStore,
  setViewing,
  isUserViewing,
  touchViewing,
  getPresenceMode,
};
