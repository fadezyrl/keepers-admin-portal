/**
 * Device token registration tests (require-cache stubs).
 * Run: node --test __tests__/deviceTokenService.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const rows = [];
const dbPath = path.resolve(__dirname, '../src/config/db.js');

function stubDb() {
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: async (sql, params = []) => {
        if (String(sql).includes('UPDATE device_tokens') && String(sql).includes('device_id')) {
          rows.forEach((r) => {
            if (
              r.user_id === params[0] &&
              r.device_id === params[1] &&
              r.fcm_token !== params[2]
            ) {
              r.is_active = false;
            }
          });
          return { rows: [] };
        }
        if (String(sql).includes('INSERT INTO device_tokens')) {
          const existing = rows.find((r) => r.fcm_token === params[1]);
          if (existing) {
            existing.user_id = params[0];
            existing.platform = params[2];
            existing.device_id = params[3] || existing.device_id;
            existing.app_version = params[4] || existing.app_version;
            existing.is_active = true;
            return { rows: [existing] };
          }
          const row = {
            id: `d-${rows.length + 1}`,
            user_id: params[0],
            fcm_token: params[1],
            platform: params[2],
            device_id: params[3],
            app_version: params[4],
            is_active: true,
          };
          rows.push(row);
          return { rows: [row] };
        }
        if (String(sql).includes('is_active = FALSE') && String(sql).includes('WHERE id')) {
          const row = rows.find((r) => r.id === params[0] && r.user_id === params[1]);
          if (!row) return { rows: [] };
          row.is_active = false;
          return { rows: [row] };
        }
        if (String(sql).includes('WHERE user_id = $1 AND is_active = TRUE')) {
          rows.forEach((r) => {
            if (r.user_id === params[0]) r.is_active = false;
          });
          return { rows: [] };
        }
        return { rows: [] };
      },
    },
  };
}

stubDb();
delete require.cache[path.resolve(__dirname, '../src/services/deviceTokenService.js')];
const {
  registerDeviceToken,
  deactivateDeviceToken,
  deactivateAllForUser,
} = require('../src/services/deviceTokenService');

describe('deviceTokenService', () => {
  beforeEach(() => {
    rows.length = 0;
  });

  it('registers a device token', async () => {
    const row = await registerDeviceToken('u1', {
      fcmToken: 'x'.repeat(40),
      platform: 'android',
      deviceId: 'dev-1',
      appVersion: '1.0.0',
    });
    assert.equal(row.platform, 'android');
    assert.equal(rows.length, 1);
  });

  it('upserts the same token without duplicates', async () => {
    const token = 'y'.repeat(40);
    await registerDeviceToken('u1', { fcmToken: token, platform: 'android' });
    await registerDeviceToken('u2', { fcmToken: token, platform: 'android' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, 'u2');
  });

  it('deactivates a token owned by the user', async () => {
    const created = await registerDeviceToken('u1', {
      fcmToken: 'z'.repeat(40),
      platform: 'ios',
    });
    const result = await deactivateDeviceToken('u1', created.id);
    assert.equal(result.is_active, false);
  });

  it('deactivates all tokens on logout', async () => {
    await registerDeviceToken('u1', { fcmToken: 'a'.repeat(40), platform: 'android' });
    await registerDeviceToken('u1', { fcmToken: 'b'.repeat(40), platform: 'ios' });
    await deactivateAllForUser('u1');
    assert.ok(rows.every((r) => r.is_active === false));
  });

  it('rejects invalid platform', async () => {
    await assert.rejects(
      () => registerDeviceToken('u1', { fcmToken: 'c'.repeat(40), platform: 'web' }),
      /platform/,
    );
  });
});

// silence unused
void Module;
