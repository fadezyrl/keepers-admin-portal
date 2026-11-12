"use client";

import Link from "next/link";
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
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const from = format(startOfMonth(cursor), "yyyy-MM-dd");
  const to = format(endOfMonth(cursor), "yyyy-MM-dd");

  const { data, error, loading } = useAsync(
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

  return (
    <div>
      <PageHeader
        title="Calendar"
        subtitle="Month view of trips from the Keepers calendar API."
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

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}

      {!loading && !error ? (
        <div className="panel overflow-hidden">
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
                        <Link
                          href={`/trips/${t.id}`}
                          className="block truncate text-xs leading-snug hover:underline"
                          title={t.title}
                        >
                          {t.title}
                        </Link>
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

      {!loading && !error ? (
        <section className="mt-8">
          <h2 className="font-display mb-4 text-2xl">Trips this month</h2>
          {monthTrips.length === 0 ? (
            <EmptyBlock
              title="No trips scheduled"
              description="Nothing in this month range from the calendar API."
            />
          ) : (
            <div className="panel overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Trip</th>
                    <th>Destination</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {monthTrips.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {format(parseISO(String(t.date).slice(0, 10)), "dd MMM")}
                        {t.time ? ` · ${String(t.time).slice(0, 5)}` : ""}
                      </td>
                      <td>
                        <Link href={`/trips/${t.id}`} className="hover:underline">
                          {t.title}
                        </Link>
                      </td>
                      <td>{t.destination}</td>
                      <td>
                        <StatusBadge status={t.publishStatus || t.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
