"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterMemberMutation } from "@/lib/invalidate";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Member, MemberDetail } from "@/lib/types";
import { useToast } from "@/lib/toast";
import { Drawer } from "@/components/ui/Drawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DrawerSkeleton } from "@/components/ui/Skeleton";
import { FormField } from "@/components/ui/FormField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PermanentDeleteMemberDialog } from "@/components/admin/PermanentDeleteMemberDialog";

const QUICK_ROLES = [
  { code: "member", label: "Member" },
  { code: "pre_marshall", label: "Pre-Marshall" },
  { code: "marshall", label: "Marshall" },
] as const;

function roleLabel(code: string) {
  return QUICK_ROLES.find((r) => r.code === code)?.label || code;
}

export function MemberDrawer({
  memberId,
  open,
  onClose,
  onUpdated,
  onRemoved,
}: {
  memberId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: (member: Member) => void;
  onRemoved?: (memberId: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [roleBusy, setRoleBusy] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const active = open && Boolean(memberId);
  const query = useAdminQuery(
    queryKeys.members.detail(memberId ?? ""),
    (signal) => api.get<MemberDetail>(`/members/${memberId}`, { signal }),
    { staleTime: stale.operational, enabled: active },
  );
  const setData = query.setData;

  const data = active && query.data?.id === memberId ? query.data : null;
  const error = active ? query.error : null;
  const loading = active && !data && !error;
  const roleCodes = new Set((data?.roles || []).map((r) => r.code));
  const isDeleted = data?.status === "deleted";

  function emitUpdated(next: MemberDetail) {
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
  }

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
      emitUpdated(next);
      await afterMemberMutation(queryClient);
      toast.success(
        status === "suspended"
          ? "Account deactivated"
          : status === "approved" && data.status === "suspended"
            ? "Account reactivated"
            : `Member marked ${status}`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update status");
    } finally {
      setBusy(false);
      setConfirmDeactivate(false);
    }
  }

  async function assignRole(code: string) {
    if (!memberId || !data) return;
    setRoleBusy(true);
    try {
      const next = await api.post<MemberDetail>(`/members/${memberId}/roles`, { role: code });
      setData(next);
      emitUpdated(next);
      await afterMemberMutation(queryClient);
      toast.success(`Assigned ${roleLabel(code)}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to assign role");
    } finally {
      setRoleBusy(false);
    }
  }

  async function removeRole(code: string) {
    if (!memberId || !data) return;
    setRoleBusy(true);
    try {
      const next = await api.delete<MemberDetail>(`/members/${memberId}/roles/${code}`);
      setData(next);
      emitUpdated(next);
      await afterMemberMutation(queryClient);
      toast.success(`Removed ${roleLabel(code)}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove role");
    } finally {
      setRoleBusy(false);
    }
  }

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={data?.name || "Member"}
        subtitle={data ? `@${data.username} · ${data.email}` : undefined}
        wide
        footer={
          data && !isDeleted ? (
            <>
              {data.status !== "approved" && data.status !== "suspended" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => void setStatus("approved")}
                >
                  Approve
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
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => setConfirmDeactivate(true)}
                >
                  Deactivate
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
                    ? `${data.vehicle.manufacturer || ""} ${data.vehicle.model || ""}`.trim() ||
                      "—"
                    : "—"}
                </dd>
              </div>
            </dl>

            <div>
              <p className="form-label">Roles</p>
              <div className="mb-3 flex flex-wrap gap-2">
                {(data.roles || []).length === 0 ? (
                  <span className="text-sm text-[var(--keepers-muted)]">No roles assigned</span>
                ) : (
                  data.roles!.map((r) => (
                    <span key={r.code} className="badge">
                      {r.name || r.code}
                      {!isDeleted && !["admin", "super_admin"].includes(r.code) ? (
                        <button
                          type="button"
                          className="ml-2 text-[var(--keepers-muted)] hover:text-[var(--keepers-danger)]"
                          disabled={roleBusy}
                          onClick={() => void removeRole(r.code)}
                          aria-label={`Remove ${r.code}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))
                )}
              </div>
              {!isDeleted ? (
                <div className="flex flex-wrap gap-2">
                  {QUICK_ROLES.map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={roleBusy || roleCodes.has(r.code)}
                      onClick={() => void assignRole(r.code)}
                    >
                      {roleCodes.has(r.code) ? `Has ${r.label}` : `Make ${r.label}`}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {data.bio ? (
              <p className="m-0 text-sm leading-relaxed text-[var(--keepers-ink)]">{data.bio}</p>
            ) : null}

            {!isDeleted ? (
              <FormField label="Reason (optional)">
                <textarea
                  className="admin-textarea"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Shown in audit / notifications where applicable"
                />
              </FormField>
            ) : null}

            <div>
              <p className="form-label">Recent trips</p>
              {(data.completedTripHistory || []).length === 0 ? (
                <p className="m-0 text-sm text-[var(--keepers-muted)]">
                  No completed attendance yet.
                </p>
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

            {!isDeleted ? (
              <div className="border-t border-[var(--keepers-line)] pt-5">
                <p className="form-label">Danger zone</p>
                <p className="m-0 mb-3 text-sm text-[var(--keepers-muted)]">
                  Deactivate blocks login and is reversible. Permanent deletion removes Auth access
                  and scrubs personal data — it cannot be undone.
                </p>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => setDeleteOpen(true)}
                >
                  Permanently delete account
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={confirmDeactivate}
        title="Deactivate this account?"
        description="The member will be signed out and blocked from the app and protected APIs. Profile, trips, and ratings are preserved. You can reactivate later."
        confirmLabel="Deactivate"
        tone="danger"
        busy={busy}
        onClose={() => (busy ? undefined : setConfirmDeactivate(false))}
        onConfirm={() => void setStatus("suspended")}
      />

      <PermanentDeleteMemberDialog
        open={deleteOpen}
        memberId={memberId}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          if (memberId) onRemoved?.(memberId);
          void afterMemberMutation(queryClient);
          void queryClient.invalidateQueries({ queryKey: queryKeys.trips.all });
          onClose();
        }}
      />
    </>
  );
}
