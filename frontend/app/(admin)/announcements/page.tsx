"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Announcement } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function AnnouncementsPage() {
  const { data, error, loading, reload } = useAsync(
    () => api.get<Announcement[]>("/content/announcements"),
    [],
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publish, setPublish] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/content/announcements", {
        title: title.trim(),
        body: body.trim(),
        publish,
        targetAudience: "all",
      });
      setTitle("");
      setBody("");
      setPublish(false);
      setMessage(publish ? "Announcement published" : "Draft announcement created");
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to create announcement");
    } finally {
      setBusy(false);
    }
  }

  async function publishExisting(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/content/announcements/${id}/publish`);
      setMessage("Announcement published");
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to publish");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Compose club notices and publish to members."
      />

      {message ? (
        <div className="mb-6">
          <Alert>{message}</Alert>
        </div>
      ) : null}

      <form onSubmit={create} className="panel mb-8 space-y-4 p-6">
        <label className="block">
          <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
            Title
          </span>
          <input
            className="admin-input"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
            Body
          </span>
          <textarea
            className="admin-textarea"
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={publish}
            onChange={(e) => setPublish(e.target.checked)}
          />
          Publish immediately
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Create announcement
        </button>
      </form>

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      {!loading && !error && (data || []).length === 0 ? (
        <EmptyBlock title="No announcements" description="Create the first notice above." />
      ) : null}

      {!loading && !error && (data || []).length > 0 ? (
        <div className="space-y-3">
          {data!.map((a) => (
            <article key={a.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display m-0 text-2xl">{a.title}</h3>
                  <p className="mt-1 mb-0 text-sm text-[var(--keepers-muted)]">
                    {formatDateTime(a.published_at || a.created_at)}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-4 mb-0 whitespace-pre-wrap text-sm leading-relaxed">{a.body}</p>
              {a.status !== "published" ? (
                <button
                  type="button"
                  className="btn btn-secondary mt-4"
                  disabled={busy}
                  onClick={() => publishExisting(a.id)}
                >
                  Publish
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
