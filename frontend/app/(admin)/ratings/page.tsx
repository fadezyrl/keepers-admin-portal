"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { RatingRow, UpgradeRequest } from "@/lib/types";
import { displayName, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function RatingsPage() {
  const ratings = useAsync(() => api.get<RatingRow[]>("/ratings"), []);
  const upgrades = useAsync(
    () => api.get<UpgradeRequest[]>("/ratings/upgrades?status=pending"),
    [],
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function review(id: string, decision: "approved" | "rejected") {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/ratings/upgrades/${id}/review`, {
        decision,
        decisionNotes: notes[id] || undefined,
      });
      setMessage(`Upgrade request ${decision}`);
      await upgrades.reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Ratings"
        subtitle="Trip ratings and pending membership upgrade recommendations."
      />

      {message ? (
        <div className="mb-6">
          <Alert>{message}</Alert>
        </div>
      ) : null}

      <section className="mb-10">
        <h2 className="font-display mb-4 text-2xl">Pending upgrades</h2>
        {upgrades.loading ? <LoadingBlock /> : null}
        {upgrades.error ? <ErrorBlock message={upgrades.error} /> : null}
        {!upgrades.loading && !upgrades.error && (upgrades.data || []).length === 0 ? (
          <EmptyBlock
            title="No pending upgrades"
            description="Marshall recommendations awaiting review will show here."
          />
        ) : null}
        {!upgrades.loading && !upgrades.error && (upgrades.data || []).length > 0 ? (
          <div className="space-y-4">
            {upgrades.data!.map((u) => (
              <article key={u.id} className="panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="m-0 text-lg font-medium">
                      {displayName(u.member_first_name, u.member_last_name)}
                    </p>
                    <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                      {u.from_level_name || "—"} → {u.to_level_name}
                      {u.trip_title ? ` · ${u.trip_title}` : ""}
                    </p>
                    <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                      Recommended by{" "}
                      {displayName(u.recommender_first_name, u.recommender_last_name)} ·{" "}
                      {formatDateTime(u.created_at)}
                    </p>
                    {u.recommendation_notes ? (
                      <p className="mt-3 mb-0 text-sm">{u.recommendation_notes}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={u.status} />
                </div>
                <textarea
                  className="admin-textarea mt-4"
                  placeholder="Decision notes"
                  value={notes[u.id] || ""}
                  onChange={(e) => setNotes({ ...notes, [u.id]: e.target.value })}
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => review(u.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => review(u.id, "rejected")}
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="font-display mb-4 text-2xl">Recent ratings</h2>
        {ratings.loading ? <LoadingBlock /> : null}
        {ratings.error ? <ErrorBlock message={ratings.error} /> : null}
        {!ratings.loading && !ratings.error && (ratings.data || []).length === 0 ? (
          <EmptyBlock
            title="No ratings recorded"
            description="Marshall trip ratings will appear once submitted."
          />
        ) : null}
        {!ratings.loading && !ratings.error && (ratings.data || []).length > 0 ? (
          <div className="panel overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Trip</th>
                  <th>Overall</th>
                  <th>Rated by</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {ratings.data!.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {displayName(r.member_first_name, r.member_last_name)}
                    </td>
                    <td>{r.trip_title || r.trip_id}</td>
                    <td>{Number(r.overall_score).toFixed(1)}</td>
                    <td>{displayName(r.rater_first_name, r.rater_last_name)}</td>
                    <td>{formatDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
