"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterRatingMutation } from "@/lib/invalidate";
import { useToast } from "@/lib/toast";
import type { RatingRow, UpgradeRequest } from "@/lib/types";
import { displayName, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { RowActions } from "@/components/ui/RowActions";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { MemberDrawer } from "@/components/admin/MemberDrawer";
import { TripQuickDrawer } from "@/components/admin/TripDrawer";

export default function RatingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const ratings = useAdminQuery(
    queryKeys.ratings.list(),
    (signal) => api.get<RatingRow[]>("/ratings", { signal }),
    { staleTime: stale.list },
  );
  const upgrades = useAdminQuery(
    queryKeys.ratings.upgrades("pending"),
    (signal) =>
      api.get<UpgradeRequest[]>("/ratings/upgrades?status=pending", { signal }),
    { staleTime: stale.operational },
  );
  const [activeUpgrade, setActiveUpgrade] = useState<UpgradeRequest | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [memberId, setMemberId] = useState<string | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [ratingDetail, setRatingDetail] = useState<RatingRow | null>(null);

  async function review(id: string, decision: "approved" | "rejected", decisionNotes?: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    setBusy(true);
    try {
      await api.post(`/ratings/upgrades/${id}/review`, {
        decision,
        decisionNotes: decisionNotes || undefined,
      });
      upgrades.setData((prev) => (prev || []).filter((u) => u.id !== id));
      if (activeUpgrade?.id === id) setActiveUpgrade(null);
      await afterRatingMutation(queryClient);
      toast.success(`Upgrade request ${decision}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Review failed");
    } finally {
      setBusy(false);
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const upgradeColumns: DataColumn<UpgradeRequest>[] = [
    {
      key: "member",
      header: "Member",
      cell: (u) => (
        <div>
          <div className="font-medium">
            {displayName(u.member_first_name, u.member_last_name)}
          </div>
          <div className="text-sm text-[var(--keepers-muted)]">@{u.member_username || "—"}</div>
        </div>
      ),
    },
    {
      key: "path",
      header: "Upgrade",
      cell: (u) => (
        <span>
          {u.from_level_name || "—"} → {u.to_level_name}
        </span>
      ),
    },
    {
      key: "trip",
      header: "Trip",
      cell: (u) => u.trip_title || "—",
    },
    {
      key: "when",
      header: "Requested",
      cell: (u) => formatDateTime(u.created_at),
    },
    {
      key: "status",
      header: "Status",
      cell: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (u) => (
        <RowActions
          actions={[
            {
              label: "Review",
              onClick: () => {
                setNotes(u.recommendation_notes || "");
                setActiveUpgrade(u);
              },
            },
            {
              label: "Approve",
              onClick: () => void review(u.id, "approved"),
            },
            {
              label: "Reject",
              onClick: () => void review(u.id, "rejected"),
              tone: "danger",
            },
          ]}
        />
      ),
    },
  ];

  const ratingColumns: DataColumn<RatingRow>[] = [
    {
      key: "member",
      header: "Member",
      cell: (r) => displayName(r.member_first_name, r.member_last_name),
    },
    {
      key: "trip",
      header: "Trip",
      cell: (r) => r.trip_title || r.trip_id,
    },
    {
      key: "score",
      header: "Overall",
      cell: (r) => Number(r.overall_score).toFixed(1),
    },
    {
      key: "rater",
      header: "Rated by",
      cell: (r) => displayName(r.rater_first_name, r.rater_last_name),
    },
    {
      key: "when",
      header: "When",
      cell: (r) => formatDateTime(r.created_at),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (r) => (
        <RowActions
          actions={[
            { label: "Details", onClick: () => setRatingDetail(r) },
            {
              label: "Member",
              onClick: () => setMemberId(r.member_id),
            },
            {
              label: "Trip",
              onClick: () => setTripId(r.trip_id),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Ratings"
        subtitle="Review upgrade recommendations and recent trip ratings."
      />

      <section className="mb-10">
        <h2 className="font-display mb-4 text-2xl">Pending upgrades</h2>
        <DataTable
          columns={upgradeColumns}
          rows={upgrades.data || []}
          loading={upgrades.loading}
          refreshing={upgrades.refreshing}
          error={upgrades.error}
          emptyTitle="No pending upgrades"
          emptyDescription="Marshall recommendations awaiting review will show here."
          onRowClick={(u) => {
            setNotes(u.recommendation_notes || "");
            setActiveUpgrade(u);
          }}
          busyIds={busyIds}
        />
      </section>

      <section>
        <h2 className="font-display mb-4 text-2xl">Recent ratings</h2>
        <DataTable
          columns={ratingColumns}
          rows={ratings.data || []}
          loading={ratings.loading}
          refreshing={ratings.refreshing}
          error={ratings.error}
          emptyTitle="No ratings recorded"
          emptyDescription="Marshall trip ratings will appear once submitted."
          onRowClick={(r) => setRatingDetail(r)}
        />
      </section>

      <Drawer
        open={Boolean(activeUpgrade)}
        onClose={() => setActiveUpgrade(null)}
        title={
          activeUpgrade
            ? displayName(activeUpgrade.member_first_name, activeUpgrade.member_last_name)
            : "Upgrade request"
        }
        subtitle={
          activeUpgrade
            ? `${activeUpgrade.from_level_name || "—"} → ${activeUpgrade.to_level_name}`
            : undefined
        }
        footer={
          activeUpgrade ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void review(activeUpgrade.id, "approved", notes)}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void review(activeUpgrade.id, "rejected", notes)}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setMemberId(activeUpgrade.member_id)}
              >
                View member
              </button>
            </>
          ) : null
        }
      >
        {activeUpgrade ? (
          <div className="space-y-5">
            <dl className="detail-grid">
              <div>
                <dt>Recommended by</dt>
                <dd>
                  {displayName(
                    activeUpgrade.recommender_first_name,
                    activeUpgrade.recommender_last_name,
                  )}
                </dd>
              </div>
              <div>
                <dt>Requested</dt>
                <dd>{formatDateTime(activeUpgrade.created_at)}</dd>
              </div>
              <div>
                <dt>Trip</dt>
                <dd>{activeUpgrade.trip_title || "—"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={activeUpgrade.status} />
                </dd>
              </div>
            </dl>
            {activeUpgrade.recommendation_notes ? (
              <p className="m-0 text-sm leading-relaxed">{activeUpgrade.recommendation_notes}</p>
            ) : null}
            <FormField label="Decision notes">
              <textarea
                className="admin-textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes for the decision"
              />
            </FormField>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={Boolean(ratingDetail)}
        onClose={() => setRatingDetail(null)}
        title="Rating details"
        subtitle={ratingDetail?.trip_title || undefined}
      >
        {ratingDetail ? (
          <div className="space-y-4">
            <dl className="detail-grid">
              <div>
                <dt>Member</dt>
                <dd>
                  {displayName(ratingDetail.member_first_name, ratingDetail.member_last_name)}
                </dd>
              </div>
              <div>
                <dt>Overall</dt>
                <dd>{Number(ratingDetail.overall_score).toFixed(1)}</dd>
              </div>
              <div>
                <dt>Rated by</dt>
                <dd>
                  {displayName(ratingDetail.rater_first_name, ratingDetail.rater_last_name)}
                </dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>{formatDateTime(ratingDetail.created_at)}</dd>
              </div>
            </dl>
            {ratingDetail.public_notes ? (
              <p className="m-0 text-sm">{ratingDetail.public_notes}</p>
            ) : null}
            {(ratingDetail.scores || []).length > 0 ? (
              <ul className="m-0 list-none space-y-2 p-0">
                {ratingDetail.scores!.map((s) => (
                  <li key={s.criterionId} className="flex justify-between text-sm">
                    <span>{s.name}</span>
                    <span>{s.score}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <MemberDrawer
        memberId={memberId}
        open={Boolean(memberId)}
        onClose={() => setMemberId(null)}
      />
      <TripQuickDrawer
        tripId={tripId}
        open={Boolean(tripId)}
        onClose={() => setTripId(null)}
      />
    </div>
  );
}
