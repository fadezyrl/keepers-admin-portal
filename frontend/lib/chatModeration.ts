export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "sexual_content",
  "violence",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment",
  hate: "Hate speech",
  sexual_content: "Sexual content",
  violence: "Violence or threats",
  other: "Other",
};

export type ChatReportStatus = "open" | "reviewing" | "resolved" | "dismissed";
export type ChatReportType = "message" | "member";

export type ChatReport = {
  id: string;
  reportType: ChatReportType;
  reason: string;
  details?: string | null;
  status: ChatReportStatus;
  conversationId?: string | null;
  messageId?: string | null;
  reporterId: string;
  reportedUserId?: string | null;
  reviewedBy?: string | null;
  reviewNotes?: string | null;
  createdAt: string;
  updatedAt: string;
  reporter?: { id: string; name?: string | null; avatar?: string | null } | null;
  reportedUser?: {
    id: string;
    name?: string | null;
    avatar?: string | null;
  } | null;
  reviewer?: { id: string; name?: string | null } | null;
  message?: {
    id: string;
    type?: string | null;
    content?: string | null;
    deletedAt?: string | null;
    createdAt?: string | null;
  } | null;
  conversation?: {
    id: string;
    type?: string | null;
    tripId?: string | null;
    tripTitle?: string | null;
  } | null;
};

export type ReviewReportAction =
  | "dismiss"
  | "resolve"
  | "delete_message"
  | "suspend_member";

export function reportReasonLabel(reason?: string | null): string {
  if (!reason) return "—";
  if (reason in REPORT_REASON_LABELS) {
    return REPORT_REASON_LABELS[reason as ReportReason];
  }
  return reason.replace(/_/g, " ");
}

export function reportStatusLabel(status?: string | null): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

export function reportTypeLabel(type?: string | null): string {
  if (type === "message") return "Message";
  if (type === "member") return "Member";
  return type || "—";
}

export function canDeleteReportedMessage(report: ChatReport): boolean {
  return Boolean(report.messageId) && !report.message?.deletedAt;
}

export function canSuspendReportedMember(report: ChatReport): boolean {
  return Boolean(report.reportedUserId);
}
