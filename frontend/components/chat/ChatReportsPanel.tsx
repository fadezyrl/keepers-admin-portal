"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  fetchChatReports,
  reviewChatReport,
} from "@/lib/chatApi";
import {
  canDeleteReportedMessage,
  canSuspendReportedMember,
  reportReasonLabel,
  reportTypeLabel,
  type ChatReport,
  type ChatReportStatus,
  type ChatReportType,
  type ReviewReportAction,
} from "@/lib/chatModeration";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { useAdminQuery } from "@/lib/useAdminQuery";

type PendingAction = {
  report: ChatReport;
  action: ReviewReportAction;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
};

export function ChatReportsPanel() {
  const toast = useToast();
  const [status, setStatus] = useState<ChatReportStatus | "">("open");
  const [reportType, setReportType] = useState<ChatReportType | "">("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ChatReport | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useAdminQuery(
    ["chat", "reports", status, reportType, page],
    (_signal) =>
      fetchChatReports({
        status,
        reportType,
        page,
        limit: 20,
      }),
    { staleTime: 30_000 },
  );

  const rows = query.data?.items || [];
  const total = query.data?.total || 0;

  const columns = useMemo<DataColumn<ChatReport>[]>(
    () => [
      {
        key: "created",
        header: "Submitted",
        cell: (row) => formatDateTime(row.createdAt),
      },
      {
        key: "type",
        header: "Type",
        cell: (row) => reportTypeLabel(row.reportType),
      },
      {
        key: "reason",
        header: "Reason",
        cell: (row) => reportReasonLabel(row.reason),
      },
      {
        key: "reported",
        header: "Reported",
        cell: (row) => row.reportedUser?.name || "—",
      },
      {
        key: "reporter",
        header: "Reporter",
        cell: (row) => row.reporter?.name || "—",
      },
      {
        key: "status",
        header: "Status",
        cell: (row) => <StatusBadge status={row.status} />,
      },
    ],
    [],
  );

  async function runAction(action: ReviewReportAction) {
    if (!pending) return;
    setBusy(true);
    try {
      const updated = await reviewChatReport(pending.report.id, {
        action,
        reviewNotes: notes.trim() || null,
      });
      setSelected(updated);
      setPending(null);
      setNotes("");
      toast.success("Moderation action saved");
      await query.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function queueAction(report: ChatReport, action: ReviewReportAction) {
    const map: Record<ReviewReportAction, Omit<PendingAction, "report" | "action">> = {
      dismiss: {
        title: "Dismiss report?",
        description: "Mark this report as reviewed with no further action.",
        confirmLabel: "Dismiss",
        tone: "primary",
      },
      resolve: {
        title: "Resolve report?",
        description: "Mark this report as resolved after your review.",
        confirmLabel: "Resolve",
        tone: "primary",
      },
      delete_message: {
        title: "Delete reported message?",
        description:
          "Soft-delete the message for all participants and resolve this report.",
        confirmLabel: "Delete message",
        tone: "danger",
      },
      suspend_member: {
        title: "Suspend reported member?",
        description:
          "Deactivate the reported member account and resolve this report. Requires members.manage.",
        confirmLabel: "Suspend member",
        tone: "danger",
      },
    };
    setPending({ report, action, ...map[action] });
  }

  return (
    <div className="space-y-4">
      <FilterBar>
        <select
          className="admin-input"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value as ChatReportStatus | "");
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="reviewing">Reviewing</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <select
          className="admin-input"
          value={reportType}
          onChange={(e) => {
            setPage(1);
            setReportType(e.target.value as ChatReportType | "");
          }}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          <option value="message">Message</option>
          <option value="member">Member</option>
        </select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={rows}
        loading={query.loading}
        refreshing={query.refreshing}
        error={query.error}
        emptyTitle="No reports"
        emptyDescription="Reported messages and members will appear here for review."
        page={page}
        limit={20}
        total={total}
        onPageChange={setPage}
        onRowClick={(row) => {
          setSelected(row);
          setNotes(row.reviewNotes || "");
        }}
      />

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Report details"
        subtitle={
          selected
            ? `${reportTypeLabel(selected.reportType)} · ${reportReasonLabel(selected.reason)}`
            : undefined
        }
        wide
        footer={
          selected ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || selected.status === "dismissed"}
                onClick={() => queueAction(selected, "dismiss")}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || selected.status === "resolved"}
                onClick={() => queueAction(selected, "resolve")}
              >
                Resolve
              </button>
              {canDeleteReportedMessage(selected) ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => queueAction(selected, "delete_message")}
                >
                  Delete message
                </button>
              ) : null}
              {canSuspendReportedMember(selected) ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => queueAction(selected, "suspend_member")}
                >
                  Suspend member
                </button>
              ) : null}
            </div>
          ) : null
        }
      >
        {selected ? (
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status">
                <StatusBadge status={selected.status} />
              </Field>
              <Field label="Submitted">
                {formatDateTime(selected.createdAt)}
              </Field>
              <Field label="Reporter">
                {selected.reporter?.name || selected.reporterId}
              </Field>
              <Field label="Reported member">
                {selected.reportedUserId ? (
                  <Link
                    href={`/members/${selected.reportedUserId}`}
                    className="font-medium hover:underline"
                  >
                    {selected.reportedUser?.name || selected.reportedUserId}
                  </Link>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Trip chat">
                {selected.conversation?.tripTitle ||
                  selected.conversationId ||
                  "—"}
              </Field>
              <Field label="Conversation">
                {selected.conversationId || "—"}
              </Field>
            </div>

            {selected.details ? (
              <Field label="Reporter details">{selected.details}</Field>
            ) : null}

            {selected.message ? (
              <Field label="Reported message">
                <div className="rounded-lg border border-[var(--keepers-border)] bg-[var(--keepers-cream)] px-3 py-2">
                  {selected.message.deletedAt ? (
                    <p className="m-0 text-[var(--keepers-muted)]">
                      Message already deleted
                    </p>
                  ) : (
                    <p className="m-0 whitespace-pre-wrap">
                      {selected.message.content ||
                        `[${selected.message.type || "attachment"} message]`}
                    </p>
                  )}
                </div>
              </Field>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wide text-[var(--keepers-muted)]">
                Review notes
              </span>
              <textarea
                className="admin-input min-h-[96px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
                placeholder="Optional notes stored with the moderation action"
              />
            </label>
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending?.title || ""}
        description={pending?.description}
        confirmLabel={pending?.confirmLabel}
        tone={pending?.tone || "danger"}
        busy={busy}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        onConfirm={() => {
          if (!pending) return;
          void runAction(pending.action);
        }}
      />
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="m-0 mb-1 text-xs uppercase tracking-wide text-[var(--keepers-muted)]">
        {label}
      </p>
      <div className="text-[var(--keepers-ink)]">{children}</div>
    </div>
  );
}
