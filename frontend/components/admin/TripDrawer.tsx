"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterTripMutation } from "@/lib/invalidate";
import { formatDate } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { useToast } from "@/lib/toast";
import { Drawer } from "@/components/ui/Drawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DrawerSkeleton } from "@/components/ui/Skeleton";
import { FormField } from "@/components/ui/FormField";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { TRIP_CATEGORIES } from "@/lib/tripCategories";

const emptyForm = {
  title: "",
  destination: "",
  date: "",
  time: "",
  description: "",
  meetingPoint: "",
  difficulty: "Moderate",
  category: "Trips & Events",
  maxParticipants: "20",
  coverImage: "",
  publish: false,
};

export function TripCreateDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (trip: Trip) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm(emptyForm);
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await api.post<Trip>("/trips", {
        title: form.title.trim(),
        destination: form.destination.trim(),
        date: form.date,
        time: form.time || undefined,
        description: form.description || undefined,
        meetingPoint: form.meetingPoint || undefined,
        difficulty: form.difficulty,
        category: form.category,
        maxParticipants: Number(form.maxParticipants) || 20,
        coverImage: form.coverImage.trim() || undefined,
        publish: form.publish,
      });
      onCreated(created);
      toast.success("Trip created");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create trip");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New trip"
      subtitle="Create a draft or publish immediately."
      wide
      footer={
        <>
          <button type="submit" form="trip-create-form" className="btn btn-primary" disabled={busy}>
            {busy ? "Creating…" : "Create trip"}
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <form id="trip-create-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <FormField label="Title" className="sm:col-span-2">
          <input
            className="admin-input"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </FormField>
        <FormField label="Destination">
          <input
            className="admin-input"
            required
            value={form.destination}
            onChange={(e) => setForm({ ...form, destination: e.target.value })}
          />
        </FormField>
        <FormField label="Date">
          <input
            className="admin-input"
            type="date"
            required
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </FormField>
        <FormField label="Time">
          <input
            className="admin-input"
            type="time"
            value={form.time}
            onChange={(e) => setForm({ ...form, time: e.target.value })}
          />
        </FormField>
        <FormField label="Difficulty">
          <select
            className="admin-select"
            value={form.difficulty}
            onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
          >
            <option>Easy</option>
            <option>Moderate</option>
            <option>Advanced</option>
            <option>Expert</option>
          </select>
        </FormField>
        <FormField label="Category">
          <select
            className="admin-select"
            required
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {TRIP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Max participants">
          <input
            className="admin-input"
            type="number"
            min={1}
            value={form.maxParticipants}
            onChange={(e) => setForm({ ...form, maxParticipants: e.target.value })}
          />
        </FormField>
        <FormField label="Meeting point" className="sm:col-span-2">
          <input
            className="admin-input"
            value={form.meetingPoint}
            onChange={(e) => setForm({ ...form, meetingPoint: e.target.value })}
          />
        </FormField>
        <FormField label="Description" className="sm:col-span-2">
          <textarea
            className="admin-textarea"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </FormField>
        <div className="sm:col-span-2">
          <MediaPicker
            label="Cover image"
            bucket="trips"
            value={form.coverImage}
            onChange={(coverImage) => setForm({ ...form, coverImage })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={form.publish}
            onChange={(e) => setForm({ ...form, publish: e.target.checked })}
          />
          Publish immediately
        </label>
      </form>
    </Drawer>
  );
}

export function TripQuickDrawer({
  tripId,
  open,
  onClose,
  onUpdated,
}: {
  tripId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: (trip: Trip) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState({
    title: "",
    destination: "",
    meetingPoint: "",
    description: "",
    category: "Trips & Events",
    coverImage: "",
  });
  const hydratedFor = useRef<string | null>(null);

  const active = open && Boolean(tripId);
  const query = useAdminQuery(
    queryKeys.trips.detail(tripId ?? ""),
    (signal) => api.get<Trip>(`/trips/${tripId}`, { signal }),
    { staleTime: stale.operational, enabled: active },
  );
  const setData = query.setData;

  // Previous-data placeholders must not leak another trip into the drawer.
  const data = active && query.data?.id === tripId ? query.data : null;
  const error = active ? query.error : null;
  const loading = active && !data && !error;

  useEffect(() => {
    if (!data) {
      if (!active) hydratedFor.current = null;
      return;
    }
    if (hydratedFor.current === data.id) return;
    hydratedFor.current = data.id;
    setEdit({
      title: data.title || "",
      destination: data.destination || "",
      meetingPoint: data.meetingPoint || "",
      description: data.description || "",
      category: data.category || "Trips & Events",
      coverImage: data.coverImage || "",
    });
  }, [data, active]);

  async function setStatus(status: string) {
    if (!tripId) return;
    setBusy(true);
    try {
      await api.post(`/trips/${tripId}/status`, { status });
      const next = data
        ? { ...data, status, publishStatus: status }
        : null;
      if (next) {
        setData(next);
        onUpdated?.(next);
      }
      await afterTripMutation(queryClient);
      toast.success(`Trip marked ${status}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update trip");
    } finally {
      setBusy(false);
    }
  }

  async function saveQuick(e: FormEvent) {
    e.preventDefault();
    if (!tripId || !data) return;
    setBusy(true);
    try {
      const updated = await api.patch<Trip>(`/trips/${tripId}`, {
        title: edit.title.trim(),
        destination: edit.destination.trim(),
        meetingPoint: edit.meetingPoint || "",
        description: edit.description || "",
        category: edit.category,
        coverImage: edit.coverImage.trim() || undefined,
      });
      const next = { ...data, ...updated, ...edit };
      setData(next);
      onUpdated?.(next);
      await afterTripMutation(queryClient);
      toast.success("Trip updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save trip");
    } finally {
      setBusy(false);
    }
  }

  const status = data?.publishStatus || data?.status;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={data?.title || "Trip"}
      subtitle={
        data
          ? `${data.destination} · ${formatDate(data.date)}${data.time ? ` · ${String(data.time).slice(0, 5)}` : ""}`
          : undefined
      }
      wide
      footer={
        data ? (
          <>
            {status !== "published" ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void setStatus("published")}
              >
                Publish
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void setStatus("draft")}
              >
                Unpublish
              </button>
            )}
            {status !== "completed" ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void setStatus("completed")}
              >
                Complete
              </button>
            ) : null}
            {status !== "cancelled" ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void setStatus("cancelled")}
              >
                Cancel
              </button>
            ) : null}
            <Link href={`/trips/${tripId}`} className="btn btn-ghost" onClick={onClose}>
              Full editor
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
            <StatusBadge status={status} />
            <span className="text-sm text-[var(--keepers-muted)]">
              {data.registeredCount ?? 0}
              {data.maxParticipants ? ` / ${data.maxParticipants}` : ""} registered
              {data.waitlistCount ? ` · ${data.waitlistCount} waitlist` : ""}
            </span>
          </div>

          <form onSubmit={saveQuick} className="grid gap-4 sm:grid-cols-2">
            <FormField label="Title" className="sm:col-span-2">
              <input
                className="admin-input"
                value={edit.title}
                onChange={(e) => setEdit({ ...edit, title: e.target.value })}
              />
            </FormField>
            <FormField label="Destination">
              <input
                className="admin-input"
                value={edit.destination}
                onChange={(e) => setEdit({ ...edit, destination: e.target.value })}
              />
            </FormField>
            <FormField label="Meeting point">
              <input
                className="admin-input"
                value={edit.meetingPoint}
                onChange={(e) => setEdit({ ...edit, meetingPoint: e.target.value })}
              />
            </FormField>
            <FormField label="Category" className="sm:col-span-2">
              <select
                className="admin-select"
                value={edit.category}
                onChange={(e) => setEdit({ ...edit, category: e.target.value })}
              >
                {TRIP_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Description" className="sm:col-span-2">
              <textarea
                className="admin-textarea"
                value={edit.description}
                onChange={(e) => setEdit({ ...edit, description: e.target.value })}
              />
            </FormField>
            <div className="sm:col-span-2">
              <MediaPicker
                label="Cover image"
                bucket="trips"
                value={edit.coverImage}
                onChange={(coverImage) => setEdit({ ...edit, coverImage })}
              />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="btn btn-secondary" disabled={busy}>
                Save changes
              </button>
            </div>
          </form>

          {(data.participants || []).length > 0 ? (
            <div>
              <p className="form-label">Participants</p>
              <ul className="m-0 max-h-48 list-none space-y-2 overflow-y-auto p-0">
                {data.participants!.slice(0, 12).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{p.name}</span>
                    <StatusBadge status={p.registrationStatus} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
