"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { FormField } from "@/components/ui/FormField";

type ImpactTrip = {
  id: string;
  title: string;
  date: string;
  status: string;
  activeRegistrations: number;
  relation: string;
};

type EligibleOrganizer = {
  id: string;
  name: string;
  username: string;
  roles: string[];
};

export type DeletionImpact = {
  member: {
    id: string;
    name: string;
    email: string;
    username: string;
    status: string;
    roles: Array<{ code: string; name?: string }>;
  };
  ownedTrips: ImpactTrip[];
  preMarshallAssignments: Array<{
    id: string;
    tripId: string;
    title: string;
    date: string;
    status: string;
  }>;
  activeRegistrations: number;
  pendingUpgrades: number;
  eligibleOrganizers: EligibleOrganizer[];
  retentionNotes: string[];
};

type TripActionChoice = {
  tripId: string;
  action: "reassign" | "cancel" | "retain_admin";
  newOrganizerId?: string;
};

export function PermanentDeleteMemberDialog({
  open,
  memberId,
  onClose,
  onDeleted,
}: {
  open: boolean;
  memberId: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const titleId = useId();
  const toast = useToast();
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [tripActions, setTripActions] = useState<Record<string, TripActionChoice>>({});

  useEffect(() => {
    if (!open || !memberId) {
      setImpact(null);
      setConfirmEmail("");
      setTripActions({});
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .get<DeletionImpact>(`/members/${memberId}/deletion-impact`)
      .then((data) => {
        if (cancelled) return;
        setImpact(data);
        const initial: Record<string, TripActionChoice> = {};
        for (const trip of data.ownedTrips) {
          initial[trip.id] = { tripId: trip.id, action: "retain_admin" };
        }
        setTripActions(initial);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load deletion impact");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, memberId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const emailMatches = useMemo(() => {
    if (!impact) return false;
    return confirmEmail.trim().toLowerCase() === impact.member.email.toLowerCase();
  }, [confirmEmail, impact]);

  const tripsReady = useMemo(() => {
    if (!impact) return false;
    return impact.ownedTrips.every((trip) => {
      const choice = tripActions[trip.id];
      if (!choice) return false;
      if (choice.action === "reassign" && !choice.newOrganizerId) return false;
      return true;
    });
  }, [impact, tripActions]);

  async function submit() {
    if (!memberId || !impact || !emailMatches || !tripsReady) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/members/${memberId}/permanent-delete`, {
        confirmEmail: confirmEmail.trim(),
        tripActions: Object.values(tripActions),
      });
      toast.success("Account permanently deleted");
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Permanent deletion failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="dialog-root" role="presentation">
      <button
        type="button"
        className="dialog-backdrop"
        aria-label="Close dialog"
        disabled={busy}
        onClick={onClose}
      />
      <div
        className="dialog-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ maxWidth: "36rem", maxHeight: "90vh", overflowY: "auto" }}
      >
        <h3 id={titleId} className="dialog-title">
          Permanently delete account
        </h3>
        <p className="mt-3 mb-0 text-sm leading-relaxed text-[var(--keepers-danger)]">
          This cannot be undone. The Auth user is removed, personal data is scrubbed, and the
          account cannot sign in again. Shared trip history is retained according to club rules.
        </p>

        {loading ? (
          <p className="mt-4 text-sm text-[var(--keepers-muted)]">Loading account impact…</p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-[var(--keepers-danger)]">{error}</p> : null}

        {impact ? (
          <div className="mt-4 space-y-4">
            <dl className="detail-grid">
              <div>
                <dt>Name</dt>
                <dd>{impact.member.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{impact.member.email}</dd>
              </div>
              <div>
                <dt>Username</dt>
                <dd>@{impact.member.username}</dd>
              </div>
              <div>
                <dt>Roles</dt>
                <dd>
                  {(impact.member.roles || []).map((r) => r.code).join(", ") || "member"}
                </dd>
              </div>
              <div>
                <dt>Active registrations</dt>
                <dd>{impact.activeRegistrations}</dd>
              </div>
              <div>
                <dt>Pending upgrades</dt>
                <dd>{impact.pendingUpgrades}</dd>
              </div>
              <div>
                <dt>Pre-Marshall assignments</dt>
                <dd>{impact.preMarshallAssignments.length}</dd>
              </div>
            </dl>

            {impact.ownedTrips.length > 0 ? (
              <div>
                <p className="form-label">Owned / organized trips</p>
                <p className="m-0 mb-3 text-sm text-[var(--keepers-muted)]">
                  Trips are not auto-deleted. Choose reassign, cancel, or retain under your Admin
                  ownership for each drive.
                </p>
                <ul className="m-0 list-none space-y-3 p-0">
                  {impact.ownedTrips.map((trip) => {
                    const choice = tripActions[trip.id] || {
                      tripId: trip.id,
                      action: "retain_admin" as const,
                    };
                    return (
                      <li
                        key={trip.id}
                        className="rounded border border-[var(--keepers-line)] p-3"
                      >
                        <div className="text-sm font-medium">{trip.title}</div>
                        <div className="text-xs text-[var(--keepers-muted)]">
                          {formatDate(trip.date)} · {trip.status} · {trip.relation} ·{" "}
                          {trip.activeRegistrations} active regs
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <select
                            className="admin-select"
                            value={choice.action}
                            disabled={busy}
                            onChange={(e) => {
                              const action = e.target.value as TripActionChoice["action"];
                              setTripActions((prev) => ({
                                ...prev,
                                [trip.id]: {
                                  tripId: trip.id,
                                  action,
                                  newOrganizerId:
                                    action === "reassign"
                                      ? prev[trip.id]?.newOrganizerId
                                      : undefined,
                                },
                              }));
                            }}
                          >
                            <option value="retain_admin">Retain under Admin</option>
                            <option value="reassign">Reassign organizer</option>
                            <option value="cancel">Cancel trip</option>
                          </select>
                          {choice.action === "reassign" ? (
                            <select
                              className="admin-select"
                              value={choice.newOrganizerId || ""}
                              disabled={busy}
                              onChange={(e) => {
                                setTripActions((prev) => ({
                                  ...prev,
                                  [trip.id]: {
                                    tripId: trip.id,
                                    action: "reassign",
                                    newOrganizerId: e.target.value || undefined,
                                  },
                                }));
                              }}
                            >
                              <option value="">Select Marshall / Admin…</option>
                              {impact.eligibleOrganizers.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name} (@{m.username})
                                </option>
                              ))}
                            </select>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="m-0 text-sm text-[var(--keepers-muted)]">
                No owned or organized trips require a decision.
              </p>
            )}

            <ul className="m-0 list-disc space-y-1 pl-5 text-sm text-[var(--keepers-muted)]">
              {impact.retentionNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>

            <FormField label={`Type ${impact.member.email} to confirm`}>
              <input
                className="admin-input"
                value={confirmEmail}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                placeholder={impact.member.email}
                onChange={(e) => setConfirmEmail(e.target.value)}
              />
            </FormField>
          </div>
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy || loading || !impact || !emailMatches || !tripsReady}
            onClick={() => void submit()}
          >
            {busy ? "Deleting…" : "Permanently delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
