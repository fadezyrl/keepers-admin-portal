"use client";

import { FormEvent, Suspense, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterMemberMutation } from "@/lib/invalidate";
import type { MemberDetail } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

function MemberDetailInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const { data, error, loading } = useAdminQuery(
    queryKeys.members.detail(id),
    (signal) => api.get<MemberDetail>(`/members/${id}`, { signal }),
    { staleTime: stale.operational },
  );
  const [reason, setReason] = useState("");
  const [role, setRole] = useState("marshall");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function setStatus(status: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/members/${id}/status`, { status, reason: reason || undefined });
      setMessage(`Status updated to ${status}`);
      setReason("");
      await afterMemberMutation(queryClient);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to update status");
    } finally {
      setBusy(false);
    }
  }

  async function assignRole(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/members/${id}/roles`, { role });
      setMessage(`Role “${role}” assigned`);
      await afterMemberMutation(queryClient);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to assign role");
    } finally {
      setBusy(false);
    }
  }

  async function removeRole(code: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api.delete(`/members/${id}/roles/${code}`);
      setMessage(`Role “${code}” removed`);
      await afterMemberMutation(queryClient);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to remove role");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <EmptyBlock title="Member not found" />;

  return (
    <div>
      <PageHeader
        title={data.name}
        subtitle={`@${data.username} · ${data.email}`}
        actions={
          <Link href="/members" className="btn btn-secondary">
            Back to members
          </Link>
        }
      />

      {message ? (
        <div className="mb-6">
          <Alert>{message}</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="panel p-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={data.status} />
            <span className="text-sm text-[var(--keepers-muted)]">
              {data.membership || "No membership level"}
            </span>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Phone
              </dt>
              <dd className="mt-1 m-0">{data.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Nationality
              </dt>
              <dd className="mt-1 m-0">{data.nationality || "—"}</dd>
            </div>
            <div>
              <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Completed trips
              </dt>
              <dd className="mt-1 m-0">{data.completedTrips ?? 0}</dd>
            </div>
            <div>
              <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Joined
              </dt>
              <dd className="mt-1 m-0">{formatDate(data.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Approved
              </dt>
              <dd className="mt-1 m-0">{formatDateTime(data.approvedAt)}</dd>
            </div>
            <div>
              <dt className="text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Vehicle
              </dt>
              <dd className="mt-1 m-0">
                {data.vehicle
                  ? `${data.vehicle.manufacturer || ""} ${data.vehicle.model || ""}`.trim() || "—"
                  : "—"}
              </dd>
            </div>
          </dl>

          {data.bio ? (
            <p className="mt-6 border-t border-[var(--keepers-line)] pt-5 text-sm leading-relaxed text-[var(--keepers-ink)]">
              {data.bio}
            </p>
          ) : null}

          <div className="mt-8">
            <h3 className="font-display m-0 text-xl">Trip history</h3>
            {(data.completedTripHistory || []).length === 0 ? (
              <p className="mt-3 text-sm text-[var(--keepers-muted)]">No completed attendance yet.</p>
            ) : (
              <ul className="mt-3 list-none space-y-2 p-0">
                {data.completedTripHistory!.map((t) => (
                  <li key={t.id} className="text-sm">
                    <Link href={`/trips/${t.id}`} className="hover:underline">
                      {t.title}
                    </Link>
                    <span className="text-[var(--keepers-muted)]">
                      {" "}
                      · {formatDate(t.trip_date)} · {t.destination}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="space-y-6">
          <section className="panel p-6">
            <h3 className="font-display m-0 text-xl">Membership status</h3>
            <label className="mt-4 block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Reason (optional)
              </span>
              <textarea
                className="admin-textarea"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Shown in audit / notifications where applicable"
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => setStatus("approved")}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setStatus("rejected")}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => setStatus("suspended")}
              >
                Suspend
              </button>
            </div>
          </section>

          <section className="panel p-6">
            <h3 className="font-display m-0 text-xl">Roles</h3>
            <ul className="mt-4 list-none space-y-2 p-0">
              {(data.roles || []).length === 0 ? (
                <li className="text-sm text-[var(--keepers-muted)]">No roles assigned.</li>
              ) : (
                data.roles!.map((r) => (
                  <li
                    key={r.code}
                    className="flex items-center justify-between gap-3 border-b border-[var(--keepers-line)] py-2 text-sm"
                  >
                    <span>{r.name || r.code}</span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => removeRole(r.code)}
                    >
                      Remove
                    </button>
                  </li>
                ))
              )}
            </ul>
            <form onSubmit={assignRole} className="mt-4 flex gap-2">
              <select
                className="admin-select"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="member">member</option>
                <option value="pre_marshall">pre_marshall</option>
                <option value="marshall">marshall</option>
                <option value="admin">admin</option>
                <option value="super_admin">super_admin</option>
              </select>
              <button type="submit" className="btn btn-secondary" disabled={busy}>
                Assign
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function MemberDetailPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <MemberDetailInner />
    </Suspense>
  );
}
