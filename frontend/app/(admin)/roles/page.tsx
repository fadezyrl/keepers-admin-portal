"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, buildQuery } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterMemberMutation } from "@/lib/invalidate";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useToast } from "@/lib/toast";
import type { Member, Paginated } from "@/lib/types";
import {
  ROLE_META,
  ROLE_ORDER,
  adminAssignableRoles,
  roleDisplayName,
  type RoleCode,
} from "@/lib/rolesCatalog";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { FilterBar, SearchInput } from "@/components/ui/FilterBar";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ErrorBlock } from "@/components/ui/StateBlock";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { MemberDrawer } from "@/components/admin/MemberDrawer";
import { RoleOverview } from "@/components/admin/roles/RoleOverview";
import { PermissionsMatrix } from "@/components/admin/roles/PermissionsMatrix";
import { RoleDetailDrawer } from "@/components/admin/roles/RoleDetailDrawer";
import { AssignRoleDrawer } from "@/components/admin/roles/AssignRoleDrawer";
import { MemberPermissionsDrawer } from "@/components/admin/roles/MemberPermissionsDrawer";

type RoleInfo = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  permissions: string[];
  memberCount: number;
};

type RolesPayload = {
  roles: RoleInfo[];
  permissions: Array<{ id: string; code: string; name: string; description?: string }>;
  permissionsByRole: Record<string, string[]>;
  memberCountByRole: Record<string, number>;
  uniqueMembers: number;
  organizedTripCountByUserId: Record<string, number>;
  assignedDrivesByUserId: Record<
    string,
    { count: number; titles: string[] }
  >;
};

type TeamFilter = "all" | RoleCode;

function actorRoleCodes(user: ReturnType<typeof useAuth>["user"]): string[] {
  return (user?.roles || []).map((r) => (typeof r === "string" ? r : r.code));
}

