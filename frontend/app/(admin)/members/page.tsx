"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError, buildQuery } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useSelection } from "@/lib/useSelection";
import { useToast } from "@/lib/toast";
import type { Member, Paginated } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { FilterBar, SearchInput } from "@/components/ui/FilterBar";
import { RowActions } from "@/components/ui/RowActions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingBlock } from "@/components/ui/StateBlock";
import { MemberDrawer } from "@/components/admin/MemberDrawer";

const PAGE_SIZE = 20;

function MembersInner() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const initialStatus = searchParams.get("status") || "";
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q, 300);
  const { selectedIds, toggle, toggleAll, clear } = useSelection();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<"approved" | "rejected" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const path = useMemo(
    () =>
      `/members${buildQuery({
        q: debouncedQ.trim() || undefined,
        status: status || undefined,
        page,
        limit: PAGE_SIZE,
      })}`,
    [debouncedQ, status, page],
  );

  const { data, error, loading, refreshing, setData } = useAsync(
    () => api.get<Paginated<Member>>(path),
    [path],
  );

  const items = data?.items || [];
  const total = data?.pagination?.total;

  function patchMember(updated: Member) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
      };
    });
  }

  async function setMemberStatus(id: string, nextStatus: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await api.post(`/members/${id}/status`, { status: nextStatus });
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((m) => (m.id === id ? { ...m, status: nextStatus } : m)),
        };
      });
      toast.success(`Member marked ${nextStatus}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update member");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function runBulk(nextStatus: "approved" | "rejected") {
    const ids = items
      .filter((m) => selectedIds.has(m.id) && m.status === "pending")
      .map((m) => m.id);
    if (ids.length === 0) {
      setBulkConfirm(null);
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await api.post(`/members/${id}/status`, { status: nextStatus });
        ok += 1;
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((m) => (m.id === id ? { ...m, status: nextStatus } : m)),
          };
        });
      } catch {
        fail += 1;
      }
    }
    clear();
    setBulkConfirm(null);
    setBulkBusy(false);
    toast.push(
      `Bulk ${nextStatus}: ${ok} succeeded${fail ? `, ${fail} failed` : ""}`,
      fail ? "danger" : "success",
    );
  }

  const columns: DataColumn<Member>[] = [
    {
      key: "member",
      header: "Member",
      cell: (m) => (
        <div>
          <div className="font-medium">{m.name}</div>
          <div className="text-sm text-[var(--keepers-muted)]">
            @{m.username} · {m.email}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (m) => <StatusBadge status={m.status} />,
    },
    {
      key: "membership",
      header: "Membership",
      cell: (m) => m.membership || "—",
    },
    {
      key: "roles",
      header: "Roles",
      cell: (m) =>
        (m.roles || []).map((r) => r.code).join(", ") || (
          <span className="text-[var(--keepers-muted)]">—</span>
        ),
    },
    {
      key: "joined",
      header: "Joined",
      cell: (m) => formatDate(m.createdAt),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (m) => (
        <RowActions
          actions={[
            {
              label: "View",
              onClick: () => setDrawerId(m.id),
            },
            {
              label: "Approve",
              onClick: () => void setMemberStatus(m.id, "approved"),
              hidden: m.status === "approved",
            },
            {
              label: "Reject",
              onClick: () => void setMemberStatus(m.id, "rejected"),
              tone: "danger",
              hidden: m.status === "rejected",
            },
            {
              label: m.status === "suspended" ? "Reactivate" : "Suspend",
              onClick: () =>
                void setMemberStatus(m.id, m.status === "suspended" ? "approved" : "suspended"),
              tone: m.status === "suspended" ? "default" : "danger",
              hidden: m.status !== "approved" && m.status !== "suspended",
            },
          ]}
        />
      ),
    },
  ];

  const pendingSelected = items.filter((m) => selectedIds.has(m.id) && m.status === "pending");

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle="Review the roster, approve applicants, and manage status without leaving the list."
      />

      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyTitle="No members found"
        emptyDescription="Try a different search or status filter."
        selectedIds={selectedIds}
        onToggleSelect={toggle}
        onToggleSelectAll={() => toggleAll(items.map((m) => m.id))}
        onRowClick={(m) => setDrawerId(m.id)}
        busyIds={busyIds}
        page={page}
        limit={PAGE_SIZE}
        total={total}
        onPageChange={(p) => {
          setPage(p);
          clear();
        }}
        toolbar={
          <FilterBar>
            <SearchInput
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              placeholder="Search name, email, username…"
              className="max-w-sm min-w-[16rem] flex-1"
            />
            <select
              className="admin-select max-w-[200px]"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="suspended">Suspended</option>
            </select>
          </FilterBar>
        }
        bulkBar={
          selectedIds.size > 0 ? (
            <div className="bulk-bar">
              <span className="text-sm">
                {selectedIds.size} selected
                {pendingSelected.length > 0
                  ? ` · ${pendingSelected.length} pending`
                  : ""}
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pendingSelected.length === 0}
                onClick={() => setBulkConfirm("approved")}
              >
                Approve pending
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={pendingSelected.length === 0}
                onClick={() => setBulkConfirm("rejected")}
              >
                Reject pending
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
                Clear
              </button>
            </div>
          ) : null
        }
      />

      <MemberDrawer
        memberId={drawerId}
        open={Boolean(drawerId)}
        onClose={() => setDrawerId(null)}
        onUpdated={patchMember}
      />

      <ConfirmDialog
        open={bulkConfirm !== null}
        title={bulkConfirm === "approved" ? "Approve selected members?" : "Reject selected members?"}
        description={`This will update ${pendingSelected.length} pending member${pendingSelected.length === 1 ? "" : "s"}.`}
        confirmLabel={bulkConfirm === "approved" ? "Approve" : "Reject"}
        tone={bulkConfirm === "rejected" ? "danger" : "primary"}
        busy={bulkBusy}
        onClose={() => (bulkBusy ? undefined : setBulkConfirm(null))}
        onConfirm={() => {
          if (bulkConfirm) void runBulk(bulkConfirm);
        }}
      />
    </div>
  );
}

export default function MembersPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <MembersInner />
    </Suspense>
  );
}
