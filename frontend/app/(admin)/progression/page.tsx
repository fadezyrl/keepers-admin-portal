"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, buildQuery } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterProgressionMutation } from "@/lib/invalidate";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useToast } from "@/lib/toast";
import type {
  ProgressionDashboard,
  ProgressionMemberRow,
  RolePromotionRequest,
  UpgradeRequest,
} from "@/lib/types";
import { displayName, formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Drawer } from "@/components/ui/Drawer";
import { DrawerSkeleton } from "@/components/ui/Skeleton";

type MemberProgressionDetail = {
  member?: {
    id?: string;
    name?: string;
    firstName?: string;
    lastName?: string;
  };
  progression?: {
    currentLevel?: {
      name?: string;
      displayName?: string;
      rank?: number;
      description?: string;
    } | null;
    nextLevel?: { name?: string; displayName?: string } | null;
    upgradeStatus?: string;
    upgradeHistory?: Array<{
      id: string;
      status: string;
      fromLevel?: string | null;
      toLevel: string;
      recommendedBy?: string;
      decisionNotes?: string | null;
      createdAt: string;
    }>;
    membershipHistory?: Array<{
      id: string;
      fromLevel?: string | null;
      toLevel: string;
      reason?: string | null;
      createdAt: string;
    }>;
  };
  pendingUpgradeRequests?: Array<{
    id: string;
    fromLevel?: string;
    toLevel?: string;
  }>;
  rolePromotionRequests?: Array<{
    id: string;
    status: string;
    currentRole?: string;
    requestedRole?: string;
  }>;
};
const RANK_FILTERS = [
  { value: "", label: "All ranks" },
  { value: "junior", label: "Junior" },
  { value: "intermediate", label: "Intermediate" },
  { value: "intermediate_plus", label: "Intermediate+" },
  { value: "advanced", label: "Advanced" },
  { value: "advanced_plus", label: "Advanced+" },
  { value: "pre_marshall", label: "Pre-Marshall" },
  { value: "marshall", label: "Marshall" },
];

const ROLE_FILTERS = [
  { value: "", label: "All club roles" },
  { value: "member", label: "Member" },
  { value: "pre_marshall", label: "Pre-Marshall" },
  { value: "marshall", label: "Marshall" },
  { value: "admin", label: "Admin" },
];

type MemberListResponse = {
  items: ProgressionMemberRow[];
  page: number;
  limit: number;
  total: number;
};

