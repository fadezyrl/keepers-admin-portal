"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, buildQuery } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterRegistrationMutation } from "@/lib/invalidate";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useSelection } from "@/lib/useSelection";
import { useToast } from "@/lib/toast";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { FilterBar, SearchInput } from "@/components/ui/FilterBar";
import { RowActions } from "@/components/ui/RowActions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { MemberDrawer } from "@/components/admin/MemberDrawer";

type RegistrationRow = {
  id: string;
  tripId: string;
  userId: string;
  status: string;
  registeredAt?: string | null;
  tripTitle: string;
  tripDate: string;
  destination?: string;
  memberName: string;
  username?: string;
  membership?: string;
};

type RegistrationList = {
  items: RegistrationRow[];
  total: number;
  page?: number;
  limit?: number;
};

const PAGE_SIZE = 20;

export default function RegistrationsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q, 300);
  const { selectedIds, toggle, toggleAll, clear } = useSelection();
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<RegistrationRow | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const listParams = useMemo(
    () => ({
      status: status === "all" ? undefined : status,
      q: debouncedQ.trim() || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [status, debouncedQ, page],
  );

  const path = useMemo(
    () => `/trips/registrations${buildQuery(listParams)}`,
    [listParams],
  );

  const { data, error, loading, refreshing, setData } = useAdminQuery(
    queryKeys.registrations.list(listParams),
    (signal) => api.get<RegistrationList>(path, { signal }),
    { staleTime: stale.operational },
  );

  const items = data?.items || [];
  const total = data?.total;

  function patchRow(id: string, nextStatus: string) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((row) =>
          row.id === id ? { ...row, status: nextStatus } : row,
        ),
      };
    });
    setActive((prev) => (prev?.id === id ? { ...prev, status: nextStatus } : prev));
  }

  async function review(id: string, next: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await api.post(`/trips/registrations/${id}/review`, { status: next });
      patchRow(id, next);
      await afterRegistrationMutation(queryClient);
      toast.success(`Registration marked ${next}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update registration");
    } finally {
      setBusyIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(id);
        return nextSet;
      });
    }
  }

  async function runBulk(next: string) {
    const ids = [...selectedIds];
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await api.post(`/trips/registrations/${id}/review`, { status: next });
        patchRow(id, next);
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    clear();
    setBulkStatus(null);
    setBulkBusy(false);
    await afterRegistrationMutation(queryClient);
    toast.push(
      `Bulk update: ${ok} succeeded${fail ? `, ${fail} failed` : ""}`,
      fail ? "danger" : "success",
    );
  }

  const columns: DataColumn<RegistrationRow>[] = [
    {
      key: "member",
      header: "Member",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.memberName || row.username}</div>
          <div className="text-sm text-[var(--keepers-muted)]">{row.membership || "—"}</div>
        </div>
      ),
    },
    {
      key: "trip",
      header: "Trip",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.tripTitle}</div>
          <div className="text-sm text-[var(--keepers-muted)]">
            {formatDate(row.tripDate)}
            {row.destination ? ` · ${row.destination}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "registered",
      header: "Registered",
      cell: (row) => (row.registeredAt ? formatDateTime(row.registeredAt) : "—"),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (row) => (
        <RowActions
          actions={[
            { label: "Review", onClick: () => setActive(row) },
            {
              label: "Approve",
              onClick: () => void review(row.id, "registered"),
              hidden: !["pending", "waitlist"].includes(row.status),
            },
            {
              label: "Waitlist",
              onClick: () => void review(row.id, "waitlist"),
              hidden: !["pending", "registered"].includes(row.status),
            },
            {
              label: "Reject",
              onClick: () => void review(row.id, "rejected"),
              tone: "danger",
              hidden: !["pending", "registered", "waitlist"].includes(row.status),
            },
            {
              label: "Cancel",
              onClick: () => void review(row.id, "cancelled"),
              hidden: !["pending", "registered", "waitlist"].includes(row.status),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Registrations"
        subtitle="Approve, waitlist, reject, or cancel trip registrations from the queue."
      />

      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyTitle="No registrations"
        emptyDescription="When members join trips, registrations appear here for review."
        selectedIds={selectedIds}
        onToggleSelect={toggle}
        onToggleSelectAll={() => toggleAll(items.map((r) => r.id))}
        onRowClick={(row) => setActive(row)}
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
            <select
              className="admin-select max-w-[200px]"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="registered">Registered</option>
              <option value="waitlist">Waitlist</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <SearchInput
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              placeholder="Search member or trip"
              className="max-w-xs min-w-[14rem] flex-1"
            />
          </FilterBar>
        }
        bulkBar={
          selectedIds.size > 0 ? (
            <div className="bulk-bar">
              <span className="text-sm">{selectedIds.size} selected</span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setBulkStatus("registered")}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setBulkStatus("waitlist")}
              >
                Waitlist
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setBulkStatus("rejected")}
              >
                Reject
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
                Clear
              </button>
            </div>
          ) : null
        }
      />

      <Drawer
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={active?.memberName || "Registration"}
        subtitle={active ? `${active.tripTitle} · ${formatDate(active.tripDate)}` : undefined}
        footer={
          active ? (
            <>
              {["pending", "waitlist"].includes(active.status) ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyIds.has(active.id)}
                  onClick={() => void review(active.id, "registered")}
                >
                  Approve
                </button>
              ) : null}
              {["pending", "registered"].includes(active.status) ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyIds.has(active.id)}
                  onClick={() => void review(active.id, "waitlist")}
                >
                  Waitlist
                </button>
              ) : null}
              {["pending", "registered", "waitlist"].includes(active.status) ? (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busyIds.has(active.id)}
                  onClick={() => void review(active.id, "rejected")}
                >
                  Reject
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (active) setMemberId(active.userId);
                }}
              >
                View member
              </button>
            </>
          ) : null
        }
      >
        {active ? (
          <dl className="detail-grid">
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={active.status} />
              </dd>
            </div>
            <div>
              <dt>Membership</dt>
              <dd>{active.membership || "—"}</dd>
            </div>
            <div>
              <dt>Destination</dt>
              <dd>{active.destination || "—"}</dd>
            </div>
            <div>
              <dt>Registered at</dt>
              <dd>{active.registeredAt ? formatDateTime(active.registeredAt) : "—"}</dd>
            </div>
            <div>
              <dt>Username</dt>
              <dd>@{active.username || "—"}</dd>
            </div>
            <div>
              <dt>Trip date</dt>
              <dd>{formatDate(active.tripDate)}</dd>
            </div>
          </dl>
        ) : null}
      </Drawer>

      <MemberDrawer
        memberId={memberId}
        open={Boolean(memberId)}
        onClose={() => setMemberId(null)}
      />

      <ConfirmDialog
        open={bulkStatus !== null}
        title="Update selected registrations?"
        description={`Apply “${bulkStatus}” to ${selectedIds.size} registration${selectedIds.size === 1 ? "" : "s"}.`}
        confirmLabel="Apply"
        tone={bulkStatus === "rejected" ? "danger" : "primary"}
        busy={bulkBusy}
        onClose={() => {
          if (!bulkBusy) setBulkStatus(null);
        }}
        onConfirm={() => {
          if (bulkStatus) void runBulk(bulkStatus);
        }}
      />
    </div>
  );
}
