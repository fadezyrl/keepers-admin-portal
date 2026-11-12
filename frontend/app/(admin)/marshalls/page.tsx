"use client";

import Link from "next/link";
import { useMemo } from "react";
import { api, buildQuery } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Member, Paginated } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

async function loadMarshalls() {
  const [marshall, pre] = await Promise.all([
    api.get<Paginated<Member>>(
      `/members${buildQuery({ role: "marshall", limit: 100 })}`,
    ),
    api.get<Paginated<Member>>(
      `/members${buildQuery({ role: "pre_marshall", limit: 100 })}`,
    ),
  ]);

  const map = new Map<string, Member & { roleLabels: string[] }>();
  for (const m of marshall.items) {
    map.set(m.id, { ...m, roleLabels: ["marshall"] });
  }
  for (const m of pre.items) {
    const existing = map.get(m.id);
    if (existing) existing.roleLabels.push("pre_marshall");
    else map.set(m.id, { ...m, roleLabels: ["pre_marshall"] });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function MarshallsPage() {
  const { data, error, loading } = useAsync(loadMarshalls, []);
  const rows = useMemo(() => data || [], [data]);

  return (
    <div>
      <PageHeader
        title="Marshalls"
        subtitle="Members with marshall or pre-marshall roles."
      />

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      {!loading && !error && rows.length === 0 ? (
        <EmptyBlock
          title="No marshalls yet"
          description="Assign marshall or pre_marshall roles from a member profile."
        />
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <div className="panel overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Roles</th>
                <th>Membership</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                      {m.name}
                    </Link>
                    <div className="text-sm text-[var(--keepers-muted)]">@{m.username}</div>
                  </td>
                  <td>
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="text-sm">{m.roleLabels.join(", ")}</td>
                  <td>{m.membership || "—"}</td>
                  <td className="text-sm">{m.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
