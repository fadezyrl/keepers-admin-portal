"use client";

import Link from "next/link";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { DashboardStats } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function DashboardPage() {
  const { data, error, loading } = useAsync(
    () => api.get<DashboardStats>("/dashboard/stats"),
    [],
  );

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <EmptyBlock title="No dashboard data" />;

  const totals = data.totals;
  const stats = [
    { label: "Members", value: totals.members, href: "/members" },
    { label: "Active", value: totals.activeMembers, href: "/members?status=approved" },
    { label: "Pending", value: totals.pendingApprovals, href: "/members?status=pending" },
    { label: "Marshalls", value: totals.marshalls, href: "/marshalls" },
    { label: "Upcoming trips", value: totals.upcomingTrips, href: "/trips" },
    { label: "Registrations", value: totals.activeRegistrations, href: "/registrations" },
    { label: "Upgrade requests", value: totals.pendingUpgradeRequests, href: "/ratings" },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live club pulse from the Keepers API — counts reflect current membership and trips."
      />

      <div className="grid gap-px bg-[var(--keepers-line)] sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="bg-[var(--keepers-white)] p-5 transition-colors hover:bg-[var(--keepers-cream)]"
          >
            <p className="text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              {s.label}
            </p>
            <p className="stat-value mt-3">{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section className="panel">
          <div className="border-b border-[var(--keepers-line)] px-5 py-4">
            <h2 className="font-display m-0 text-2xl">Upcoming calendar</h2>
          </div>
          {data.upcomingCalendar.length === 0 ? (
            <EmptyBlock
              title="No trips in range"
              description="Published and completed trips within the next 60 days will appear here."
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-[var(--keepers-line)] p-0">
              {data.upcomingCalendar.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/trips/${t.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-[var(--keepers-cream)]/60"
                  >
                    <div>
                      <p className="m-0 font-medium">{t.title}</p>
                      <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                        {formatDate(t.date)}
                        {t.destination ? ` · ${t.destination}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="border-b border-[var(--keepers-line)] px-5 py-4">
            <h2 className="font-display m-0 text-2xl">Recent activity</h2>
          </div>
          {data.recentActivity.length === 0 ? (
            <EmptyBlock
              title="No audit events yet"
              description="Administrative actions will list here as the club operates."
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-[var(--keepers-line)] p-0">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="px-5 py-4">
                  <p className="m-0 text-sm font-medium tracking-wide">{a.action}</p>
                  <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                    {a.actorName || "System"}
                    {a.entityType ? ` · ${a.entityType}` : ""}
                    {" · "}
                    {formatDateTime(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
