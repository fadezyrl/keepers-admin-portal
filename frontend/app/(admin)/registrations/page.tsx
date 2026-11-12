"use client";

import Link from "next/link";
import { api, buildQuery } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Paginated, Trip } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function RegistrationsPage() {
  const { data, error, loading } = useAsync(
    () =>
      api.get<Paginated<Trip>>(
        `/trips${buildQuery({ includeDrafts: true, filter: "all", limit: 100 })}`,
      ),
    [],
  );

  const withRegs = (data?.items || []).filter(
    (t) => (t.registeredCount || 0) > 0 || (t.waitlistCount || 0) > 0,
  );

  return (
    <div>
      <PageHeader
        title="Registrations"
        subtitle="Trip registration counts. Open a trip to manage participants and attendance."
      />

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      {!loading && !error && withRegs.length === 0 ? (
        <EmptyBlock
          title="No registrations yet"
          description="When members join published trips, totals will appear here."
        />
      ) : null}

      {!loading && !error && withRegs.length > 0 ? (
        <div className="panel overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Trip</th>
                <th>Date</th>
                <th>Registered</th>
                <th>Waitlist</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {withRegs.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/trips/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                    <div className="text-sm text-[var(--keepers-muted)]">{t.destination}</div>
                  </td>
                  <td>{formatDate(t.date)}</td>
                  <td>
                    {t.registeredCount ?? 0}
                    {t.maxParticipants ? ` / ${t.maxParticipants}` : ""}
                  </td>
                  <td>{t.waitlistCount ?? 0}</td>
                  <td>
                    <StatusBadge status={t.publishStatus || t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
