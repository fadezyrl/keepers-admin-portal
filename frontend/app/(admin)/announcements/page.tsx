"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useToast } from "@/lib/toast";
import type { Announcement } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { RowActions } from "@/components/ui/RowActions";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";

export default function AnnouncementsPage() {
  const toast = useToast();
  const { data, error, loading, refreshing, reload, setData } = useAsync(
    () => api.get<Announcement[]>("/content/announcements"),
    [],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [active, setActive] = useState<Announcement | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publish, setPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  function openCreate() {
    setTitle("");
    setBody("");
    setPublish(false);
    setDrawerOpen(true);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/content/announcements", {
        title: title.trim(),
        body: body.trim(),
        publish,
        targetAudience: "all",
      });
      toast.success(publish ? "Announcement published" : "Draft announcement created");
      setDrawerOpen(false);
      await reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create announcement");
    } finally {
      setBusy(false);
    }
  }

  async function publishExisting(id: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await api.post(`/content/announcements/${id}/publish`);
      setData((prev) =>
        (prev || []).map((a) =>
          a.id === id ? { ...a, status: "published", published_at: new Date().toISOString() } : a,
        ),
      );
      if (active?.id === id) {
        setActive({ ...active, status: "published", published_at: new Date().toISOString() });
      }
      toast.success("Announcement published");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to publish");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const columns: DataColumn<Announcement>[] = [
    {
      key: "title",
      header: "Announcement",
      cell: (a) => (
        <div>
          <div className="font-medium">{a.title}</div>
          <div className="line-clamp-1 text-sm text-[var(--keepers-muted)]">{a.body}</div>
        </div>
      ),
    },
    {
      key: "when",
      header: "When",
      cell: (a) => formatDateTime(a.published_at || a.created_at),
    },
    {
      key: "status",
      header: "Status",
      cell: (a) => <StatusBadge status={a.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (a) => (
        <RowActions
          actions={[
            { label: "View", onClick: () => setActive(a) },
            {
              label: "Publish",
              onClick: () => void publishExisting(a.id),
              hidden: a.status === "published",
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Compose club notices and publish to members."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            New announcement
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={data || []}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyTitle="No announcements"
        emptyDescription="Create the first notice to get started."
        onRowClick={setActive}
        busyIds={busyIds}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="New announcement"
        footer={
          <>
            <button type="submit" form="announcement-form" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Create"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setDrawerOpen(false)}
            >
              Cancel
            </button>
          </>
        }
      >
        <form id="announcement-form" onSubmit={create} className="space-y-4">
          <FormField label="Title">
            <input
              className="admin-input"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
          <FormField label="Body">
            <textarea
              className="admin-textarea"
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
            />
            Publish immediately
          </label>
        </form>
      </Drawer>

      <Drawer
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={active?.title || "Announcement"}
        subtitle={active ? formatDateTime(active.published_at || active.created_at) : undefined}
        footer={
          active && active.status !== "published" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busyIds.has(active.id)}
              onClick={() => void publishExisting(active.id)}
            >
              Publish
            </button>
          ) : null
        }
      >
        {active ? (
          <div className="space-y-4">
            <StatusBadge status={active.status} />
            <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">{active.body}</p>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
