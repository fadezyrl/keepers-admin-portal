/**
 * softDeleteMessage authorization + realtime emit + audit.
 * Run: node --test __tests__/chatSoftDelete.test.js
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

describe('chatService softDeleteMessage', () => {
  let state;
  let emits;
  let service;

  beforeEach(() => {
    emits = [];
    state = {
      messages: new Map([
        [
          'msg-1',
          {
            id: 'msg-1',
            conversation_id: 'conv-1',
            sender_id: 'user-a',
            deleted_at: null,
            content: 'hello',
          },
        ],
        [
          'msg-2',
          {
            id: 'msg-2',
            conversation_id: 'conv-1',
            sender_id: 'user-b',
            deleted_at: null,
            content: 'other',
          },
        ],
      ]),
      actions: [],
    };

    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        query: async (sql, params = []) => {
          const text = String(sql);
          if (text.includes('FROM messages WHERE id')) {
            const row = state.messages.get(params[0]);
            return { rows: row ? [row] : [] };
          }
          if (text.includes('FROM conversations')) {
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
          if (text.includes('FROM conversation_participants')) {
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
          if (text.includes('UPDATE messages SET deleted_at')) {
            const row = state.messages.get(params[1]);
            if (row) {
              row.deleted_at = new Date().toISOString();
              row.deleted_by = params[0];
            }
            return { rows: [] };
          }
          if (text.includes('INSERT INTO chat_moderation_actions')) {
            // SQL hardcodes action = 'delete_message'; params are actor, conversation, message, reason.
            state.actions.push({
              actor_id: params[0],
              action: 'delete_message',
              conversation_id: params[1],
              message_id: params[2],
              reason: params[3],
            });
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
    service.setChatSocketHub({
      emitToConversation: (conversationId, event, payload) => {
        emits.push({ conversationId, event, payload });
      },
    });
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

  it('allows sender to soft-delete own message and emits realtime event', async () => {
    const actor = {
      id: 'user-a',
      permissions: ['chat.read', 'chat.send'],
      roles: ['member'],
    };
    const result = await service.softDeleteMessage('msg-1', actor);
    assert.equal(result.deleted, true);
    assert.equal(result.alreadyDeleted, false);
    assert.ok(state.messages.get('msg-1').deleted_at);
    assert.equal(state.actions[0].action, 'delete_message');
    assert.equal(state.actions[0].reason, 'user_delete');
    assert.equal(emits[0].event, 'chat:message.deleted');
    assert.equal(emits[0].payload.messageId, 'msg-1');
  });

  it('forbids deleting another member message', async () => {
    const actor = {
      id: 'user-a',
      permissions: ['chat.read', 'chat.send'],
      roles: ['member'],
    };
    await assert.rejects(
      () => service.softDeleteMessage('msg-2', actor),
      (err) => err.status === 403 && err.code === 'FORBIDDEN',
    );
    assert.equal(state.messages.get('msg-2').deleted_at, null);
    assert.equal(emits.length, 0);
  });

  it('allows moderators to delete any message', async () => {
    const actor = {
      id: 'admin-1',
      permissions: ['chat.read', 'chat.moderate'],
      roles: ['admin'],
    };
    const result = await service.softDeleteMessage('msg-2', actor, 'policy');
    assert.equal(result.deleted, true);
    assert.equal(state.actions[0].reason, 'policy');
    assert.equal(emits.length, 1);
  });

  it('is idempotent for already deleted messages', async () => {
    const actor = {
      id: 'user-a',
      permissions: ['chat.read', 'chat.send'],
      roles: ['member'],
    };
    await service.softDeleteMessage('msg-1', actor);
    const second = await service.softDeleteMessage('msg-1', actor);
    assert.equal(second.alreadyDeleted, true);
    assert.equal(state.actions.length, 1);
    assert.equal(emits.length, 1);
  });
});
