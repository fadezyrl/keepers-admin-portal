"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterSponsorMutation } from "@/lib/invalidate";
import { useToast } from "@/lib/toast";
import type { Sponsor } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { RowActions } from "@/components/ui/RowActions";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export default function SponsorsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, error, loading, refreshing, setData } = useAdminQuery(
    queryKeys.content.sponsors(),
    (signal) => api.get<Sponsor[]>("/content/sponsors?activeOnly=false", { signal }),
    { staleTime: stale.content },
  );
  const [rows, setRows] = useState<Sponsor[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Sponsor | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [logo, setLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    setRows(data || []);
  }, [data]);

  function openCreate() {
    setEditing(null);
    setName("");
    setUrl("");
    setLogo("");
    setDrawerOpen(true);
  }

  function openEdit(s: Sponsor) {
    setEditing(s);
    setName(s.name);
    setUrl(s.url || "");
    setLogo(s.logo || "");
    setDrawerOpen(true);
  }

  async function saveSponsor(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/content/sponsors", {
        id: editing?.id,
        name: name.trim(),
        url: url.trim() || undefined,
        logo: logo.trim() || undefined,
        isActive: editing?.isActive ?? true,
        displayOrder: editing?.displayOrder ?? rows.length,
      });
      toast.success(editing ? "Sponsor updated" : "Sponsor created");
      setDrawerOpen(false);
      await afterSponsorMutation(queryClient);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save sponsor");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.delete(`/content/sponsors/${id}`);
      setData((prev) => (prev || []).filter((s) => s.id !== id));
      await afterSponsorMutation(queryClient);
      toast.success("Sponsor deleted");
      setDeleteId(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete sponsor");
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...rows];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    setRows(next);
    try {
      await api.post("/content/sponsors/reorder", {
        orderedIds: next.map((s) => s.id),
      });
      setData(next);
      await afterSponsorMutation(queryClient);
      toast.success("Order saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to reorder");
      await afterSponsorMutation(queryClient);
    }
  }

  async function toggleActive(s: Sponsor) {
    try {
      await api.post("/content/sponsors", {
        id: s.id,
        name: s.name,
        url: s.url || undefined,
        logo: s.logo || undefined,
        isActive: s.isActive === false,
        displayOrder: s.displayOrder ?? 0,
      });
      setData((prev) =>
        (prev || []).map((row) =>
          row.id === s.id ? { ...row, isActive: s.isActive === false } : row,
        ),
      );
      await afterSponsorMutation(queryClient);
      toast.success(s.isActive === false ? "Sponsor activated" : "Sponsor deactivated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update sponsor");
    }
  }

  const columns: DataColumn<Sponsor>[] = [
    {
      key: "order",
      header: "Order",
      cell: (s) => {
        const index = rows.findIndex((r) => r.id === s.id);
        return (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={index === 0}
              onClick={() => void move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={index === rows.length - 1}
              onClick={() => void move(index, 1)}
            >
              ↓
            </button>
          </div>
        );
      },
    },
    {
      key: "logo",
      header: "Logo",
      cell: (s) =>
        s.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.logo} alt="" className="h-8 w-16 object-contain" />
        ) : (
          "—"
        ),
    },
    {
      key: "name",
      header: "Name",
      cell: (s) => <span className="font-medium">{s.name}</span>,
    },
    {
      key: "url",
      header: "URL",
      cell: (s) =>
        s.url ? (
          <a href={s.url} target="_blank" rel="noreferrer" className="text-sm hover:underline">
            {s.url}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "active",
      header: "Active",
      cell: (s) => <StatusBadge status={s.isActive === false ? "draft" : "active"} />,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (s) => (
        <RowActions
          actions={[
            { label: "Edit", onClick: () => openEdit(s) },
            {
              label: s.isActive === false ? "Activate" : "Deactivate",
              onClick: () => void toggleActive(s),
            },
            {
              label: "Delete",
              onClick: () => setDeleteId(s.id),
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
        title="Sponsors"
        subtitle="Edit partners, replace logos, and control display order."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            Add sponsor
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyTitle="No sponsors"
        emptyDescription="Add the first partner to get started."
        onRowClick={openEdit}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? "Edit sponsor" : "Add sponsor"}
        footer={
          <>
            <button type="submit" form="sponsor-form" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : editing ? "Update" : "Create"}
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
        <form id="sponsor-form" onSubmit={saveSponsor} className="space-y-4">
          <FormField label="Name">
            <input
              className="admin-input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField label="Website URL">
            <input
              className="admin-input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </FormField>
          <MediaPicker label="Logo" bucket="sponsors" value={logo} onChange={setLogo} />
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Delete sponsor?"
        description="This removes the sponsor from the portal."
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
