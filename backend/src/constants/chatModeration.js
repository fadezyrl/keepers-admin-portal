const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate',
  'sexual_content',
  'violence',
  'other',
];

const REPORT_REASON_LABELS = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate: 'Hate speech',
  sexual_content: 'Sexual content',
  violence: 'Violence or threats',
  other: 'Other',
};

const REPORT_TYPES = ['message', 'member'];

const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];

const MODERATION_ACTIONS = [
  'dismiss_report',
  'delete_message',
  'suspend_member',
  'resolve_report',
  'block_user',
  'unblock_user',
  'report_message',
  'report_member',
];

module.exports = {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  REPORT_TYPES,
  REPORT_STATUSES,
  MODERATION_ACTIONS,
};
