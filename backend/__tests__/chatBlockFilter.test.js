/**
 * Ensures listMessages SQL excludes blocked senders for regular viewers.
 * Run: node --test __tests__/chatBlockFilter.test.js
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const dbPath = path.resolve(__dirname, '../src/config/db.js');
const authPath = path.resolve(__dirname, '../src/middleware/auth.js');
const supabasePath = path.resolve(__dirname, '../src/config/supabase.js');
const notificationPath = path.resolve(
  __dirname,
  '../src/services/notificationService.js',
);
const presencePath = path.resolve(__dirname, '../src/services/presenceStore.js');
const auditPath = path.resolve(__dirname, '../src/services/auditService.js');
const chatServicePath = path.resolve(__dirname, '../src/services/chatService.js');

describe('chatService listMessages block filter', () => {
  let lastSql;
  let lastParams;
  let service;

  beforeEach(() => {
    lastSql = '';
    lastParams = [];

    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        query: async (sql, params = []) => {
          lastSql = String(sql);
          lastParams = params;
          if (String(sql).includes('FROM conversations')) {
            return {
              rows: [
                {
                  id: params[0],
                  is_readonly: false,
                  is_archived: false,
                  type: 'group',
                },
              ],
            };
          }
          if (String(sql).includes('FROM conversation_participants')) {
            return {
              rows: [
                {
                  conversation_id: params[0],
                  user_id: params[1],
                  is_active: true,
                },
              ],
            };
          }
          if (String(sql).includes('FROM messages')) {
            return { rows: [] };
          }
          return { rows: [] };
        },
        withTransaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
      },
    };

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        hasPermission: (actor, code) => (actor.permissions || []).includes(code),
      },
    };

    require.cache[supabasePath] = {
      id: supabasePath,
      filename: supabasePath,
      loaded: true,
      exports: { getAdminClient: () => null },
    };
    require.cache[notificationPath] = {
      id: notificationPath,
      filename: notificationPath,
      loaded: true,
      exports: { createNotification: async () => null },
    };
    require.cache[presencePath] = {
      id: presencePath,
      filename: presencePath,
      loaded: true,
      exports: { isUserViewing: () => false },
    };
    require.cache[auditPath] = {
      id: auditPath,
      filename: auditPath,
      loaded: true,
      exports: { writeAudit: async () => null },
    };

    delete require.cache[chatServicePath];
    // eslint-disable-next-line global-require, import/no-dynamic-require
    service = require(chatServicePath);
  });

  afterEach(() => {
    delete require.cache[dbPath];
    delete require.cache[authPath];
    delete require.cache[supabasePath];
    delete require.cache[notificationPath];
    delete require.cache[presencePath];
    delete require.cache[auditPath];
    delete require.cache[chatServicePath];
  });

  it('applies chat_user_blocks filter for members', async () => {
    const actor = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      permissions: ['chat.read'],
      roles: ['member'],
    };
    await service.listMessages('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', actor, {
      limit: 20,
    });
    assert.match(lastSql, /chat_user_blocks/);
    assert.equal(lastParams[0], 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    assert.equal(lastParams[1], actor.id);
  });

  it('skips block filter for moderators', async () => {
    const actor = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      permissions: ['chat.read', 'chat.moderate'],
      roles: ['admin'],
    };
    await service.listMessages('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', actor, {
      limit: 20,
    });
    assert.doesNotMatch(lastSql, /chat_user_blocks/);
  });
});
