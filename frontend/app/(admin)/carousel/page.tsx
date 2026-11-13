"use client";

import { FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterCarouselMutation } from "@/lib/invalidate";
import { useToast } from "@/lib/toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyBlock, ErrorBlock } from "@/components/ui/StateBlock";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { MediaPicker } from "@/components/ui/MediaPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { StatusBadge } from "@/components/ui/StatusBadge";

type HeroSlide = {
  id: string;
  title?: string | null;
  subtitle?: string | null;
  image: string;
  tripId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
};

export default function CarouselPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, error, loading, refreshing, setData } = useAdminQuery(
    queryKeys.content.carousel(),
    (signal) => api.get<HeroSlide[]>("/content/hero-slides?activeOnly=false", { signal }),
    { staleTime: stale.content },
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [active, setActive] = useState<HeroSlide | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [image, setImage] = useState("");
  const [order, setOrder] = useState("0");
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  async function createSlide(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/content/hero-slides", {
        title: title.trim() || undefined,
        subtitle: subtitle.trim() || undefined,
        image: image.trim(),
        displayOrder: Number(order) || 0,
        isActive: true,
      });
      toast.success("Carousel slide saved");
      setDrawerOpen(false);
      setTitle("");
      setSubtitle("");
      setImage("");
      setOrder("0");
      await afterCarouselMutation(queryClient);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save slide");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.delete(`/content/hero-slides/${id}`);
      setData((prev) =>
        (prev || []).map((slide) =>
          slide.id === id ? { ...slide, isActive: false } : slide,
        ),
      );
      await afterCarouselMutation(queryClient);
      toast.success("Slide deactivated");
      setDeleteId(null);
      if (active?.id === id) setActive((prev) => (prev ? { ...prev, isActive: false } : prev));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove slide");
    } finally {
      setBusy(false);
    }
  }

  const items = data || [];

  return (
    <div>
      <PageHeader
        title="Carousel"
        subtitle="Home hero slides shown in the Keepers mobile app."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
            Add slide
          </button>
        }
      />

      {loading && items.length === 0 ? <TableSkeleton rows={3} cols={3} /> : null}
      {error && items.length === 0 ? <ErrorBlock message={error} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyBlock title="No carousel slides" description="Add the first home hero to get started." />
      ) : null}

      {items.length > 0 ? (
        <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${refreshing ? "table-refreshing" : ""}`}>
          {items.map((slide) => (
            <article
              key={slide.id}
              className="panel cursor-pointer overflow-hidden"
              onClick={() => setActive(slide)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slide.image}
                alt={slide.title || "Carousel slide"}
                className="h-40 w-full object-cover"
              />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display m-0 text-xl">{slide.title || "Untitled"}</p>
                  <StatusBadge status={slide.isActive === false ? "draft" : "active"} />
                </div>
                {slide.subtitle ? (
                  <p className="mt-1 text-sm text-[var(--keepers-muted)]">{slide.subtitle}</p>
                ) : null}
                <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--keepers-muted)]">
                  Order {slide.displayOrder ?? 0}
                </p>
                {slide.isActive !== false ? (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm mt-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteId(slide.id);
                    }}
                  >
                    Deactivate
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Add carousel slide"
        footer={
          <>
            <button type="submit" form="carousel-form" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Add slide"}
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
        <form id="carousel-form" onSubmit={createSlide} className="space-y-4">
          <FormField label="Title">
            <input className="admin-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <FormField label="Subtitle">
            <input
              className="admin-input"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
          </FormField>
          <MediaPicker label="Image" bucket="gallery" value={image} onChange={setImage} />
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
        title={active?.title || "Carousel slide"}
        subtitle={active?.subtitle || undefined}
        footer={
          active && active.isActive !== false ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setDeleteId(active.id)}
            >
              Deactivate
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
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={active.isActive === false ? "draft" : "active"} />
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Deactivate slide?"
        description="The slide will no longer appear in the app carousel."
        confirmLabel="Deactivate"
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
