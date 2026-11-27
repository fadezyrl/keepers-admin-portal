/**
 * Chat UGC moderation service tests (require-cache stubs).
 * Run: node --test __tests__/chatModerationService.test.js
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const dbPath = path.resolve(__dirname, '../src/config/db.js');
const chatServicePath = path.resolve(__dirname, '../src/services/chatService.js');
const memberServicePath = path.resolve(
  __dirname,
  '../src/services/memberService.js',
);
const authPath = path.resolve(__dirname, '../src/middleware/auth.js');
const moderationPath = path.resolve(
  __dirname,
  '../src/services/chatModerationService.js',
);

function makeActor(overrides = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    roles: ['member'],
    permissions: ['chat.read', 'chat.send'],
    ...overrides,
  };
}

function makeModerator() {
  return makeActor({
    id: '22222222-2222-2222-2222-222222222222',
    roles: ['admin'],
    permissions: ['chat.read', 'chat.send', 'chat.moderate', 'members.manage'],
  });
}

describe('chatModerationService', () => {
  let state;
  let service;
  let softDeleteCalls;
  let setStatusCalls;

  beforeEach(() => {
    softDeleteCalls = [];
    setStatusCalls = [];
    state = {
      messages: new Map(),
      reports: [],
      blocks: [],
      actions: [],
      profiles: new Map(),
      participants: [],
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

          if (
            text.includes('FROM member_profiles') &&
            text.includes('deleted_at IS NULL') &&
            text.includes('WHERE id = $1')
          ) {
            const row = state.profiles.get(params[0]);
            return { rows: row ? [row] : [] };
          }

          if (text.includes('FROM conversation_participants')) {
            const hit = state.participants.some(
              (p) =>
                p.conversation_id === params[0] && p.user_id === params[1],
            );
            return { rows: hit ? [{ ok: 1 }] : [] };
          }

          if (
            text.includes('FROM chat_reports') &&
            text.includes("report_type = 'message'") &&
            text.includes('status IN')
          ) {
            const hit = state.reports.find(
              (r) =>
                r.reporter_id === params[0] &&
                r.message_id === params[1] &&
                r.report_type === 'message' &&
                ['open', 'reviewing'].includes(r.status),
            );
            return { rows: hit ? [{ id: hit.id }] : [] };
          }

          if (
            text.includes('FROM chat_reports') &&
            text.includes("report_type = 'member'") &&
            text.includes('status IN')
          ) {
            const hit = state.reports.find(
              (r) =>
                r.reporter_id === params[0] &&
                r.reported_user_id === params[1] &&
                r.report_type === 'member' &&
                ['open', 'reviewing'].includes(r.status),
            );
            return { rows: hit ? [{ id: hit.id }] : [] };
          }

          if (
            text.includes('INSERT INTO chat_reports') &&
            text.includes("'message'")
          ) {
            const dup = state.reports.find(
              (r) =>
                r.reporter_id === params[0] &&
                r.message_id === params[2] &&
                r.report_type === 'message' &&
                ['open', 'reviewing'].includes(r.status),
            );
            if (dup) {
              const err = new Error('duplicate');
              err.code = '23505';
              throw err;
            }
            const row = {
              id: `rep-${state.reports.length + 1}`,
              reporter_id: params[0],
              conversation_id: params[1],
              message_id: params[2],
              reported_user_id: params[3],
              reason: params[4],
              details: params[5],
              report_type: 'message',
              status: 'open',
              reviewed_by: null,
              review_notes: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            state.reports.push(row);
            return { rows: [row] };
          }

          if (
            text.includes('INSERT INTO chat_reports') &&
            text.includes("'member'")
          ) {
            const dup = state.reports.find(
              (r) =>
                r.reporter_id === params[0] &&
                r.reported_user_id === params[2] &&
                r.report_type === 'member' &&
                ['open', 'reviewing'].includes(r.status),
            );
            if (dup) {
              const err = new Error('duplicate');
              err.code = '23505';
              throw err;
            }
            const row = {
              id: `rep-${state.reports.length + 1}`,
              reporter_id: params[0],
              conversation_id: params[1],
              message_id: null,
              reported_user_id: params[2],
              reason: params[3],
              details: params[4],
              report_type: 'member',
              status: 'open',
              reviewed_by: null,
              review_notes: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            state.reports.push(row);
            return { rows: [row] };
          }

          if (text.includes('INSERT INTO chat_moderation_actions')) {
            state.actions.push({
              actor_id: params[0],
              action: params[1],
              conversation_id: params[2],
              message_id: params[3],
              target_user_id: params[4],
              reason: params[5],
              metadata: params[6],
            });
            return { rows: [] };
          }

          if (text.includes('INSERT INTO chat_user_blocks')) {
            if (params[0] === params[1]) {
              const err = new Error('self');
              err.code = '23514';
              throw err;
            }
            let row = state.blocks.find(
              (b) =>
                b.blocker_id === params[0] && b.blocked_user_id === params[1],
            );
            if (row) {
              row.reason = params[2] ?? row.reason;
              row.updated_at = new Date().toISOString();
            } else {
              row = {
                id: `blk-${state.blocks.length + 1}`,
                blocker_id: params[0],
                blocked_user_id: params[1],
                reason: params[2],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              state.blocks.push(row);
            }
            return { rows: [row] };
          }

          if (
            text.includes('FROM chat_user_blocks b') &&
            text.includes('JOIN member_profiles') &&
            text.includes('WHERE b.id')
          ) {
            const row = state.blocks.find((b) => b.id === params[0]);
            const profile = state.profiles.get(row.blocked_user_id);
            return {
              rows: [
                {
                  ...row,
                  first_name: profile?.first_name || 'Blocked',
                  last_name: profile?.last_name || 'User',
                  avatar_url: profile?.avatar_url || null,
                },
              ],
            };
          }

          if (
            text.includes('DELETE FROM chat_user_blocks') &&
            text.includes('RETURNING')
          ) {
            const idx = state.blocks.findIndex(
              (b) =>
                b.blocker_id === params[0] && b.blocked_user_id === params[1],
            );
            if (idx < 0) return { rows: [] };
            const [row] = state.blocks.splice(idx, 1);
            return { rows: [row] };
          }

          if (
            text.includes('FROM chat_user_blocks b') &&
            text.includes('WHERE b.blocker_id')
          ) {
            const rows = state.blocks
              .filter((b) => b.blocker_id === params[0])
              .map((b) => {
                const profile = state.profiles.get(b.blocked_user_id) || {};
                return {
                  ...b,
                  first_name: profile.first_name || 'Blocked',
                  last_name: profile.last_name || 'User',
                  avatar_url: profile.avatar_url || null,
                };
              });
            return { rows };
          }

          if (text.includes('SELECT blocked_user_id FROM chat_user_blocks')) {
            return {
              rows: state.blocks
                .filter((b) => b.blocker_id === params[0])
                .map((b) => ({ blocked_user_id: b.blocked_user_id })),
            };
          }

          if (
            text.includes('FROM chat_user_blocks') &&
            text.includes('blocked_user_id = $2')
          ) {
            const hit = state.blocks.some(
              (b) =>
                b.blocker_id === params[0] && b.blocked_user_id === params[1],
            );
            return { rows: hit ? [{ ok: 1 }] : [] };
          }

          if (text.includes('FROM chat_reports r') && text.includes('WHERE r.id')) {
            const row = state.reports.find((r) => r.id === params[0]);
            return { rows: row ? [{ ...row }] : [] };
          }

          if (text.includes('SELECT * FROM chat_reports WHERE id')) {
            const row = state.reports.find((r) => r.id === params[0]);
            return { rows: row ? [row] : [] };
          }

          if (text.includes('UPDATE chat_reports')) {
            const row = state.reports.find((r) => r.id === params[3]);
            if (row) {
              row.status = params[0];
              row.reviewed_by = params[1];
              if (params[2] != null) row.review_notes = params[2];
              row.updated_at = new Date().toISOString();
            }
            return { rows: [] };
          }

          if (text.includes('COUNT(*)::int AS total FROM chat_reports')) {
            return { rows: [{ total: state.reports.length }] };
          }

          if (text.includes('FROM chat_reports r') && text.includes('ORDER BY')) {
            return { rows: state.reports.map((r) => ({ ...r })) };
          }

          if (text.includes('COUNT(*)::int AS total FROM chat_moderation_actions')) {
            return { rows: [{ total: state.actions.length }] };
          }

          if (text.includes('FROM chat_moderation_actions a')) {
            return {
              rows: state.actions.map((a, i) => ({
                id: `act-${i + 1}`,
                ...a,
                created_at: new Date().toISOString(),
                actor_name: 'Admin',
                target_name: 'Member',
              })),
            };
          }

          return { rows: [] };
        },
      },
    };

    require.cache[authPath] = {
      id: authPath,
      filename: authPath,
      loaded: true,
      exports: {
        hasPermission: (actor, code) =>
          (actor.permissions || []).includes(code) ||
          (actor.roles || []).includes('super_admin'),
      },
    };

    require.cache[chatServicePath] = {
      id: chatServicePath,
      filename: chatServicePath,
      loaded: true,
      exports: {
        assertCanAccessConversation: async () => ({
          conversation: { id: 'conv-1' },
          asModerator: false,
        }),
        softDeleteMessage: async (messageId, actor, reason) => {
          softDeleteCalls.push({ messageId, actorId: actor.id, reason });
          return { id: messageId, deleted: true };
        },
      },
    };

    require.cache[memberServicePath] = {
      id: memberServicePath,
      filename: memberServicePath,
      loaded: true,
      exports: {
        setMemberStatus: async (memberId, payload, actor) => {
          setStatusCalls.push({ memberId, payload, actorId: actor.id });
          return { id: memberId, status: payload.status };
        },
      },
    };

    delete require.cache[moderationPath];
    // eslint-disable-next-line global-require, import/no-dynamic-require
    service = require(moderationPath);

    state.profiles.set('33333333-3333-3333-3333-333333333333', {
      id: '33333333-3333-3333-3333-333333333333',
      first_name: 'Alex',
      last_name: 'Rider',
      avatar_url: null,
    });
    state.profiles.set('44444444-4444-4444-4444-444444444444', {
      id: '44444444-4444-4444-4444-444444444444',
      first_name: 'Sam',
      last_name: 'Lee',
      avatar_url: null,
    });
    state.messages.set('55555555-5555-5555-5555-555555555555', {
      id: '55555555-5555-5555-5555-555555555555',
      conversation_id: '66666666-6666-6666-6666-666666666666',
      sender_id: '33333333-3333-3333-3333-333333333333',
      content: 'bad message',
      message_type: 'text',
    });
    state.participants.push({
      conversation_id: '66666666-6666-6666-6666-666666666666',
      user_id: '33333333-3333-3333-3333-333333333333',
    });
  });

  afterEach(() => {
    delete require.cache[dbPath];
    delete require.cache[chatServicePath];
    delete require.cache[memberServicePath];
    delete require.cache[authPath];
    delete require.cache[moderationPath];
  });

  it('submits a message report with taxonomy reason', async () => {
    const actor = makeActor();
    const report = await service.reportMessage(
      '55555555-5555-5555-5555-555555555555',
      actor,
      { reason: 'spam', details: 'repeated ads' },
    );
    assert.equal(report.reportType, 'message');
    assert.equal(report.reason, 'spam');
    assert.equal(report.details, 'repeated ads');
    assert.equal(state.actions[0].action, 'report_message');
  });

  it('rejects duplicate open message reports', async () => {
    const actor = makeActor();
    await service.reportMessage(
      '55555555-5555-5555-5555-555555555555',
      actor,
      { reason: 'harassment' },
    );
    await assert.rejects(
      () =>
        service.reportMessage(
          '55555555-5555-5555-5555-555555555555',
          actor,
          { reason: 'harassment' },
        ),
      (err) => err.code === 'DUPLICATE_REPORT' && err.status === 409,
    );
  });

  it('rejects reporting own message and invalid reason', async () => {
    const actor = makeActor({
      id: '33333333-3333-3333-3333-333333333333',
    });
    await assert.rejects(
      () =>
        service.reportMessage(
          '55555555-5555-5555-5555-555555555555',
          actor,
          { reason: 'spam' },
        ),
      (err) => err.status === 400,
    );
    await assert.rejects(
      () =>
        service.reportMessage(
          '55555555-5555-5555-5555-555555555555',
          makeActor(),
          { reason: 'not-a-reason' },
        ),
      (err) => err.code === 'VALIDATION_ERROR',
    );
  });

  it('reports a member and blocks self-report', async () => {
    const actor = makeActor();
    const report = await service.reportMember(
      '33333333-3333-3333-3333-333333333333',
      actor,
      { reason: 'hate', details: 'slurs in chat' },
    );
    assert.equal(report.reportType, 'member');
    assert.equal(report.reportedUserId, '33333333-3333-3333-3333-333333333333');

    await assert.rejects(
      () =>
        service.reportMember(actor.id, actor, { reason: 'other' }),
      (err) => err.status === 400,
    );
  });

  it('blocks and unblocks users without affecting self', async () => {
    const actor = makeActor();
    const blocked = await service.blockUser(
      '33333333-3333-3333-3333-333333333333',
      actor,
      { reason: 'abuse' },
    );
    assert.equal(blocked.blockedUserId, '33333333-3333-3333-3333-333333333333');
    assert.equal(
      (await service.getBlockedUserIds(actor.id)).length,
      1,
    );
    assert.equal(
      await service.isUserBlocked(
        actor.id,
        '33333333-3333-3333-3333-333333333333',
      ),
      true,
    );

    const list = await service.listBlockedUsers(actor);
    assert.equal(list.items.length, 1);

    await assert.rejects(
      () => service.blockUser(actor.id, actor, {}),
      (err) => err.status === 400,
    );

    const unblocked = await service.unblockUser(
      '33333333-3333-3333-3333-333333333333',
      actor,
    );
    assert.equal(unblocked.unblocked, true);
    assert.equal((await service.getBlockedUserIds(actor.id)).length, 0);
  });

  it('admin can dismiss report and delete message', async () => {
    const actor = makeActor();
    const mod = makeModerator();
    const report = await service.reportMessage(
      '55555555-5555-5555-5555-555555555555',
      actor,
      { reason: 'violence' },
    );

    const dismissed = await service.reviewReport(report.id, mod, {
      action: 'dismiss',
      reviewNotes: 'not actionable',
    });
    assert.equal(dismissed.status, 'dismissed');

    const report2 = await service.reportMessage(
      '55555555-5555-5555-5555-555555555555',
      actor,
      { reason: 'violence' },
    );
    // reopen path: previous dismissed, new open allowed
    assert.equal(report2.status, 'open');

    const resolved = await service.reviewReport(report2.id, mod, {
      action: 'delete_message',
      reviewNotes: 'removed',
    });
    assert.equal(resolved.status, 'resolved');
    assert.equal(softDeleteCalls.length, 1);
  });

  it('admin can suspend reported member when permitted', async () => {
    const actor = makeActor();
    const mod = makeModerator();
    const report = await service.reportMember(
      '33333333-3333-3333-3333-333333333333',
      actor,
      { reason: 'harassment' },
    );
    const updated = await service.reviewReport(report.id, mod, {
      action: 'suspend_member',
      reviewNotes: 'repeated abuse',
    });
    assert.equal(updated.status, 'resolved');
    assert.equal(setStatusCalls[0].memberId, '33333333-3333-3333-3333-333333333333');
    assert.equal(setStatusCalls[0].payload.status, 'suspended');
  });

  it('forbids non-moderators from listing reports', async () => {
    await assert.rejects(
      () => service.listReports(makeActor(), {}),
      (err) => err.status === 403,
    );
  });
});
