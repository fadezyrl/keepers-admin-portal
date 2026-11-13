"use client";

import { api, buildQuery } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import type { Member, Paginated } from "@/lib/types";
import {
  ROLE_META,
  allowedActivitiesForRole,
  restrictedActivitiesForRole,
  type RoleCode,
} from "@/lib/rolesCatalog";
import { Drawer } from "@/components/ui/Drawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DrawerSkeleton } from "@/components/ui/Skeleton";

export function RoleDetailDrawer({
  roleCode,
  open,
  onClose,
  memberCount,
  permissionsByRole,
  onOpenMember,
}: {
  roleCode: RoleCode | null;
  open: boolean;
  onClose: () => void;
  memberCount: number;
  permissionsByRole: Record<string, string[]>;
  onOpenMember: (id: string) => void;
}) {
  const active = open && Boolean(roleCode);
  const meta = roleCode ? ROLE_META[roleCode] : null;

  const membersQuery = useAdminQuery(
    queryKeys.members.list({ role: roleCode || "none", limit: 50, source: "role-detail" }),
    (signal) =>
      api.get<Paginated<Member>>(
        `/members${buildQuery({ role: roleCode!, limit: 50 })}`,
        { signal },
      ),
    { staleTime: stale.operational, enabled: active },
  );

  const allowed = roleCode
    ? allowedActivitiesForRole(roleCode, permissionsByRole)
    : [];
  const restricted = roleCode
    ? restrictedActivitiesForRole(roleCode, permissionsByRole)
    : [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={meta?.name || "Role"}
      subtitle={meta?.shortDescription}
      wide
    >
      {!meta ? null : membersQuery.loading && !membersQuery.data ? (
        <DrawerSkeleton />
      ) : (
        <div className="space-y-8">
          <section>
            <h3 className="font-display m-0 text-lg">Responsibilities</h3>
            <ul className="mt-3 mb-0 list-none space-y-2 p-0">
              {meta.responsibilities.map((item) => (
                <li
                  key={item}
                  className="border-l border-[var(--keepers-line-strong)] pl-3 text-sm"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 className="font-display m-0 text-lg">Allowed activities</h3>
              <ul className="mt-3 mb-0 list-none space-y-2 p-0">
                {allowed.map((item) => (
                  <li key={item} className="text-sm text-[var(--keepers-ink)]">
                    {item}
                  </li>
                ))}
                {allowed.length === 0 ? (
                  <li className="text-sm text-[var(--keepers-muted)]">None</li>
                ) : null}
              </ul>
            </div>
            <div>
              <h3 className="font-display m-0 text-lg">Restricted activities</h3>
              <ul className="mt-3 mb-0 list-none space-y-2 p-0">
                {restricted.slice(0, 10).map((item) => (
                  <li key={item} className="text-sm text-[var(--keepers-muted)]">
                    {item}
                  </li>
                ))}
                {meta.restrictedNotes.map((note) => (
                  <li key={note} className="text-sm text-[var(--keepers-muted)]">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="font-display m-0 text-lg">Assigned members</h3>
              <p className="m-0 text-sm text-[var(--keepers-muted)]">
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </p>
            </div>
            {membersQuery.error ? (
              <p className="text-sm text-[var(--keepers-danger)]">{membersQuery.error}</p>
            ) : null}
            <ul className="m-0 list-none divide-y divide-[var(--keepers-line)] border border-[var(--keepers-line)] p-0">
              {(membersQuery.data?.items || []).map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[var(--keepers-cream)]"
                    onClick={() => onOpenMember(m.id)}
                  >
                    <div>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-sm text-[var(--keepers-muted)]">
                        @{m.username}
                      </div>
                    </div>
                    <StatusBadge status={m.status} />
                  </button>
                </li>
              ))}
              {!membersQuery.loading && (membersQuery.data?.items || []).length === 0 ? (
                <li className="px-3 py-4 text-sm text-[var(--keepers-muted)]">
                  No members currently hold this role.
                </li>
              ) : null}
            </ul>
          </section>
        </div>
      )}
    </Drawer>
  );
}
