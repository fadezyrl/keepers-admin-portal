"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useToast } from "@/lib/toast";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { RowActions } from "@/components/ui/RowActions";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type ClubEvent = {
  id: string;
  title: string;
  description?: string;
  date: string;
  location?: string;
  image?: string;
  status: string;
};

const empty = {
  title: "",
  description: "",
  date: "",
  location: "",
  image: "",
  status: "draft",
};

export default function EventsPage() {
  const toast = useToast();
  const { data, error, loading, refreshing, reload, setData } = useAsync(
    () => api.get<ClubEvent[]>("/events?includeUnpublished=true"),
    [],
  );
  const [form, setForm] = useState(empty);
  const [editId, setEditId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function openCreate() {
    setEditId(null);
    setForm(empty);
    setDrawerOpen(true);
  }

  function openEdit(event: ClubEvent) {
    setEditId(event.id);
    setForm({
      title: event.title,
      description: event.description || "",
      date: String(event.date).slice(0, 10),
      location: event.location || "",
      image: event.image || "",
      status: event.status || "draft",
    });
    setDrawerOpen(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editId) {
        await api.patch(`/events/${editId}`, form);
        setData((prev) =>
          (prev || []).map((ev) => (ev.id === editId ? { ...ev, ...form } : ev)),
        );
        toast.success("Event updated");
      } else {
        await api.post("/events", form);
        toast.success("Event created");
        await reload();
      }
      setDrawerOpen(false);
      setForm(empty);
      setEditId(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save event");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await api.post(`/events/${id}/status`, { status });
      setData((prev) =>
        (prev || []).map((ev) => (ev.id === id ? { ...ev, status } : ev)),
      );
      toast.success(`Event marked ${status}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update status");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.delete(`/events/${id}`);
      setData((prev) => (prev || []).filter((ev) => ev.id !== id));
      toast.success("Event deleted");
      setDeleteId(null);
      if (editId === id) setDrawerOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete event");
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<ClubEvent>[] = [
    {
      key: "event",
      header: "Event",
      cell: (event) => (
        <div className="flex items-center gap-3">
          {event.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.image} alt="" className="thumb" />
          ) : null}
          <div>
            <div className="font-medium">{event.title}</div>
            <div className="text-sm text-[var(--keepers-muted)]">
              {formatDate(event.date)}
              {event.location ? ` · ${event.location}` : ""}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (event) => <StatusBadge status={event.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (event) => (
        <RowActions
          actions={[
            { label: "Edit", onClick: () => openEdit(event) },
            {
              label: "Publish",
              onClick: () => void setStatus(event.id, "scheduled"),
              hidden: event.status === "scheduled",
            },
            {
              label: "Unpublish",
              onClick: () => void setStatus(event.id, "draft"),
              hidden: event.status !== "scheduled",
            },
            {
              label: "Delete",
              onClick: () => setDeleteId(event.id),
              tone: "danger",
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Events"
        subtitle="Club events shown to members. Publish sets status to scheduled."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            New event
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={data || []}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyTitle="No events"
        emptyDescription="Create the first club event to get started."
        onRowClick={openEdit}
        busyIds={busyIds}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editId ? "Edit event" : "New event"}
        wide
        footer={
          <>
            <button type="submit" form="event-form" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : editId ? "Update" : "Create"}
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
        <form id="event-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Title" className="sm:col-span-2">
            <input
              className="admin-input"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
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
          <FormField label="Location">
            <input
              className="admin-input"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
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
              label="Image"
              bucket="gallery"
              value={form.image}
              onChange={(image) => setForm({ ...form, image })}
            />
          </div>
          <FormField label="Status">
            <select
              className="admin-select"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="draft">Draft (unpublished)</option>
              <option value="scheduled">Scheduled (published)</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
            </select>
          </FormField>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete event?"
        description="This permanently removes the event."
        confirmLabel="Delete"
        busy={busy}
        onClose={() => {
          if (!busy) setDeleteId(null);
        }}
        onConfirm={() => {
          if (deleteId) void remove(deleteId);
        }}
      />
    </div>
  );
}
