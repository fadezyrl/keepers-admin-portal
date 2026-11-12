"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Trip } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

function TripDetailInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { data, error, loading, reload } = useAsync(
    () => api.get<Trip>(`/trips/${id}`),
    [id],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  async function setStatus(status: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/trips/${id}/status`, { status, reason: reason || undefined });
      setMessage(`Trip marked ${status}`);
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to update trip");
    } finally {
      setBusy(false);
    }
  }

  async function markAttendance(userId: string, attended: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/trips/${id}/attendance`, { userId, attended });
      setMessage(attended ? "Attendance marked" : "Marked not attended");
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to record attendance");
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/trips/${id}`, {
        title: String(fd.get("title") || data.title),
        description: String(fd.get("description") || ""),
        destination: String(fd.get("destination") || data.destination),
        meetingPoint: String(fd.get("meetingPoint") || ""),
        instructions: String(fd.get("instructions") || ""),
      });
      setMessage("Trip updated");
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to save trip");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <EmptyBlock title="Trip not found" />;

  return (
    <div>
      <PageHeader
        title={data.title}
        subtitle={`${data.destination} · ${formatDate(data.date)}${data.time ? ` · ${String(data.time).slice(0, 5)}` : ""}`}
        actions={
          <Link href="/trips" className="btn btn-secondary">
            All trips
          </Link>
        }
      />

      {message ? (
        <div className="mb-6">
          <Alert>{message}</Alert>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge status={data.publishStatus || data.status} />
        <span className="text-sm text-[var(--keepers-muted)]">
          {data.registeredCount ?? 0}
          {data.maxParticipants ? ` / ${data.maxParticipants}` : ""} registered
          {data.waitlistCount ? ` · ${data.waitlistCount} waitlist` : ""}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="panel p-6">
          <h2 className="font-display m-0 text-2xl">Details</h2>
          <form onSubmit={saveNotes} className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Title
              </span>
              <input className="admin-input" name="title" defaultValue={data.title} />
            </label>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Destination
              </span>
              <input
                className="admin-input"
                name="destination"
                defaultValue={data.destination}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Meeting point
              </span>
              <input
                className="admin-input"
                name="meetingPoint"
                defaultValue={data.meetingPoint || ""}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Description
              </span>
              <textarea
                className="admin-textarea"
                name="description"
                defaultValue={data.description || ""}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Instructions
              </span>
              <textarea
                className="admin-textarea"
                name="instructions"
                defaultValue={data.instructions || ""}
              />
            </label>
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              Save changes
            </button>
          </form>

          <div className="mt-8 border-t border-[var(--keepers-line)] pt-6">
            <h3 className="font-display m-0 text-xl">Publish controls</h3>
            <label className="mt-4 block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Reason (for cancel)
              </span>
              <input
                className="admin-input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => setStatus("published")}
              >
                Publish
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setStatus("draft")}
              >
                Set draft
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setStatus("completed")}
              >
                Complete
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => setStatus("cancelled")}
              >
                Cancel trip
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="border-b border-[var(--keepers-line)] px-5 py-4">
            <h2 className="font-display m-0 text-2xl">Participants</h2>
            <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
              Registrations for this trip
            </p>
          </div>
          {(data.participants || []).length === 0 ? (
            <EmptyBlock
              title="No registrations"
              description="Members who join this trip will appear here."
            />
          ) : (
            <ul className="m-0 list-none divide-y divide-[var(--keepers-line)] p-0">
              {data.participants!.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <div>
                    <Link href={`/members/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="mt-1 flex items-center gap-2 text-sm text-[var(--keepers-muted)]">
                      <StatusBadge status={p.registrationStatus} />
                      {p.vehicle ? <span>{p.vehicle}</span> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => markAttendance(p.id, true)}
                  >
                    Attended
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export default function TripDetailPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <TripDetailInner />
    </Suspense>
  );
}
