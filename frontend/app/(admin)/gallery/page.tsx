"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useToast } from "@/lib/toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyBlock, ErrorBlock } from "@/components/ui/StateBlock";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type GalleryItem = {
  id: string;
  image: string;
  caption?: string | null;
  displayOrder?: number;
  isActive?: boolean;
};

export default function GalleryPage() {
  const toast = useToast();
  const { data, error, loading, refreshing, reload, setData } = useAsync(
    () => api.get<GalleryItem[]>("/content/gallery?activeOnly=false"),
    [],
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [active, setActive] = useState<GalleryItem | null>(null);
  const [image, setImage] = useState("");
  const [caption, setCaption] = useState("");
  const [order, setOrder] = useState("0");
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function createItem(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/content/gallery", {
        image: image.trim(),
        caption: caption.trim() || undefined,
        displayOrder: Number(order) || 0,
        isActive: true,
      });
      toast.success("Gallery item saved");
      setDrawerOpen(false);
      setImage("");
      setCaption("");
      setOrder("0");
      await reload();
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
      toast.success("Gallery item removed");
      setDeleteId(null);
      if (active?.id === id) setActive(null);
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
          <button type="button" className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
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
              onClick={() => setActive(item)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.image}
                alt={item.caption || "Gallery"}
                className="h-40 w-full object-cover"
              />
              <div className="flex items-center justify-between gap-2 p-4">
                <p className="m-0 text-sm text-[var(--keepers-muted)]">
                  {item.caption || "No caption"}
                </p>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteId(item.id);
                  }}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Add gallery photo"
        footer={
          <>
            <button type="submit" form="gallery-form" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Add to gallery"}
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
        <form id="gallery-form" onSubmit={createItem} className="space-y-4">
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

      <Drawer
        open={Boolean(active)}
        onClose={() => setActive(null)}
        title={active?.caption || "Gallery item"}
        footer={
          active ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setDeleteId(active.id)}
            >
              Remove
            </button>
          ) : null
        }
      >
        {active ? (
          <div className="space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.image} alt="" className="w-full object-cover" />
            <dl className="detail-grid">
              <div>
                <dt>Order</dt>
                <dd>{active.displayOrder ?? 0}</dd>
              </div>
              <div>
                <dt>Active</dt>
                <dd>{active.isActive === false ? "No" : "Yes"}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Remove gallery item?"
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
