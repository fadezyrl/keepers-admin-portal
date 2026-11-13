"use client";

import { useMemo, useState } from "react";
import { api, buildQuery } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import type { Member, Paginated } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { FilterBar, SearchInput } from "@/components/ui/FilterBar";
import { RowActions } from "@/components/ui/RowActions";
import { MemberDrawer } from "@/components/admin/MemberDrawer";

type MarshallRow = Member & { roleLabels: string[] };

async function loadMarshalls(signal: AbortSignal) {
  const [marshall, pre] = await Promise.all([
    api.get<Paginated<Member>>(
      `/members${buildQuery({ role: "marshall", limit: 100 })}`,
      { signal },
    ),
    api.get<Paginated<Member>>(
      `/members${buildQuery({ role: "pre_marshall", limit: 100 })}`,
      { signal },
    ),
  ]);

  const map = new Map<string, MarshallRow>();
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
  const { data, error, loading, refreshing } = useAdminQuery(
    queryKeys.members.marshalls(),
    loadMarshalls,
    { staleTime: stale.operational },
  );
  const [q, setQ] = useState("");
  const debouncedQ = useDebouncedValue(q, 250);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = data || [];
    const term = debouncedQ.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (m) =>
        m.name.toLowerCase().includes(term) ||
        m.email.toLowerCase().includes(term) ||
        m.username.toLowerCase().includes(term),
    );
  }, [data, debouncedQ]);

  const columns: DataColumn<MarshallRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (m) => (
        <div>
          <div className="font-medium">{m.name}</div>
          <div className="text-sm text-[var(--keepers-muted)]">@{m.username}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (m) => <StatusBadge status={m.status} />,
    },
    {
      key: "roles",
      header: "Roles",
      cell: (m) => m.roleLabels.join(", "),
    },
    {
      key: "membership",
      header: "Membership",
      cell: (m) => m.membership || "—",
    },
    {
      key: "contact",
      header: "Contact",
      cell: (m) => <span className="text-sm">{m.email}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (m) => (
        <RowActions
          actions={[{ label: "View", onClick: () => setDrawerId(m.id) }]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Marshalls"
        subtitle="Members with marshall or pre-marshall roles. Open a profile to manage permissions."
      />

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyTitle="No marshalls yet"
        emptyDescription="Assign marshall or pre_marshall roles from a member profile."
        onRowClick={(m) => setDrawerId(m.id)}
        toolbar={
          <FilterBar>
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder="Search marshalls…"
              className="max-w-sm min-w-[14rem] flex-1"
            />
          </FilterBar>
        }
      />

      <MemberDrawer
        memberId={drawerId}
        open={Boolean(drawerId)}
        onClose={() => setDrawerId(null)}
      />
    </div>
  );
}
