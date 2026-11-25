"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterTripMutation } from "@/lib/invalidate";
import type { Member, Paginated, Trip } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TRIP_CATEGORIES } from "@/lib/tripCategories";
import { mapsSearchUrl, parseMapsUrl } from "@/lib/mapsLinks";

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
  const [preMarshallUserId, setPreMarshallUserId] = useState("");
  const [preMarshallNotes, setPreMarshallNotes] = useState("");
  const [confirmPermanent, setConfirmPermanent] = useState("");
  const [deletingPermanent, setDeletingPermanent] = useState(false);
  const assignments = useAdminQuery(
    ["trips", id, "pre-marshalls"],
    (signal) =>
      api.get<
        Array<{
          id: string;
          userId: string;
          name: string;
          username?: string;
          notes?: string | null;
        }>
      >(`/trips/${id}/pre-marshalls`, { signal }),
    { staleTime: stale.operational, enabled: Boolean(id) },
  );
  const preMarshallCandidates = useAdminQuery(
    ["members", "pre_marshall", "candidates"],
    (signal) =>
      api.get<Paginated<Member>>(`/members?role=pre_marshall&limit=100`, {
        signal,
      }),
    { staleTime: stale.list },
  );

  async function assignPreMarshall(e: FormEvent) {
    e.preventDefault();
    if (!preMarshallUserId) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/trips/${id}/pre-marshalls`, {
        userId: preMarshallUserId,
        notes: preMarshallNotes.trim() || undefined,
      });
      setPreMarshallUserId("");
      setPreMarshallNotes("");
      setMessage("Pre-Marshall assigned");
      await Promise.all([
        afterTripMutation(queryClient),
        queryClient.invalidateQueries({ queryKey: ["trips", id, "pre-marshalls"] }),
      ]);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to assign Pre-Marshall");
    } finally {
      setBusy(false);
    }
  }

  async function unassignPreMarshall(userId: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api.delete(`/trips/${id}/pre-marshalls/${userId}`);
      setMessage("Pre-Marshall unassigned");
      await Promise.all([
        afterTripMutation(queryClient),
        queryClient.invalidateQueries({ queryKey: ["trips", id, "pre-marshalls"] }),
      ]);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to unassign Pre-Marshall");
    } finally {
      setBusy(false);
    }
  }

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

  async function softDeleteTrip() {
    if (
      !window.confirm(
        `Soft-delete “${data?.title || "this trip"}”? It will hide from lists but remain in the database.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.delete(`/trips/${id}`);
      setMessage("Trip soft-deleted (hidden from lists)");
      await afterTripMutation(queryClient);
      window.location.href = "/trips";
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to soft-delete trip");
    } finally {
      setBusy(false);
    }
  }

  async function permanentlyDeleteTrip() {
    if (!data) return;
    if (confirmPermanent.trim() !== data.title) {
      setMessage("Type the exact trip title to confirm permanent deletion.");
      return;
    }
    if (
      !window.confirm(
        `PERMANENTLY delete “${data.title}”? This cannot be undone.\n\nWill remove: registrations, attendance, trip ratings/history, trip media, Pre-Marshall assignments.\nUpgrade requests linked to this trip will be detached/withdrawn.\nMember profiles stay intact.`,
      )
    ) {
      return;
    }
    setDeletingPermanent(true);
    setBusy(true);
    setMessage(null);
    try {
      await api.delete(`/trips/${id}/permanent`);
      await afterTripMutation(queryClient);
      window.location.href = "/trips";
    } catch (err) {
      setMessage(
        err instanceof ApiError ? err.message : "Failed to permanently delete trip",
      );
    } finally {
      setDeletingPermanent(false);
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
      const mapsLink = String(fd.get("mapsLink") || "");
      const locationLabel = String(fd.get("locationLabel") || "");
      const parsed = parseMapsUrl(mapsLink);
      await api.patch(`/trips/${id}`, {
        title: String(fd.get("title") || data.title),
        description: String(fd.get("description") || ""),
        destination: String(fd.get("destination") || data.destination),
        meetingPoint: String(fd.get("meetingPoint") || ""),
        category: String(fd.get("category") || data.category || "Trips & Events"),
        instructions: String(fd.get("instructions") || ""),
        coverImage: coverImage.trim() || String(fd.get("coverImage") || data.coverImage || "") || undefined,
        location: {
          label:
            locationLabel.trim() ||
            String(fd.get("destination") || data.destination) ||
            String(fd.get("meetingPoint") || ""),
          latitude: parsed.latitude ?? undefined,
          longitude: parsed.longitude ?? undefined,
        },
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
                Location label
              </span>
              <input
                className="admin-input"
                name="locationLabel"
                defaultValue={data.location?.label || ""}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Maps link
              </span>
              <input
                className="admin-input"
                name="mapsLink"
                defaultValue={
                  data.location?.latitude != null && data.location?.longitude != null
                    ? `https://www.google.com/maps/search/?api=1&query=${data.location.latitude},${data.location.longitude}`
                    : ""
                }
                placeholder="Paste a Google Maps link"
              />
              <a
                className="mt-2 inline-block text-sm underline"
                href={mapsSearchUrl({
                  label: data.location?.label || data.destination,
                  latitude: data.location?.latitude,
                  longitude: data.location?.longitude,
                })}
                target="_blank"
                rel="noreferrer"
              >
                Open in Google Maps
              </a>
            </label>
            <label className="block">
              <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                Category
              </span>
              <select
                className="admin-select"
                name="category"
                defaultValue={data.category || "Trips & Events"}
              >
                {TRIP_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
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
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void softDeleteTrip()}
              >
                Soft delete
              </button>
            </div>

            <div className="mt-8 border border-[var(--keepers-danger,#8b1e1e)] bg-[rgba(139,30,30,0.06)] p-4">
              <h3 className="font-display m-0 text-xl text-[var(--keepers-danger,#8b1e1e)]">
                Permanent deletion
              </h3>
              <p className="mt-2 mb-0 text-sm text-[var(--keepers-muted)]">
                Removes this trip from the database. Registrations, attendance, trip ratings,
                rating history, trip media and Pre-Marshall assignments are deleted. Pending
                upgrade requests for this trip are withdrawn. Member accounts are not deleted.
              </p>
              <p className="mt-2 mb-0 text-sm">
                Current registrations (incl. waitlist/pending):{" "}
                <strong>
                  {(data.registeredCount ?? 0) + (data.waitlistCount ?? 0)}
                </strong>
              </p>
              <label className="mt-4 block">
                <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                  Type trip title to confirm: {data.title}
                </span>
                <input
                  className="admin-input"
                  value={confirmPermanent}
                  onChange={(e) => setConfirmPermanent(e.target.value)}
                  placeholder={data.title}
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="btn btn-danger mt-4"
                disabled={
                  busy ||
                  deletingPermanent ||
                  confirmPermanent.trim() !== data.title
                }
                onClick={() => void permanentlyDeleteTrip()}
              >
                {deletingPermanent ? "Deleting…" : "Permanently delete trip"}
              </button>
            </div>
          </div>
        </section>

        <div className="space-y-6">
          <section className="panel">
            <div className="border-b border-[var(--keepers-line)] px-5 py-4">
              <h2 className="font-display m-0 text-2xl">Pre-Marshalls</h2>
              <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                Assigned Pre-Marshalls get view-only access to this drive in the app
              </p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <form onSubmit={assignPreMarshall} className="space-y-3">
                <label className="block">
                  <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                    Pre-Marshall
                  </span>
                  <select
                    className="admin-input"
                    value={preMarshallUserId}
                    onChange={(e) => setPreMarshallUserId(e.target.value)}
                  >
                    <option value="">Select member…</option>
                    {(preMarshallCandidates.data?.items || []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || `${m.firstName || ""} ${m.lastName || ""}`.trim()}
                        {m.username ? ` (@${m.username})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                    Notes (optional)
                  </span>
                  <input
                    className="admin-input"
                    value={preMarshallNotes}
                    onChange={(e) => setPreMarshallNotes(e.target.value)}
                    placeholder="Assignment note"
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-secondary"
                  disabled={busy || !preMarshallUserId}
                >
                  Assign
                </button>
              </form>
              {assignments.loading ? <LoadingBlock /> : null}
              {assignments.error ? <ErrorBlock message={assignments.error} /> : null}
              {!assignments.loading && (assignments.data || []).length === 0 ? (
                <EmptyBlock
                  title="No Pre-Marshalls assigned"
                  description="Assign a member who already has the pre_marshall role."
                />
              ) : null}
              <ul className="m-0 list-none divide-y divide-[var(--keepers-line)] p-0">
                {(assignments.data || []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-medium">{a.name}</div>
                      {a.username ? (
                        <div className="text-sm text-[var(--keepers-muted)]">@{a.username}</div>
                      ) : null}
                      {a.notes ? (
                        <div className="mt-1 text-sm text-[var(--keepers-muted)]">{a.notes}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => void unassignPreMarshall(a.userId)}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
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
                  <li key={p.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <Link href={`/members/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="mt-1 flex items-center gap-2 text-sm text-[var(--keepers-muted)]">
                        <StatusBadge status={p.registrationStatus} />
                        {p.vehicle ? <span>{p.vehicle}</span> : null}
                      </div>
                      {p.readinessChecklist?.length ? (
                        <div className="mt-3 rounded-md border border-[var(--keepers-line)] bg-[var(--keepers-cream)]/40 px-3 py-2">
                          <p className="m-0 text-[0.65rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
                            Vehicle readiness
                          </p>
                          <ul className="mt-2 mb-0 list-none space-y-1 p-0">
                            {p.readinessChecklist.map((item) => (
                              <li
                                key={item.id}
                                className={`text-sm ${
                                  item.selected
                                    ? "text-[var(--keepers-black)]"
                                    : "text-[var(--keepers-muted)]"
                                }`}
                              >
                                <span className="mr-2 inline-block w-4 text-center">
                                  {item.selected ? "✓" : "○"}
                                </span>
                                {item.label}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary shrink-0"
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
