/**
 * Zod schemas for chat UGC moderation payloads.
 * Run: node --test __tests__/chatModerationSchemas.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  reportMessageSchema,
  reportMemberSchema,
  blockUserSchema,
  reviewReportSchema,
} = require('../src/validators/schemas');

describe('chat moderation schemas', () => {
  it('accepts standard report reasons and details', () => {
    const parsed = reportMessageSchema.parse({
      reason: 'sexual_content',
      details: 'explicit image',
    });
    assert.equal(parsed.reason, 'sexual_content');
  });

  it('rejects unknown report reasons', () => {
    assert.throws(() =>
      reportMessageSchema.parse({ reason: 'not-real' }),
    );
  });

  it('accepts member reports with optional conversationId', () => {
    const parsed = reportMemberSchema.parse({
      reason: 'harassment',
      conversationId: null,
    });
    assert.equal(parsed.reason, 'harassment');
  });

  it('requires uuid for block userId', () => {
    assert.throws(() => blockUserSchema.parse({ userId: 'nope' }));
    const parsed = blockUserSchema.parse({
      userId: '550e8400-e29b-41d4-a716-446655440000',
    });
    assert.equal(parsed.userId, '550e8400-e29b-41d4-a716-446655440000');
  });

  it('accepts admin review actions', () => {
    for (const action of [
      'dismiss',
      'resolve',
      'delete_message',
      'suspend_member',
    ]) {
      assert.equal(
        reviewReportSchema.parse({ action, reviewNotes: 'ok' }).action,
        action,
      );
    }
  });
});
