/**
 * Pure helper tests for admin chat moderation labels/guards.
 * Run from frontend: node --test __tests__/chatModeration.test.mjs
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const REPORT_REASON_LABELS = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate: 'Hate speech',
  sexual_content: 'Sexual content',
  violence: 'Violence or threats',
  other: 'Other',
};

function reportReasonLabel(reason) {
  if (!reason) return '—';
  if (reason in REPORT_REASON_LABELS) return REPORT_REASON_LABELS[reason];
  return String(reason).replace(/_/g, ' ');
}

function canDeleteReportedMessage(report) {
  return Boolean(report.messageId) && !report.message?.deletedAt;
}

function canSuspendReportedMember(report) {
  return Boolean(report.reportedUserId);
}

describe('admin chatModeration helpers', () => {
  it('labels standard report reasons', () => {
    assert.equal(reportReasonLabel('violence'), 'Violence or threats');
    assert.equal(reportReasonLabel('sexual_content'), 'Sexual content');
    assert.equal(reportReasonLabel(null), '—');
  });

  it('guards delete/suspend affordances', () => {
    assert.equal(
      canDeleteReportedMessage({
        messageId: 'm1',
        message: { deletedAt: null },
      }),
      true,
    );
    assert.equal(
      canDeleteReportedMessage({
        messageId: 'm1',
        message: { deletedAt: '2026-01-01' },
      }),
      false,
    );
    assert.equal(
      canSuspendReportedMember({ reportedUserId: 'u1' }),
      true,
    );
    assert.equal(canSuspendReportedMember({}), false);
  });
});
