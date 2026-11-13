"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterTripMutation } from "@/lib/invalidate";
import type { Trip } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

function TripDetailInner() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const queryClient = useQueryClient();
  const { data, error, loading } = useAdminQuery(
    queryKeys.trips.detail(id),
    (signal) => api.get<Trip>(`/trips/${id}`, { signal }),
    { staleTime: stale.operational },
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");

  async function setStatus(status: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/trips/${id}/status`, { status, reason: reason || undefined });
      setMessage(`Trip marked ${status}`);
      await afterTripMutation(queryClient);
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
      await afterTripMutation(queryClient);
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
        coverImage: coverImage.trim() || String(fd.get("coverImage") || data.coverImage || "") || undefined,
      });
      setMessage("Trip updated");
      await afterTripMutation(queryClient);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to save trip");
    } finally {
      setBusy(false);
    }
  }

  async function attachMedia(e: FormEvent) {
    e.preventDefault();
    if (!mediaUrl.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/trips/${id}/media`, {
        url: mediaUrl.trim(),
        mediaType,
      });
      setMediaUrl("");
      setMessage(mediaType === "video" ? "Video attached" : "Image attached");
      await afterTripMutation(queryClient);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to attach media");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (data?.coverImage) {
      setCoverImage(data.coverImage);
    }
  }, [data?.coverImage]);

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
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Cover image URL
              </span>
              <input
                className="admin-input"
                name="coverImage"
                value={coverImage}
                onChange={(e) => setCoverImage(e.target.value)}
                placeholder="Upload via Media, then paste URL"
              />
            </label>
            <button type="submit" className="btn btn-secondary" disabled={busy}>
              Save changes
            </button>
          </form>

          <form onSubmit={attachMedia} className="mt-8 border-t border-[var(--keepers-line)] pt-6 space-y-4">
            <h3 className="font-display m-0 text-xl">Trip media</h3>
            <p className="m-0 text-sm text-[var(--keepers-muted)]">
              Attach highlight images or videos (mp4/mov/webm). Upload in Media first if needed.
            </p>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Media URL
              </span>
              <input
                className="admin-input"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://..."
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Type
              </span>
              <select
                className="admin-input"
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value as "image" | "video")}
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
            </label>
            <button type="submit" className="btn btn-secondary" disabled={busy || !mediaUrl.trim()}>
              Attach media
            </button>
            {(data.media || []).length > 0 ? (
              <ul className="m-0 list-none space-y-2 p-0">
                {(data.media || []).map((m: { id?: string; media_type?: string; public_url?: string }) => (
                  <li key={m.id || m.public_url} className="text-sm text-[var(--keepers-muted)]">
                    {(m.media_type || "image").toUpperCase()} · {m.public_url}
                  </li>
                ))}
              </ul>
            ) : null}
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
