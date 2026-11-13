"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, buildQuery } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterTripMutation } from "@/lib/invalidate";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useToast } from "@/lib/toast";
import type { Paginated, Trip } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { FilterBar, SearchInput } from "@/components/ui/FilterBar";
import { RowActions } from "@/components/ui/RowActions";
import { TripCreateDrawer, TripQuickDrawer } from "@/components/admin/TripDrawer";

const PAGE_SIZE = 20;

export default function TripsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q, 300);
  const [createOpen, setCreateOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const listParams = useMemo(
    () => ({
      q: debouncedQ.trim() || undefined,
      status: status || undefined,
      includeDrafts: true,
      filter: "all",
      page,
      limit: PAGE_SIZE,
    }),
    [debouncedQ, status, page],
  );

  const path = useMemo(() => `/trips${buildQuery(listParams)}`, [listParams]);

  const { data, error, loading, refreshing, setData } = useAdminQuery(
    queryKeys.trips.list(listParams),
    (signal) => api.get<Paginated<Trip>>(path, { signal }),
    { staleTime: stale.operational },
  );

  const items = data?.items || [];

  function patchTrip(updated: Trip) {
    setData((prev) => {
      if (!prev) return prev;
      const exists = prev.items.some((t) => t.id === updated.id);
      return {
        ...prev,
        items: exists
          ? prev.items.map((t) => (t.id === updated.id ? { ...t, ...updated } : t))
          : [updated, ...prev.items],
      };
    });
  }

  async function setTripStatus(id: string, nextStatus: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await api.post(`/trips/${id}/status`, { status: nextStatus });
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((t) =>
            t.id === id ? { ...t, status: nextStatus, publishStatus: nextStatus } : t,
          ),
        };
      });
      await afterTripMutation(queryClient);
      toast.success(`Trip marked ${nextStatus}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update trip");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const columns: DataColumn<Trip>[] = [
    {
      key: "trip",
      header: "Trip",
      cell: (t) => (
        <div className="flex items-center gap-3">
          {t.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.coverImage} alt="" className="thumb" />
          ) : null}
          <div>
            <div className="font-medium">{t.title}</div>
            <div className="text-sm text-[var(--keepers-muted)]">{t.destination}</div>
          </div>
        </div>
      ),
    },
    {
      key: "date",
      header: "Date",
      cell: (t) => (
        <>
          {formatDate(t.date)}
          {t.time ? ` · ${String(t.time).slice(0, 5)}` : ""}
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (t) => <StatusBadge status={t.publishStatus || t.status} />,
    },
    {
      key: "capacity",
      header: "Capacity",
      cell: (t) => (
        <>
          {t.registeredCount ?? 0}
          {t.maxParticipants ? ` / ${t.maxParticipants}` : ""}
        </>
      ),
    },
    {
      key: "difficulty",
      header: "Difficulty",
      cell: (t) => t.difficulty || "—",
    },
    {
      key: "actions",
      header: "Actions",
      cell: (t) => {
        const s = t.publishStatus || t.status;
        return (
          <RowActions
            actions={[
              { label: "Open", onClick: () => setDrawerId(t.id) },
              {
                label: "Publish",
                onClick: () => void setTripStatus(t.id, "published"),
                hidden: s === "published",
              },
              {
                label: "Unpublish",
                onClick: () => void setTripStatus(t.id, "draft"),
                hidden: s !== "published",
              },
              {
                label: "Cancel",
                onClick: () => void setTripStatus(t.id, "cancelled"),
                tone: "danger",
                hidden: s === "cancelled",
              },
            ]}
          />
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Trips"
        subtitle="Draft, publish, and manage Keepers adventures from the list."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
            New trip
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyTitle="No trips"
        emptyDescription="Create the first adventure to get started."
        onRowClick={(t) => setDrawerId(t.id)}
        busyIds={busyIds}
        page={page}
        limit={PAGE_SIZE}
        total={data?.pagination?.total}
        onPageChange={setPage}
        toolbar={
          <FilterBar>
            <SearchInput
              value={q}
              onChange={(value) => {
                setQ(value);
                setPage(1);
              }}
              placeholder="Search trips…"
              className="max-w-sm min-w-[14rem] flex-1"
            />
            <select
              className="admin-select max-w-[180px]"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </FilterBar>
        }
      />

      <TripCreateDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(trip) => {
          patchTrip(trip);
          void afterTripMutation(queryClient);
          setDrawerId(trip.id);
        }}
      />

      <TripQuickDrawer
        tripId={drawerId}
        open={Boolean(drawerId)}
        onClose={() => setDrawerId(null)}
        onUpdated={patchTrip}
      />
    </div>
  );
}
