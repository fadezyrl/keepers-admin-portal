"use client";

import { FormEvent, useMemo, useState } from "react";
import { api, ApiError, buildQuery } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useToast } from "@/lib/toast";
import type { Paginated, Member } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { FilterBar } from "@/components/ui/FilterBar";
import { RowActions } from "@/components/ui/RowActions";
import { FormField } from "@/components/ui/FormField";
import { ErrorBlock } from "@/components/ui/StateBlock";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { MemberDrawer } from "@/components/admin/MemberDrawer";

type RoleInfo = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  permissions: string[];
};

type RolesPayload = {
  roles: RoleInfo[];
  permissions: Array<{ id: string; code: string; name: string; description?: string }>;
};

const MANAGEABLE = ["member", "pre_marshall", "marshall"] as const;

export default function RolesPage() {
  const toast = useToast();
  const rolesQuery = useAsync(() => api.get<RolesPayload>("/dashboard/roles"), []);
  const [roleFilter, setRoleFilter] = useState("marshall");
  const membersPath = useMemo(
    () => `/members${buildQuery({ role: roleFilter, limit: 100 })}`,
    [roleFilter],
  );
  const membersQuery = useAsync(
    () => api.get<Paginated<Member>>(membersPath),
    [membersPath],
  );

  const [pickerQ, setPickerQ] = useState("");
  const debouncedPickerQ = useDebouncedValue(pickerQ, 300);
  const pickerPath = useMemo(
    () =>
      `/members${buildQuery({
        q: debouncedPickerQ.trim() || undefined,
        status: "approved",
        limit: 8,
      })}`,
    [debouncedPickerQ],
  );
  const pickerQuery = useAsync(
    () =>
      debouncedPickerQ.trim().length < 2
        ? Promise.resolve({ items: [], pagination: { page: 1, limit: 8, total: 0 } } as Paginated<Member>)
        : api.get<Paginated<Member>>(pickerPath),
    [pickerPath, debouncedPickerQ],
  );

  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [assignRole, setAssignRole] = useState("marshall");
  const [busy, setBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);

  async function onAssign(e: FormEvent) {
    e.preventDefault();
    if (!selectedMember) {
      toast.error("Select a member from search results");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/members/${selectedMember.id}/roles`, { role: assignRole });
      toast.success(`Assigned “${assignRole}” to ${selectedMember.name}`);
      setSelectedMember(null);
      setPickerQ("");
      await membersQuery.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to assign role");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string, role: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await api.delete(`/members/${id}/roles/${role}`);
      membersQuery.setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.filter((m) => m.id !== id),
          pagination: {
            ...prev.pagination,
            total:
              typeof prev.pagination.total === "number"
                ? Math.max(0, prev.pagination.total - 1)
                : prev.pagination.total,
          },
        };
      });
      toast.success(`Removed “${role}”`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove role");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const columns: DataColumn<Member>[] = [
    {
      key: "member",
      header: "Member",
      cell: (m) => (
        <div>
          <div className="font-medium">{m.name}</div>
          <div className="text-sm text-[var(--keepers-muted)]">@{m.username}</div>
        </div>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      cell: (m) => (m.roles || []).map((r) => r.code || String(r)).join(", ") || "—",
    },
    {
      key: "actions",
      header: "Actions",
      cell: (m) => (
        <RowActions
          actions={[
            { label: "View", onClick: () => setDrawerId(m.id) },
            {
              label: `Remove ${roleFilter}`,
              onClick: () => void onRemove(m.id, roleFilter),
              tone: "danger",
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        subtitle="View role grants and assign Member, Pre-Marshall, and Marshall roles. Admin escalation is restricted."
      />

      <section className="mb-10">
        <h2 className="font-display mb-4 text-2xl">Role matrix</h2>
        {rolesQuery.loading ? <TableSkeleton rows={3} cols={2} /> : null}
        {rolesQuery.error ? <ErrorBlock message={rolesQuery.error} /> : null}
        {!rolesQuery.loading && !rolesQuery.error ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {(rolesQuery.data?.roles || []).map((role) => (
              <article key={role.id} className="panel p-5">
                <h3 className="font-display m-0 text-xl">{role.name}</h3>
                <p className="mt-1 font-mono text-xs text-[var(--keepers-muted)]">{role.code}</p>
                {role.description ? (
                  <p className="mt-2 text-sm text-[var(--keepers-muted)]">{role.description}</p>
                ) : null}
                <ul className="mt-4 m-0 list-none space-y-1 p-0">
                  {(role.permissions || []).map((code) => (
                    <li key={code} className="font-mono text-xs text-[var(--keepers-muted)]">
                      {code}
                    </li>
                  ))}
                  {(role.permissions || []).length === 0 ? (
                    <li className="text-sm text-[var(--keepers-muted)]">No permissions mapped</li>
                  ) : null}
                </ul>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mb-10">
        <h2 className="font-display mb-4 text-2xl">Assign role</h2>
        <form onSubmit={onAssign} className="panel grid gap-4 p-6 lg:grid-cols-[1.4fr_0.8fr_auto]">
          <div>
            <FormField label="Find member">
              <input
                className="admin-input"
                value={pickerQ}
                onChange={(e) => {
                  setPickerQ(e.target.value);
                  setSelectedMember(null);
                }}
                placeholder="Search name, email, username…"
              />
            </FormField>
            {selectedMember ? (
              <p className="mt-2 mb-0 text-sm">
                Selected: <strong>{selectedMember.name}</strong> (@{selectedMember.username})
              </p>
            ) : null}
            {debouncedPickerQ.trim().length >= 2 && !selectedMember ? (
              <ul className="mt-2 m-0 max-h-48 list-none overflow-y-auto border border-[var(--keepers-line)] p-0">
                {(pickerQuery.data?.items || []).map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--keepers-cream)]"
                      onClick={() => {
                        setSelectedMember(m);
                        setPickerQ(m.name);
                      }}
                    >
                      {m.name}
                      <span className="text-[var(--keepers-muted)]"> · @{m.username}</span>
                    </button>
                  </li>
                ))}
                {!pickerQuery.loading && (pickerQuery.data?.items || []).length === 0 ? (
                  <li className="px-3 py-2 text-sm text-[var(--keepers-muted)]">No matches</li>
                ) : null}
              </ul>
            ) : null}
          </div>
          <FormField label="Role">
            <select
              className="admin-select"
              value={assignRole}
              onChange={(e) => setAssignRole(e.target.value)}
            >
              {MANAGEABLE.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </FormField>
          <div className="flex items-end">
            <button type="submit" className="btn btn-primary" disabled={busy || !selectedMember}>
              Assign
            </button>
          </div>
        </form>
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display m-0 text-2xl">Members by role</h2>
          <FilterBar>
            <select
              className="admin-select"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              {MANAGEABLE.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </FilterBar>
        </div>
        <DataTable
          columns={columns}
          rows={membersQuery.data?.items || []}
          loading={membersQuery.loading}
          refreshing={membersQuery.refreshing}
          error={membersQuery.error}
          emptyTitle="No members"
          emptyDescription="No members currently hold this role."
          onRowClick={(m) => setDrawerId(m.id)}
          busyIds={busyIds}
        />
      </section>

      <MemberDrawer
        memberId={drawerId}
        open={Boolean(drawerId)}
        onClose={() => setDrawerId(null)}
      />
    </div>
  );
}
