"use client";

import { FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterGalleryMutation } from "@/lib/invalidate";
import { useToast } from "@/lib/toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyBlock, ErrorBlock } from "@/components/ui/StateBlock";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RowActions } from "@/components/ui/RowActions";

type GalleryItem = {
  id: string;
  image: string;
  caption?: string | null;
  tripId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
};

export default function GalleryPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, error, loading, refreshing, setData } = useAdminQuery(
    queryKeys.content.gallery(),
    (signal) => api.get<GalleryItem[]>("/content/gallery?activeOnly=false", { signal }),
    { staleTime: stale.content },
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<GalleryItem | null>(null);
  const [image, setImage] = useState("");
  const [caption, setCaption] = useState("");
  const [order, setOrder] = useState("0");
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setImage("");
    setCaption("");
    setOrder("0");
    setDrawerOpen(true);
  }

  function openEdit(item: GalleryItem) {
    setEditing(item);
    setImage(item.image || "");
    setCaption(item.caption || "");
    setOrder(String(item.displayOrder ?? 0));
    setDrawerOpen(true);
  }

  function closeDrawer() {
    if (busy) return;
    setDrawerOpen(false);
  }

  async function saveItem(e: FormEvent) {
    e.preventDefault();
    if (!image.trim()) {
      toast.error("Image is required");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      await api.post("/content/gallery", {
        id: editing?.id,
        image: image.trim(),
        caption: caption.trim() || undefined,
        displayOrder: Number(order) || 0,
        isActive: editing?.isActive ?? true,
        tripId: editing?.tripId || undefined,
      });
      toast.success(editing ? "Gallery item updated" : "Gallery item saved");
      setDrawerOpen(false);
      setEditing(null);
      await afterGalleryMutation(queryClient);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save item");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.delete(`/content/gallery/${id}`);
      setData((prev) => (prev || []).filter((item) => item.id !== id));
      await afterGalleryMutation(queryClient);
      toast.success("Gallery item removed");
      setDeleteId(null);
      if (editing?.id === id) {
        setDrawerOpen(false);
        setEditing(null);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove item");
    } finally {
      setBusy(false);
    }
  }

  const items = data || [];

  return (
    <div>
      <PageHeader
        title="Gallery"
        subtitle="Photo strip content shown on the Keepers home experience."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            Add photo
          </button>
        }
      />

      {loading && items.length === 0 ? <TableSkeleton rows={3} cols={3} /> : null}
      {error && items.length === 0 ? <ErrorBlock message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyBlock title="No gallery items" description="Add the first photo to get started." />
      ) : null}

      {items.length > 0 ? (
        <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${refreshing ? "table-refreshing" : ""}`}>
          {items.map((item) => (
            <article
              key={item.id}
              className="panel cursor-pointer overflow-hidden"
              onClick={() => openEdit(item)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.caption || "Gallery"}
                className="h-40 w-full object-cover"
              />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="m-0 text-sm text-[var(--keepers-muted)]">
                    {item.caption || "No caption"}
                  </p>
                  <StatusBadge status={item.isActive === false ? "draft" : "active"} />
                </div>
                <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--keepers-muted)]">
                  Order {item.displayOrder ?? 0}
                </p>
                <div className="mt-3">
                  <RowActions
                    actions={[
                      { label: "Edit", onClick: () => openEdit(item) },
                      {
                        label: "Remove",
                        onClick: () => setDeleteId(item.id),
                        tone: "danger",
                      },
                    ]}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        title={editing ? "Edit gallery photo" : "Add gallery photo"}
        subtitle={
          editing
            ? "Replace the image or update caption/order. Saving keeps the same gallery ID."
            : undefined
        }
        footer={
          <>
            <button
              type="submit"
              form="gallery-form"
              className="btn btn-primary"
              disabled={busy || !image.trim()}
            >
              {busy ? "Saving…" : editing ? "Update photo" : "Add to gallery"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={closeDrawer}
            >
              Cancel
            </button>
          </>
        }
      >
        <form id="gallery-form" onSubmit={saveItem} className="space-y-4">
          <MediaPicker label="Image" bucket="gallery" value={image} onChange={setImage} />
          <FormField label="Caption">
            <input
              className="admin-input"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
            />
          </FormField>
          <FormField label="Display order">
            <input
              className="admin-input"
              type="number"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            />
          </FormField>
        </form>
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Remove gallery item?"
        description="The photo will be removed from the gallery listing."
        confirmLabel="Remove"
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
