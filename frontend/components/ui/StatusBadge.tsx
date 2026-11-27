import { statusLabel } from "@/lib/format";

const CLASS_MAP: Record<string, string> = {
  approved: "badge-approved",
  published: "badge-published",
  completed: "badge-completed",
  active: "badge-active",
  registered: "badge-approved",
  upcoming: "badge-approved",
  pending: "badge-pending",
  draft: "badge-draft",
  waitlist: "badge-waitlist",
  rejected: "badge-rejected",
  suspended: "badge-suspended",
  deleted: "badge-deleted",
  cancelled: "badge-cancelled",
  full: "badge-pending",
  open: "badge-pending",
  reviewing: "badge-waitlist",
  resolved: "badge-approved",
  dismissed: "badge-draft",
};

export function StatusBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="badge">—</span>;
  const key = status.toLowerCase();
  const cls = CLASS_MAP[key] || "";
  return <span className={`badge ${cls}`}>{statusLabel(status)}</span>;
}
