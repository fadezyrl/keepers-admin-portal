"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { DocumentRow } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";

export default function DocumentsPage() {
  const { data, error, loading, reload } = useAsync(
    () => api.get<DocumentRow[]>("/content/documents"),
    [],
  );
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(doc: DocumentRow) {
    setEditing(doc);
    setTitle(doc.title || "");
    setContent(doc.content || "");
    setFileUrl(doc.file_url || "");
    setMessage(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.patch(`/content/documents/${editing.slug}`, {
        title: title.trim(),
        content,
        fileUrl: fileUrl.trim() || undefined,
      });
      setMessage("Document saved");
      setEditing(null);
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to save document");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle="Club policies and published documents."
      />

      {message ? (
        <div className="mb-6">
          <Alert>{message}</Alert>
        </div>
      ) : null}

      {editing ? (
        <form onSubmit={save} className="panel mb-8 space-y-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display m-0 text-2xl">Edit · {editing.slug}</h2>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
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
              Content
            </span>
            <textarea
              className="admin-textarea min-h-[12rem]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              File URL
            </span>
            <input
              className="admin-input"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save document
          </button>
        </form>
      ) : null}

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      {!loading && !error && (data || []).length === 0 ? (
        <EmptyBlock
          title="No published documents"
          description="Published documents from the content API will list here."
        />
      ) : null}

      {!loading && !error && (data || []).length > 0 ? (
        <div className="panel overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data!.map((d) => (
                <tr key={d.id}>
                  <td className="font-medium">{d.title}</td>
                  <td className="text-sm text-[var(--keepers-muted)]">{d.slug}</td>
                  <td>{formatDateTime(d.updated_at)}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => startEdit(d)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