export default function RolesPage() {
  const toast = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const roles = actorRoleCodes(user);
  const isSuperAdmin = roles.includes("super_admin");
  const assignable = adminAssignableRoles(roles);

  const rolesQuery = useAdminQuery(
    queryKeys.dashboard.roles(),
    (signal) => api.get<RolesPayload>("/dashboard/roles", { signal }),
    { staleTime: stale.list },
  );

  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [teamQ, setTeamQ] = useState("");
  const debouncedTeamQ = useDebouncedValue(teamQ, 250);
  const [page, setPage] = useState(1);
  const limit = 25;

  const teamParams = useMemo(
    () => ({
      role: teamFilter === "all" ? undefined : teamFilter,
      q: debouncedTeamQ.trim() || undefined,
      limit,
      page,
    }),
    [teamFilter, debouncedTeamQ, page],
  );

  const teamQuery = useAdminQuery(
    queryKeys.members.list(teamParams),
    (signal) =>
      api.get<Paginated<Member>>(`/members${buildQuery(teamParams)}`, { signal }),
    { staleTime: stale.operational },
  );

  const [detailRole, setDetailRole] = useState<RoleCode | null>(null);
  const [memberDrawerId, setMemberDrawerId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<"assign" | "remove">("assign");
  const [assignMember, setAssignMember] = useState<Member | null>(null);
  const [assignRoleCode, setAssignRoleCode] = useState<RoleCode | null>(null);
  const [permissionsMember, setPermissionsMember] = useState<Member | null>(null);

  const permissionsByRole =
    rolesQuery.data?.permissionsByRole ||
    Object.fromEntries(
      (rolesQuery.data?.roles || []).map((r) => [r.code, r.permissions || []]),
    );

  const organized = rolesQuery.data?.organizedTripCountByUserId || {};
  const assigned = rolesQuery.data?.assignedDrivesByUserId || {};

  async function refreshRoleViews() {
    await afterMemberMutation(queryClient);
  }

  function openAssign(member?: Member | null, role?: RoleCode | null) {
    setAssignMode("assign");
    setAssignMember(member || null);
    setAssignRoleCode(role || "marshall");
    setAssignOpen(true);
  }

  function openRemove(member: Member, role: RoleCode) {
    setAssignMode("remove");
    setAssignMember(member);
    setAssignRoleCode(role);
    setAssignOpen(true);
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
      header: "Current roles",
      cell: (m) => {
        const codes = (m.roles || []).map((r) => r.code);
        if (!codes.length) return "—";
        return (
          <div className="flex flex-wrap gap-1.5">
            {codes.map((code) => (
              <span key={code} className="role-chip">
                {roleDisplayName(code)}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: "status",
      header: "Account status",
      cell: (m) => <StatusBadge status={m.status} />,
    },
    {
      key: "drives",
      header: "Assigned drives",
      cell: (m) => {
        const codes = new Set((m.roles || []).map((r) => r.code));
        const parts: string[] = [];
        if (codes.has("marshall")) {
          const n = organized[m.id] || 0;
          parts.push(n ? `${n} organized` : "No organized drives");
        }
        if (codes.has("pre_marshall")) {
          const info = assigned[m.id];
          if (info?.count) {
            parts.push(
              info.titles.length
                ? info.titles.join(", ")
                : `${info.count} assigned`,
            );
          } else {
            parts.push("No assigned drives");
          }
        }
        if (!parts.length) return "—";
        return (
          <span className="text-sm text-[var(--keepers-muted)]">
            {parts.join(" · ")}
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      cell: (m) => {
        const codes = (m.roles || []).map((r) => r.code);
        const removable = codes.filter((c) =>
          assignable.includes(c as RoleCode),
        ) as RoleCode[];
        return (
          <RowActions
            actions={[
              {
                label: "View profile",
                onClick: () => setMemberDrawerId(m.id),
              },
              {
                label: "Add role",
                onClick: () => openAssign(m),
                hidden: assignable.length === 0,
              },
              {
                label: "Remove role",
                onClick: () => {
                  const preferred =
                    (teamFilter !== "all" &&
                      removable.includes(teamFilter as RoleCode) &&
                      (teamFilter as RoleCode)) ||
                    removable[0];
                  if (!preferred) {
                    toast.error("No removable roles on this member");
                    return;
                  }
                  openRemove(m, preferred);
                },
                tone: "danger",
                hidden: removable.length === 0,
              },
              {
                label: "View permissions",
                onClick: () => setPermissionsMember(m),
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
        title="Role management"
        subtitle="Understand each role, compare access in plain language, and assign Marshall or Pre-Marshall privileges without digging through permission codes."
        actions={
          assignable.length ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openAssign(null, "marshall")}
            >
              Assign role
            </button>
          ) : null
        }
      />

      {rolesQuery.error ? <ErrorBlock message={rolesQuery.error} /> : null}
      {rolesQuery.loading && !rolesQuery.data ? <TableSkeleton rows={3} cols={3} /> : null}

      {rolesQuery.data ? (
        <>
          <RoleOverview
            roles={rolesQuery.data.roles}
            uniqueMembers={rolesQuery.data.uniqueMembers}
            onViewDetails={setDetailRole}
          />

          <PermissionsMatrix
            permissionsByRole={permissionsByRole}
            canToggleTechnical={isSuperAdmin}
          />
        </>
      ) : null}

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display m-0 text-2xl">Team by role</h2>
            <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
              Search and filter members, then manage roles from the drawer.
            </p>
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={teamQuery.data?.items || []}
          loading={teamQuery.loading}
          refreshing={teamQuery.refreshing || rolesQuery.refreshing}
          error={teamQuery.error}
          emptyTitle="No members found"
          emptyDescription="Try another role filter or search term."
          page={page}
          limit={limit}
          total={teamQuery.data?.pagination.total}
          onPageChange={setPage}
          onRowClick={(m) => setMemberDrawerId(m.id)}
          toolbar={
            <FilterBar>
              <SearchInput
                value={teamQ}
                onChange={(v) => {
                  setTeamQ(v);
                  setPage(1);
                }}
                placeholder="Search team…"
                className="max-w-sm min-w-[14rem] flex-1"
              />
              <select
                className="admin-select"
                value={teamFilter}
                onChange={(e) => {
                  setTeamFilter(e.target.value as TeamFilter);
                  setPage(1);
                }}
                aria-label="Filter by role"
              >
                <option value="all">All roles</option>
                {ROLE_ORDER.map((code) => (
                  <option key={code} value={code}>
                    {ROLE_META[code].name}
                  </option>
                ))}
              </select>
            </FilterBar>
          }
        />
      </section>

      <RoleDetailDrawer
        roleCode={detailRole}
        open={Boolean(detailRole)}
        onClose={() => setDetailRole(null)}
        memberCount={
          detailRole
            ? rolesQuery.data?.memberCountByRole?.[detailRole] ??
              rolesQuery.data?.roles.find((r) => r.code === detailRole)?.memberCount ??
              0
            : 0
        }
        permissionsByRole={permissionsByRole}
        onOpenMember={(id) => {
          setDetailRole(null);
          setMemberDrawerId(id);
        }}
      />

      <AssignRoleDrawer
        key={`${assignOpen}-${assignMember?.id || "new"}-${assignMode}-${assignRoleCode || ""}`}
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        actorRoles={roles}
        initialMember={assignMember}
        initialRole={assignRoleCode}
        mode={assignMode}
        onCompleted={async () => {
          toast.success(
            assignMode === "remove" ? "Role removed" : "Role assigned",
          );
          await refreshRoleViews();
        }}
      />

      <MemberDrawer
        memberId={memberDrawerId}
        open={Boolean(memberDrawerId)}
        onClose={() => setMemberDrawerId(null)}
        onUpdated={() => {
          void refreshRoleViews();
        }}
        onRemoved={() => {
          setMemberDrawerId(null);
          void refreshRoleViews();
        }}
      />

      <MemberPermissionsDrawer
        member={permissionsMember}
        open={Boolean(permissionsMember)}
        permissionsByRole={permissionsByRole}
        onClose={() => setPermissionsMember(null)}
        onOpenProfile={() => {
          if (permissionsMember) setMemberDrawerId(permissionsMember.id);
          setPermissionsMember(null);
        }}
      />
    </div>
  );
}
