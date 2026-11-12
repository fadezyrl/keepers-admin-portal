"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { api, ApiError, buildQuery } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Paginated, Trip } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

const emptyForm = {
  title: "",
  destination: "",
  date: "",
  time: "",
  description: "",
  meetingPoint: "",
  difficulty: "Moderate",
  maxParticipants: "20",
  publish: false,
};

export default function TripsPage() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const path = useMemo(
    () =>
      `/trips${buildQuery({
        q: query || undefined,
        includeDrafts: true,
        filter: "all",
        limit: 100,
      })}`,
    [query],
  );

  const { data, error, loading, reload } = useAsync(
    () => api.get<Paginated<Trip>>(path),
    [path],
  );

  async function createTrip(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const created = await api.post<Trip>("/trips", {
        title: form.title.trim(),
        destination: form.destination.trim(),
        date: form.date,
        time: form.time || undefined,
        description: form.description || undefined,
        meetingPoint: form.meetingPoint || undefined,
        difficulty: form.difficulty,
        maxParticipants: Number(form.maxParticipants) || 20,
        publish: form.publish,
      });
      setForm(emptyForm);
      setShowCreate(false);
      await reload();
      window.location.href = `/trips/${created.id}`;
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create trip");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Trips"
        subtitle="Draft, publish, and manage Keepers adventures."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? "Close form" : "New trip"}
          </button>
        }
      />

      {showCreate ? (
        <form onSubmit={createTrip} className="panel mb-8 grid gap-4 p-6 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Title
            </span>
            <input
              className="admin-input"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Destination
            </span>
            <input
              className="admin-input"
              required
              value={form.destination}
              onChange={(e) => setForm({ ...form, destination: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Date
            </span>
            <input
              className="admin-input"
              type="date"
              required
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Time
            </span>
            <input
              className="admin-input"
              type="time"
              value={form.time}
              onChange={(e) => setForm({ ...form, time: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Difficulty
            </span>
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
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Meeting point
            </span>
            <input
              className="admin-input"
              value={form.meetingPoint}
              onChange={(e) => setForm({ ...form, meetingPoint: e.target.value })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Description
            </span>
            <textarea
              className="admin-textarea"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.publish}
              onChange={(e) => setForm({ ...form, publish: e.target.checked })}
            />
            Publish immediately
          </label>
          {formError ? <div className="sm:col-span-2"><Alert tone="danger">{formError}</Alert></div> : null}
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Creating…" : "Create trip"}
            </button>
          </div>
        </form>
      ) : null}

      <form
        className="mb-6 flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(q.trim());
        }}
      >
        <input
          className="admin-input max-w-sm"
          placeholder="Search trips…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      {!loading && !error && data && data.items.length === 0 ? (
        <EmptyBlock title="No trips" description="Create the first adventure above." />
      ) : null}

      {!loading && !error && data && data.items.length > 0 ? (
        <div className="panel overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Trip</th>
                <th>Date</th>
                <th>Status</th>
                <th>Registrations</th>
                <th>Difficulty</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/trips/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                    <div className="text-sm text-[var(--keepers-muted)]">{t.destination}</div>
                  </td>
                  <td>
                    {formatDate(t.date)}
                    {t.time ? ` · ${String(t.time).slice(0, 5)}` : ""}
                  </td>
                  <td>
                    <StatusBadge status={t.publishStatus || t.status} />
                  </td>
                  <td>
                    {t.registeredCount ?? 0}
                    {t.maxParticipants ? ` / ${t.maxParticipants}` : ""}
                  </td>
                  <td>{t.difficulty || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
