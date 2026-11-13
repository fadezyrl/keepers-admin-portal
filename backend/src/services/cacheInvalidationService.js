const { env } = require('../config/env');

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const pendingByKey = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConfig() {
  const url = (process.env.NEXT_REVALIDATE_URL || env.nextRevalidateUrl || '')
    .trim()
    .replace(/\/$/, '');
  const secret = (process.env.REVALIDATE_SECRET || env.revalidateSecret || '').trim();
  return { url, secret };
}

async function postRevalidate(payload) {
  const { url, secret } = getConfig();
  if (!url || !secret) {
    if (env.nodeEnv !== 'production') {
      console.warn(
        '[cacheInvalidation] skipped — set NEXT_REVALIDATE_URL and REVALIDATE_SECRET',
      );
    }
    return { skipped: true };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-revalidate-secret': secret,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      return { ok: true, attempt };
    } catch (err) {
      lastError = err;
      console.error(
        `[cacheInvalidation] attempt ${attempt}/${MAX_ATTEMPTS} failed:`,
        err instanceof Error ? err.message : err,
      );
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }

  console.error(
    '[cacheInvalidation] giving up after retries',
    lastError instanceof Error ? lastError.message : lastError,
  );
  return { ok: false, error: lastError };
}

/**
 * Fire-and-forget invalidation. Never throws to callers.
 * Debounces identical tag sets briefly to avoid duplicate storms.
 */
function invalidateCache({ tags = [], paths = [], reason } = {}) {
  const cleanTags = [...new Set((tags || []).map(String).filter(Boolean))];
  const cleanPaths = [...new Set((paths || []).map(String).filter(Boolean))];
  if (cleanTags.length === 0 && cleanPaths.length === 0) return;

  const key = `${cleanTags.sort().join(',')}|${cleanPaths.sort().join(',')}`;
  if (pendingByKey.has(key)) {
    clearTimeout(pendingByKey.get(key));
  }

  const timer = setTimeout(() => {
    pendingByKey.delete(key);
    void postRevalidate({
      tags: cleanTags,
      paths: cleanPaths,
      reason: reason || undefined,
    });
  }, 150);

  pendingByKey.set(key, timer);
}

const presets = {
  member: (reason) =>
    invalidateCache({
      tags: ['members', 'dashboard'],
      paths: ['/members', '/dashboard', '/marshalls'],
      reason,
    }),
  trip: (reason) =>
    invalidateCache({
      tags: ['trips', 'registrations', 'dashboard'],
      paths: ['/trips', '/calendar', '/registrations', '/dashboard'],
      reason,
    }),
  registration: (reason) =>
    invalidateCache({
      tags: ['registrations', 'trips', 'dashboard'],
      paths: ['/registrations', '/trips', '/dashboard'],
      reason,
    }),
  rating: (reason) =>
    invalidateCache({
      tags: ['ratings', 'members', 'dashboard'],
      paths: ['/ratings', '/members', '/dashboard'],
      reason,
    }),
  sponsors: (reason) =>
    invalidateCache({
      tags: ['sponsors'],
      paths: ['/sponsors'],
      reason,
    }),
  gallery: (reason) =>
    invalidateCache({ tags: ['gallery'], paths: ['/gallery'], reason }),
  carousel: (reason) =>
    invalidateCache({ tags: ['carousel'], paths: ['/carousel'], reason }),
  announcements: (reason) =>
    invalidateCache({
      tags: ['announcements'],
      paths: ['/announcements'],
      reason,
    }),
  documents: (reason) =>
    invalidateCache({ tags: ['documents'], paths: ['/documents'], reason }),
  events: (reason) =>
    invalidateCache({ tags: ['events'], paths: ['/events'], reason }),
  settings: (reason) =>
    invalidateCache({
      tags: ['settings'],
      paths: ['/settings'],
      reason,
    }),
};

module.exports = {
  invalidateCache,
  postRevalidate,
  presets,
};
