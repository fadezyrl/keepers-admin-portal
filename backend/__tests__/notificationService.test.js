/**
 * Notification service tests (require-cache stubs).
 * Run: node --test __tests__/notificationService.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dbState = {
  prefs: { trips: true, events: true, club: true, registrations: true, ratings: true },
  inserts: [],
};

const dbPath = path.resolve(__dirname, '../src/config/db.js');
const firebasePath = path.resolve(__dirname, '../src/config/firebase.js');
const devicePath = path.resolve(__dirname, '../src/services/deviceTokenService.js');

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: async (sql, params = []) => {
      if (String(sql).includes('notification_preferences')) {
        return { rows: [dbState.prefs] };
      }
      if (String(sql).includes('INSERT INTO notifications')) {
        const row = {
          id: `n-${dbState.inserts.length + 1}`,
          user_id: params[0],
          type: params[1],
          title: params[2],
          body: params[3],
          data: JSON.parse(params[4] || '{}'),
          announcement_id: params[5],
          idempotency_key: params[6],
          push_status: params[7],
        };
        const existing = dbState.inserts.find(
          (r) =>
            r.user_id === row.user_id &&
            r.idempotency_key &&
            r.idempotency_key === row.idempotency_key,
        );
        if (existing) return { rows: [existing] };
        dbState.inserts.push(row);
        return { rows: [row] };
      }
      if (String(sql).includes('idempotency_key')) {
        const found = dbState.inserts.find(
          (r) => r.user_id === params[0] && r.idempotency_key === params[1],
        );
        return { rows: found ? [found] : [] };
      }
      if (String(sql).includes('UPDATE notifications SET push_status')) {
        const row = dbState.inserts.find((r) => r.id === params[1]);
        if (row) row.push_status = params[0];
        return { rows: [] };
      }
      return { rows: [] };
    },
  },
};

require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: {
    getFirebaseAdmin: () => null,
    isFirebaseReady: () => false,
    getFirebaseInitError: () => 'not configured in test',
  },
};

require.cache[devicePath] = {
  id: devicePath,
  filename: devicePath,
  loaded: true,
  exports: {
    listActiveTokensForUsers: async () => [],
    deactivateTokensByIds: async () => undefined,
  },
};

delete require.cache[path.resolve(__dirname, '../src/services/notificationService.js')];
const {
  createNotification,
  notifyMany,
  mapDeepLink,
} = require('../src/services/notificationService');

describe('notificationService', () => {
  beforeEach(() => {
    dbState.inserts = [];
    dbState.prefs = {
      trips: true,
      events: true,
      club: true,
      registrations: true,
      ratings: true,
    };
  });

  it('persists notification when Firebase is offline', async () => {
    const row = await createNotification({
      userId: '11111111-1111-1111-1111-111111111111',
      type: 'registration',
      title: 'Joined',
      body: 'Member joined',
      data: { tripId: '22222222-2222-2222-2222-222222222222' },
      idempotencyKey: 'trip.join:abc',
    });
    assert.equal(row.type, 'registration');
    assert.equal(dbState.inserts.length, 1);
    assert.ok(row.data.deepLink.includes('trips/'));
  });

  it('dedupes by idempotency key', async () => {
    const payload = {
      userId: '11111111-1111-1111-1111-111111111111',
      type: 'admin',
      title: 'Approved',
      body: 'Account approved',
      idempotencyKey: 'member.status:u1:approved:pending',
    };
    const a = await createNotification(payload);
    const b = await createNotification(payload);
    assert.equal(a.id, b.id);
    assert.equal(dbState.inserts.length, 1);
  });

  it('notifyMany fans out unique recipients', async () => {
    const ids = [
      '11111111-1111-1111-1111-111111111111',
      '11111111-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
    ];
    const rows = await notifyMany(ids, {
      type: 'trip',
      title: 'Published',
      body: 'New trip',
      idempotencyKey: 'trip.status.published:t1',
    });
    assert.equal(rows.length, 2);
    assert.equal(dbState.inserts.length, 2);
  });

  it('maps deep links for known types', () => {
    assert.equal(
      mapDeepLink('trip', { tripId: '22222222-2222-2222-2222-222222222222' }),
      'keepers://trips/22222222-2222-2222-2222-222222222222',
    );
    assert.equal(mapDeepLink('upgrade', {}), 'keepers://progress');
    assert.equal(mapDeepLink('admin', {}), 'keepers://settings');
  });
});
