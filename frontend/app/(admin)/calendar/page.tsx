"use client";

import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { api, buildQuery } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Paginated, Trip } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyBlock, ErrorBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TripQuickDrawer } from "@/components/admin/TripDrawer";

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [tripId, setTripId] = useState<string | null>(null);

  const from = format(startOfMonth(cursor), "yyyy-MM-dd");
  const to = format(endOfMonth(cursor), "yyyy-MM-dd");

  const { data, error, loading, refreshing } = useAsync(
    () =>
      api.get<Paginated<Trip>>(
        `/trips/calendar${buildQuery({ from, to, includeDrafts: true })}`,
      ),
    [from, to],
  );

  const tripsByDay = useMemo(() => {
    const map = new Map<string, Trip[]>();
    for (const t of data?.items || []) {
      const key = String(t.date).slice(0, 10);
      const list = map.get(key) || [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [data]);

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
  });

  const monthTrips = data?.items || [];

  const columns: DataColumn<Trip>[] = [
    {
      key: "date",
      header: "Date",
      cell: (t) => (
        <>
          {format(parseISO(String(t.date).slice(0, 10)), "dd MMM")}
          {t.time ? ` · ${String(t.time).slice(0, 5)}` : ""}
        </>
      ),
    },
    {
      key: "trip",
      header: "Trip",
      cell: (t) => <span className="font-medium">{t.title}</span>,
    },
    {
      key: "destination",
      header: "Destination",
      cell: (t) => t.destination,
    },
    {
      key: "status",
      header: "Status",
      cell: (t) => <StatusBadge status={t.publishStatus || t.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Month view of trips — open a trip drawer without leaving the calendar."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCursor((d) => addMonths(d, -1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCursor(startOfMonth(new Date()))}
            >
              Today
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCursor((d) => addMonths(d, 1))}
            >
              Next
            </button>
          </div>
        }
      />

      <p className="font-display mb-6 text-3xl">{format(cursor, "MMMM yyyy")}</p>

      {loading && !data ? <TableSkeleton rows={4} cols={7} /> : null}
      {error && !data ? <ErrorBlock message={error} /> : null}

      {data || (!loading && !error) ? (
        <div className={`panel overflow-hidden ${refreshing ? "table-refreshing" : ""}`}>
          <div className="grid grid-cols-7 border-b border-[var(--keepers-line)] bg-[var(--keepers-cream)]">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div
                key={d}
                className="px-2 py-3 text-center text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayTrips = tripsByDay.get(key) || [];
              const inMonth = isSameMonth(day, cursor);
              return (
                <div
                  key={key}
                  className={`min-h-[110px] border-r border-b border-[var(--keepers-line)] p-2 ${
                    inMonth ? "bg-[var(--keepers-white)]" : "bg-[var(--keepers-cream)]/40"
                  }`}
                >
                  <div
                    className={`text-sm ${
                      isSameDay(day, new Date())
                        ? "font-semibold text-[var(--keepers-black)]"
                        : "text-[var(--keepers-muted)]"
                    }`}
                  >
                    {format(day, "d")}
                  </div>
                  <ul className="mt-1 list-none space-y-1 p-0">
                    {dayTrips.slice(0, 3).map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="block w-full truncate text-left text-xs leading-snug hover:underline"
                          title={t.title}
                          onClick={() => setTripId(t.id)}
                        >
                          {t.title}
                        </button>
                      </li>
                    ))}
                    {dayTrips.length > 3 ? (
                      <li className="text-[0.65rem] text-[var(--keepers-muted)]">
                        +{dayTrips.length - 3} more
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="font-display mb-4 text-2xl">Trips this month</h2>
        <DataTable
          columns={columns}
          rows={monthTrips}
          loading={loading && monthTrips.length === 0}
          refreshing={refreshing}
          error={error}
          emptyTitle="No trips scheduled"
          emptyDescription="Nothing in this month range from the calendar API."
          onRowClick={(t) => setTripId(t.id)}
        />
      </section>

      <TripQuickDrawer
        tripId={tripId}
        open={Boolean(tripId)}
        onClose={() => setTripId(null)}
      />
    </div>
  );
}
