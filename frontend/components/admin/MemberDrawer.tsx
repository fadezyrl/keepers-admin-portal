"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Member, MemberDetail } from "@/lib/types";
import { useToast } from "@/lib/toast";
import { Drawer } from "@/components/ui/Drawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DrawerSkeleton } from "@/components/ui/Skeleton";
import { FormField } from "@/components/ui/FormField";

export function MemberDrawer({
  memberId,
  open,
  onClose,
  onUpdated,
}: {
  memberId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: (member: Member) => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !memberId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .get<MemberDetail>(`/members/${memberId}`)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load member");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, memberId]);

  async function setStatus(status: string) {
    if (!memberId || !data) return;
    setBusy(true);
    try {
      await api.post(`/members/${memberId}/status`, {
        status,
        reason: reason || undefined,
      });
      const next = { ...data, status };
      setData(next);
      setReason("");
      onUpdated?.({
        id: next.id,
        firstName: next.firstName,
        lastName: next.lastName,
        name: next.name,
        username: next.username,
        email: next.email,
        phone: next.phone,
        nationality: next.nationality,
        avatar: next.avatar,
        status: next.status,
        completedTrips: next.completedTrips,
        membership: next.membership,
        membershipCode: next.membershipCode,
        roles: next.roles,
        vehicle: next.vehicle,
        createdAt: next.createdAt,
      });
      toast.success(`Member marked ${status}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={data?.name || "Member"}
      subtitle={data ? `@${data.username} · ${data.email}` : undefined}
      wide
      footer={
        data ? (
          <>
            {data.status !== "approved" ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void setStatus("approved")}
              >
                Approve
              </button>
            ) : null}
            {data.status !== "rejected" ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void setStatus("rejected")}
              >
                Reject
              </button>
            ) : null}
            {data.status === "suspended" ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void setStatus("approved")}
              >
                Reactivate
              </button>
            ) : data.status === "approved" ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void setStatus("suspended")}
              >
                Suspend
              </button>
            ) : null}
            <Link href={`/members/${memberId}`} className="btn btn-ghost" onClick={onClose}>
              Full profile
            </Link>
          </>
        ) : null
      }
    >
      {loading ? <DrawerSkeleton /> : null}
      {error ? <p className="m-0 text-sm text-[var(--keepers-danger)]">{error}</p> : null}
      {!loading && !error && data ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={data.status} />
            <span className="text-sm text-[var(--keepers-muted)]">
              {data.membership || "No membership level"}
            </span>
          </div>

          <dl className="detail-grid">
            <div>
              <dt>Phone</dt>
              <dd>{data.phone || "—"}</dd>
            </div>
            <div>
              <dt>Nationality</dt>
              <dd>{data.nationality || "—"}</dd>
            </div>
            <div>
              <dt>Completed trips</dt>
              <dd>{data.completedTrips ?? 0}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{formatDate(data.createdAt)}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>{formatDateTime(data.approvedAt)}</dd>
            </div>
            <div>
              <dt>Vehicle</dt>
              <dd>
                {data.vehicle
                  ? `${data.vehicle.manufacturer || ""} ${data.vehicle.model || ""}`.trim() || "—"
                  : "—"}
              </dd>
            </div>
          </dl>

          {(data.roles || []).length > 0 ? (
            <div>
              <p className="form-label">Roles</p>
              <div className="flex flex-wrap gap-2">
                {data.roles!.map((r) => (
                  <span key={r.code} className="badge">
                    {r.name || r.code}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {data.bio ? (
            <p className="m-0 text-sm leading-relaxed text-[var(--keepers-ink)]">{data.bio}</p>
          ) : null}

          <FormField label="Reason (optional)">
            <textarea
              className="admin-textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Shown in audit / notifications where applicable"
            />
          </FormField>

          <div>
            <p className="form-label">Recent trips</p>
            {(data.completedTripHistory || []).length === 0 ? (
              <p className="m-0 text-sm text-[var(--keepers-muted)]">No completed attendance yet.</p>
            ) : (
              <ul className="m-0 list-none space-y-2 p-0">
                {data.completedTripHistory!.slice(0, 6).map((t) => (
                  <li key={t.id} className="text-sm">
                    <Link href={`/trips/${t.id}`} className="hover:underline" onClick={onClose}>
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
        </div>
      ) : null}
    </Drawer>
  );
}
