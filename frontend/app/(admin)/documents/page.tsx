"use client";

import { FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterDocumentMutation } from "@/lib/invalidate";
import { useToast } from "@/lib/toast";
import type { DocumentRow } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { RowActions } from "@/components/ui/RowActions";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function DocumentsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, error, loading, refreshing, setData } = useAdminQuery(
    queryKeys.content.documents(),
    (signal) => api.get<DocumentRow[]>("/content/documents", { signal }),
    { staleTime: stale.content },
  );
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function startEdit(doc: DocumentRow) {
    setEditing(doc);
    setTitle(doc.title || "");
    setContent(doc.content || "");
    setFileUrl(doc.file_url || "");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      await api.patch(`/content/documents/${editing.slug}`, {
        title: title.trim(),
        content,
        fileUrl: fileUrl.trim() || undefined,
      });
      setData((prev) =>
        (prev || []).map((d) =>
          d.id === editing.id
            ? {
                ...d,
                title: title.trim(),
                content,
                file_url: fileUrl.trim() || null,
                updated_at: new Date().toISOString(),
              }
            : d,
        ),
      );
      await afterDocumentMutation(queryClient);
      toast.success("Document saved");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save document");
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<DocumentRow>[] = [
    {
      key: "title",
      header: "Title",
      cell: (d) => <span className="font-medium">{d.title}</span>,
    },
    {
      key: "slug",
      header: "Slug",
      cell: (d) => <span className="text-sm text-[var(--keepers-muted)]">{d.slug}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (d) => (
        <StatusBadge status={d.is_published === false ? "draft" : "published"} />
      ),
    },
    {
      key: "updated",
      header: "Updated",
      cell: (d) => formatDateTime(d.updated_at),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (d) => (
        <RowActions actions={[{ label: "Edit", onClick: () => startEdit(d) }]} />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Club policies and published documents."
      />

      <DataTable
        columns={columns}
        rows={data || []}
        loading={loading}
        refreshing={refreshing}
        error={error}
        emptyTitle="No published documents"
        emptyDescription="Published documents from the content API will list here."
        onRowClick={startEdit}
      />

      <Drawer
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit · ${editing.slug}` : "Document"}
        wide
        footer={
          <>
            <button type="submit" form="document-form" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save document"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </>
        }
      >
        <form id="document-form" onSubmit={save} className="space-y-4">
          <FormField label="Title">
            <input
              className="admin-input"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
          <FormField label="Content">
            <textarea
              className="admin-textarea min-h-[12rem]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </FormField>
          <MediaPicker
            label="File"
            bucket="documents"
            value={fileUrl}
            onChange={setFileUrl}
          />
        </form>
      </Drawer>
    </div>
  );
}