export default function ProgressionPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [rankGroup, setRankGroup] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQ = useDebouncedValue(q, 300);

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [activeUpgrade, setActiveUpgrade] = useState<UpgradeRequest | null>(null);
  const [activeRolePromo, setActiveRolePromo] =
    useState<RolePromotionRequest | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const listParams = useMemo(
    () => ({
      q: debouncedQ.trim() || undefined,
      rankGroup: rankGroup || undefined,
      role: role || undefined,
      page,
      limit: 25,
    }),
    [debouncedQ, rankGroup, role, page],
  );

  const dashboard = useAdminQuery(
    queryKeys.progression.dashboard(),
    (signal) => api.get<ProgressionDashboard>("/progression/dashboard", { signal }),
    { staleTime: stale.operational },
  );

  const members = useAdminQuery(
    queryKeys.progression.members(listParams),
    (signal) =>
      api.get<MemberListResponse>(
        `/progression/members${buildQuery(listParams)}`,
        { signal },
      ),
    { staleTime: stale.list },
  );

  const upgrades = useAdminQuery(
    queryKeys.progression.upgrades("pending"),
    (signal) =>
      api.get<UpgradeRequest[]>("/progression/upgrades?status=pending", { signal }),
    { staleTime: stale.operational },
  );

  const rolePromos = useAdminQuery(
    queryKeys.progression.rolePromotions("pending"),
    (signal) =>
      api.get<RolePromotionRequest[]>(
        "/progression/role-promotions?status=pending",
        { signal },
      ),
    { staleTime: stale.operational },
  );

  const memberDetail = useAdminQuery(
    queryKeys.progression.member(selectedMemberId || "none"),
    (signal) =>
      api.get<MemberProgressionDetail>(
        `/progression/members/${selectedMemberId}`,
        { signal },
      ),
    {
      staleTime: stale.operational,
      enabled: Boolean(selectedMemberId),
    },
  );

  const closeMemberDetail = useCallback(() => {
    setSelectedMemberId(null);
  }, []);

  // keepPreviousData can briefly show the prior member — only render matching data.
  const detailForSelection =
    selectedMemberId &&
    memberDetail.data?.member?.id &&
    memberDetail.data.member.id === selectedMemberId
      ? memberDetail.data
      : null;
  const detailLoading =
    Boolean(selectedMemberId) && !detailForSelection && !memberDetail.error;
  const detailProgression = detailForSelection?.progression || null;

  async function reviewUpgrade(decision: "approved" | "rejected") {
    if (!activeUpgrade) return;
    setBusy(true);
    try {
      await api.post(`/progression/upgrades/${activeUpgrade.id}/review`, {
        decision,
        decisionNotes: notes.trim() || undefined,
      });
      toast.success(
        decision === "approved" ? "Driving level promoted" : "Upgrade rejected",
      );
      setActiveUpgrade(null);
      setNotes("");
      await afterProgressionMutation(queryClient);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRolePromo(decision: "approved" | "rejected") {
    if (!activeRolePromo) return;
    setBusy(true);
    try {
      await api.post(`/progression/role-promotions/${activeRolePromo.id}/review`, {
        decision,
        reviewNotes: notes.trim() || undefined,
      });
      toast.success(
        decision === "approved"
          ? "Club role promotion approved"
          : "Club role promotion rejected",
      );
      setActiveRolePromo(null);
      setNotes("");
      await afterProgressionMutation(queryClient);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  const dash = dashboard.data;
  const memberItems = members.data?.items || [];
  const totalPages = Math.max(
    1,
    Math.ceil((members.data?.total || 0) / (members.data?.limit || 25)),
  );

  return (
    <div>
      <PageHeader
        title="Driver Progression"
        subtitle="21 driving levels across 7 ranks — separate from club roles. Marshall recommends; Admin approves."
      />

      {dash ? (
        <div className="mb-8 grid gap-px bg-[var(--keepers-line)] sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              label: "Pending level upgrades",
              value: dash.pendingUpgradeRequests,
            },
            {
              label: "Pre-Marshall role requests",
              value: dash.pendingPreMarshallRolePromotions,
            },
            {
              label: "Marshall role requests",
              value: dash.pendingMarshallRolePromotions,
            },
            {
              label: "Ranks in use",
              value: dash.membersByRank.filter((r) => r.count > 0).length,
            },
          ].map((s) => (
            <div key={s.label} className="bg-[var(--keepers-white)] p-5">
              <p className="text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                {s.label}
              </p>
              <p className="stat-value mt-3">{s.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {dash?.membersByRank?.length ? (
        <section className="panel mb-8">
          <div className="border-b border-[var(--keepers-line)] px-5 py-4">
            <h2 className="font-display m-0 text-2xl">Members by rank</h2>
          </div>
          <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
            {dash.membersByRank.map((r) => (
              <button
                key={r.code}
                type="button"
                className="border-b border-[var(--keepers-line)] px-5 py-4 text-left hover:bg-[var(--keepers-cream)]/60 sm:border-r"
                onClick={() => {
                  setRankGroup(r.code);
                  setPage(1);
                }}
              >
                <p className="m-0 text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                  {r.label}
                </p>
                <p className="mt-2 mb-0 text-xl font-medium">{r.count}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mb-10 grid gap-8 lg:grid-cols-2">
        <section className="panel">
          <div className="border-b border-[var(--keepers-line)] px-5 py-4">
            <h2 className="font-display m-0 text-2xl">Pending level promotions</h2>
            <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
              Marshall recommendations awaiting Admin decision
            </p>
          </div>
          {(upgrades.data || []).length === 0 ? (
            <p className="px-5 py-8 text-sm text-[var(--keepers-muted)]">
              No pending driving-level upgrades.
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-[var(--keepers-line)] p-0">
              {(upgrades.data || []).map((u) => (
                <li key={u.id} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="m-0 font-medium">
                      {displayName(u.member_first_name, u.member_last_name)}
                    </p>
                    <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                      {u.from_level_name || "—"} → {u.to_level_name}
                      {u.trip_title ? ` · ${u.trip_title}` : ""}
                    </p>
                    <p className="mt-1 mb-0 text-xs text-[var(--keepers-muted)]">
                      Recommended by{" "}
                      {displayName(u.recommender_first_name, u.recommender_last_name)} ·{" "}
                      {formatDateTime(u.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary shrink-0"
                    onClick={() => {
                      setActiveUpgrade(u);
                      setActiveRolePromo(null);
                      setNotes("");
                    }}
                  >
                    Review
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="border-b border-[var(--keepers-line)] px-5 py-4">
            <h2 className="font-display m-0 text-2xl">Club role promotions</h2>
            <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
              Separate from driving levels — Pre-Marshall / Marshall permissions
            </p>
          </div>
          {(rolePromos.data || []).length === 0 ? (
            <p className="px-5 py-8 text-sm text-[var(--keepers-muted)]">
              No pending club-role promotions.
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-[var(--keepers-line)] p-0">
              {(rolePromos.data || []).map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <p className="m-0 font-medium">
                      {displayName(r.first_name, r.last_name)}
                    </p>
                    <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                      {r.current_role_code} → {r.requested_role_code}
                      {r.trigger_level_name ? ` · triggered by ${r.trigger_level_name}` : ""}
                    </p>
                    <p className="mt-1 mb-0 text-xs text-[var(--keepers-muted)]">
                      {formatDateTime(r.created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary shrink-0"
                    onClick={() => {
                      setActiveRolePromo(r);
                      setActiveUpgrade(null);
                      setNotes("");
                    }}
                  >
                    Review
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel mb-10">
        <div className="border-b border-[var(--keepers-line)] px-5 py-4">
          <h2 className="font-display m-0 text-2xl">Member progression</h2>
        </div>
        <div className="flex flex-wrap gap-3 border-b border-[var(--keepers-line)] px-5 py-4">
          <input
            className="input min-w-[200px] flex-1"
            placeholder="Search name or email"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <select
            className="input"
            value={rankGroup}
            onChange={(e) => {
              setRankGroup(e.target.value);
              setPage(1);
            }}
          >
            {RANK_FILTERS.map((f) => (
              <option key={f.value || "all"} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(1);
            }}
          >
            {ROLE_FILTERS.map((f) => (
              <option key={f.value || "all-roles"} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {members.loading && !members.data ? (
          <p className="px-5 py-8 text-sm text-[var(--keepers-muted)]">Loading members…</p>
        ) : members.error && !members.data ? (
          <p className="px-5 py-8 text-sm text-[var(--keepers-danger)]">{members.error}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Driving level</th>
                  <th>Club roles</th>
                  <th>Pending</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {memberItems.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <p className="m-0 font-medium">{m.name}</p>
                      <p className="mt-1 mb-0 text-xs text-[var(--keepers-muted)]">
                        {m.email}
                      </p>
                    </td>
                    <td>
                      <p className="m-0">{m.level?.displayName || m.level?.name || "—"}</p>
                      <p className="mt-1 mb-0 text-xs text-[var(--keepers-muted)]">
                        {m.level
                          ? `${m.level.rankGroupLabel || ""} · ${m.level.rank}/21`
                          : "No level"}
                      </p>
                    </td>
                    <td className="text-sm">
                      {(m.roles || []).map((r) => r.code).join(", ") || "—"}
                    </td>
                    <td className="text-sm">
                      {m.pendingUpgrades || m.pendingRolePromotions
                        ? `${m.pendingUpgrades} level / ${m.pendingRolePromotions} role`
                        : "—"}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setSelectedMemberId(m.id)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <p className="m-0 text-sm text-[var(--keepers-muted)]">
            {members.data?.total || 0} members
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {dash?.recentlyPromoted?.length ? (
        <section className="panel mb-10">
          <div className="border-b border-[var(--keepers-line)] px-5 py-4">
            <h2 className="font-display m-0 text-2xl">Recently promoted</h2>
          </div>
          <ul className="m-0 list-none divide-y divide-[var(--keepers-line)] p-0">
            {dash.recentlyPromoted.map((p) => (
              <li key={p.id} className="flex justify-between gap-4 px-5 py-3">
                <div>
                  <p className="m-0 font-medium">{p.memberName}</p>
                  <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                    {p.fromLevel || "—"} → {p.toLevel}
                  </p>
                </div>
                <p className="m-0 shrink-0 text-sm text-[var(--keepers-muted)]">
                  {formatDate(p.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Drawer
        open={Boolean(selectedMemberId)}
        onClose={closeMemberDetail}
        title={
          detailForSelection?.member?.name ||
          displayName(
            detailForSelection?.member?.firstName,
            detailForSelection?.member?.lastName,
            "Member",
          )
        }
        subtitle="Progression profile"
        wide
      >
        {detailLoading ? <DrawerSkeleton /> : null}
        {!detailLoading && memberDetail.error ? (
          <div className="space-y-4">
            <p className="m-0 text-sm text-[var(--keepers-danger)]">
              {memberDetail.error}
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void memberDetail.reload()}
            >
              Retry
            </button>
          </div>
        ) : null}
        {!detailLoading && !memberDetail.error && detailForSelection ? (
          <div className="space-y-6">
            <div>
              <p className="m-0 text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Current driving level
              </p>
              <p className="mt-2 mb-0 text-xl font-medium">
                {detailProgression?.currentLevel?.displayName ||
                  detailProgression?.currentLevel?.name ||
                  "—"}
              </p>
              <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                {detailProgression?.currentLevel?.rank
                  ? `Position ${detailProgression.currentLevel.rank} of 21`
                  : null}
                {detailProgression?.nextLevel
                  ? ` · Next: ${
                      detailProgression.nextLevel.displayName ||
                      detailProgression.nextLevel.name
                    }`
                  : " · Final level"}
              </p>
              {detailProgression?.currentLevel?.description ? (
                <p className="mt-2 mb-0 text-sm text-[var(--keepers-muted)]">
                  {detailProgression.currentLevel.description}
                </p>
              ) : null}
            </div>

            <div>
              <p className="mb-2 text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Pending requests
              </p>
              {(detailForSelection.pendingUpgradeRequests || []).length === 0 &&
              (detailForSelection.rolePromotionRequests || []).filter(
                (r) => r.status === "pending",
              ).length === 0 ? (
                <p className="m-0 text-sm text-[var(--keepers-muted)]">None</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0 text-sm">
                  {(detailForSelection.pendingUpgradeRequests || []).map((u) => (
                    <li key={u.id}>
                      Level: {u.fromLevel || "—"} → {u.toLevel}
                    </li>
                  ))}
                  {(detailForSelection.rolePromotionRequests || [])
                    .filter((r) => r.status === "pending")
                    .map((r) => (
                      <li key={r.id}>
                        Club role: {r.currentRole} → {r.requestedRole}
                      </li>
                    ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Level history
              </p>
              <ul className="m-0 list-none space-y-2 p-0 text-sm">
                {(detailProgression?.membershipHistory || [])
                  .slice(0, 12)
                  .map((h) => (
                    <li key={h.id} className="text-[var(--keepers-muted)]">
                      <span className="text-[var(--keepers-ink)]">
                        {h.fromLevel || "—"} → {h.toLevel}
                      </span>
                      {" · "}
                      {formatDate(h.createdAt)}
                    </li>
                  ))}
                {(detailProgression?.membershipHistory || []).length === 0 ? (
                  <li className="text-[var(--keepers-muted)]">No history yet</li>
                ) : null}
              </ul>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(activeUpgrade || activeRolePromo)}
        onClose={() => {
          setActiveUpgrade(null);
          setActiveRolePromo(null);
        }}
        title={
          activeUpgrade ? "Review level promotion" : "Review club role promotion"
        }
        footer={
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                activeUpgrade
                  ? void reviewUpgrade("approved")
                  : void reviewRolePromo("approved")
              }
            >
              Approve
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() =>
                activeUpgrade
                  ? void reviewUpgrade("rejected")
                  : void reviewRolePromo("rejected")
              }
            >
              Reject
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                setActiveUpgrade(null);
                setActiveRolePromo(null);
              }}
            >
              Cancel
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {activeUpgrade ? (
            <>
              <p className="m-0">
                <strong>
                  {displayName(
                    activeUpgrade.member_first_name,
                    activeUpgrade.member_last_name,
                  )}
                </strong>
              </p>
              <p className="m-0 text-sm text-[var(--keepers-muted)]">
                Current / from: {activeUpgrade.from_level_name || "—"}
              </p>
              <p className="m-0 text-sm">
                Proposed next: <strong>{activeUpgrade.to_level_name}</strong>
              </p>
              {activeUpgrade.recommendation_notes ? (
                <p className="m-0 text-sm text-[var(--keepers-muted)]">
                  Marshall notes: {activeUpgrade.recommendation_notes}
                </p>
              ) : null}
            </>
          ) : null}
          {activeRolePromo ? (
            <>
              <p className="m-0">
                <strong>
                  {displayName(activeRolePromo.first_name, activeRolePromo.last_name)}
                </strong>
              </p>
              <p className="m-0 text-sm text-[var(--keepers-muted)]">
                Current club role: {activeRolePromo.current_role_code}
              </p>
              <p className="m-0 text-sm">
                Requested club role:{" "}
                <strong>{activeRolePromo.requested_role_code}</strong>
              </p>
              <p className="m-0 text-sm text-[var(--keepers-muted)]">
                This does not change driving level. Admin / Super Admin roles are never
                downgraded.
              </p>
            </>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-sm text-[var(--keepers-muted)]">
              Assessment notes
            </span>
            <textarea
              className="input min-h-[100px] w-full"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes for the audit record"
            />
          </label>
        </div>
      </Drawer>
    </div>
  );
}
