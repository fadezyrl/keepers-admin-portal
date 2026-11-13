"use client";

import { FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useAdminQuery } from "@/lib/useAdminQuery";
import { queryKeys, stale } from "@/lib/queryKeys";
import { afterRatingMutation, afterSettingsMutation } from "@/lib/invalidate";
import { useToast } from "@/lib/toast";
import type { AppSetting, RatingCriterion } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DataTable, type DataColumn } from "@/components/ui/DataTable";
import { RowActions } from "@/components/ui/RowActions";
import { Drawer } from "@/components/ui/Drawer";
import { FormField } from "@/components/ui/FormField";
import { EmptyBlock, ErrorBlock } from "@/components/ui/StateBlock";
import { TableSkeleton } from "@/components/ui/Skeleton";

export default function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useAdminQuery(
    queryKeys.content.settings(),
    (signal) => api.get<AppSetting[]>("/content/settings", { signal }),
    { staleTime: stale.settings },
  );
  const criteria = useAdminQuery(
    queryKeys.ratings.criteria(),
    (signal) =>
      api.get<RatingCriterion[]>("/ratings/criteria?includeInactive=true", { signal }),
    { staleTime: stale.settings },
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RatingCriterion | null>(null);
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    minScore: "1",
    maxScore: "5",
    displayOrder: "0",
  });
  const [busy, setBusy] = useState(false);

  function settingValue(s: AppSetting) {
    if (drafts[s.key] !== undefined) return drafts[s.key];
    try {
      return typeof s.value === "string" ? s.value : JSON.stringify(s.value, null, 2);
    } catch {
      return String(s.value);
    }
  }

  async function saveSetting(key: string) {
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      const raw = drafts[key];
      let value: unknown = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      await api.patch(`/content/settings/${key}`, { value });
      toast.success(`Saved setting “${key}”`);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await afterSettingsMutation(queryClient);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save setting");
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function openCreate() {
    setEditing(null);
    setForm({
      code: "",
      name: "",
      description: "",
      minScore: "1",
      maxScore: "5",
      displayOrder: "0",
    });
    setDrawerOpen(true);
  }

  function openEdit(c: RatingCriterion) {
    setEditing(c);
    setForm({
      code: c.code,
      name: c.name,
      description: c.description || "",
      minScore: String(c.min_score ?? 1),
      maxScore: String(c.max_score ?? 5),
      displayOrder: String(c.display_order ?? 0),
    });
    setDrawerOpen(true);
  }

  async function saveCriterion(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/ratings/criteria", {
        id: editing?.id,
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        minScore: Number(form.minScore) || 1,
        maxScore: Number(form.maxScore) || 5,
        displayOrder: Number(form.displayOrder) || 0,
        isActive: editing?.is_active !== false,
      });
      toast.success(editing ? "Criterion updated" : "Criterion created");
      setDrawerOpen(false);
      await afterRatingMutation(queryClient);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save criterion");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(c: RatingCriterion) {
    try {
      await api.post("/ratings/criteria", {
        id: c.id,
        code: c.code,
        name: c.name,
        description: c.description || undefined,
        minScore: c.min_score ?? 1,
        maxScore: c.max_score ?? 5,
        displayOrder: c.display_order ?? 0,
        isActive: c.is_active === false,
      });
      criteria.setData((prev) =>
        (prev || []).map((row) =>
          row.id === c.id ? { ...row, is_active: c.is_active === false } : row,
        ),
      );
      await afterRatingMutation(queryClient);
      toast.success(c.is_active === false ? "Criterion activated" : "Criterion deactivated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update criterion");
    }
  }

  const columns: DataColumn<RatingCriterion>[] = [
    {
      key: "code",
      header: "Code",
      cell: (c) => <span className="font-mono text-sm">{c.code}</span>,
    },
    {
      key: "name",
      header: "Name",
      cell: (c) => (
        <div>
          <div className="font-medium">{c.name}</div>
          {c.description ? (
            <div className="text-sm text-[var(--keepers-muted)]">{c.description}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "range",
      header: "Range",
      cell: (c) => (
        <>
          {c.min_score}–{c.max_score}
        </>
      ),
    },
    {
      key: "active",
      header: "Active",
      cell: (c) => <StatusBadge status={c.is_active === false ? "draft" : "active"} />,
    },
    {
      key: "actions",
      header: "Actions",
      cell: (c) => (
        <RowActions
          actions={[
            { label: "Edit", onClick: () => openEdit(c) },
            {
              label: c.is_active === false ? "Activate" : "Deactivate",
              onClick: () => void toggleActive(c),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Application settings and marshall rating criteria."
      />

      <section className="mb-12">
        <h2 className="font-display mb-4 text-2xl">App settings</h2>
        {settings.loading ? <TableSkeleton rows={3} cols={1} /> : null}
        {settings.error ? <ErrorBlock message={settings.error} /> : null}
        {!settings.loading && !settings.error && (settings.data || []).length === 0 ? (
          <EmptyBlock
            title="No settings"
            description="Keys from app_settings will appear once seeded."
          />
        ) : null}
        {!settings.loading && !settings.error && (settings.data || []).length > 0 ? (
          <div className="space-y-4">
            {settings.data!.map((s) => (
              <article key={s.key} className="panel p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="m-0 font-mono text-sm tracking-wide">{s.key}</h3>
                  {s.description ? (
                    <p className="m-0 text-sm text-[var(--keepers-muted)]">{s.description}</p>
                  ) : null}
                </div>
                <textarea
                  className="admin-textarea mt-3 font-mono text-sm"
                  value={settingValue(s)}
                  onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-secondary mt-3"
                  disabled={busyKeys.has(s.key) || drafts[s.key] === undefined}
                  onClick={() => void saveSetting(s.key)}
                >
                  {busyKeys.has(s.key) ? "Saving…" : "Save"}
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display m-0 text-2xl">Rating criteria</h2>
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            Add criterion
          </button>
        </div>
        <DataTable
          columns={columns}
          rows={criteria.data || []}
          loading={criteria.loading}
          refreshing={criteria.refreshing}
          error={criteria.error}
          emptyTitle="No criteria"
          emptyDescription="Add scoring dimensions to get started."
          onRowClick={openEdit}
        />
      </section>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? "Edit criterion" : "Add criterion"}
        footer={
          <>
            <button type="submit" form="criterion-form" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
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
        <form id="criterion-form" onSubmit={saveCriterion} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Code">
            <input
              className="admin-input"
              required
              disabled={Boolean(editing)}
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </FormField>
          <FormField label="Name">
            <input
              className="admin-input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </FormField>
          <FormField label="Description" className="sm:col-span-2">
            <input
              className="admin-input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </FormField>
          <FormField label="Min score">
            <input
              className="admin-input"
              type="number"
              value={form.minScore}
              onChange={(e) => setForm({ ...form, minScore: e.target.value })}
            />
          </FormField>
          <FormField label="Max score">
            <input
              className="admin-input"
              type="number"
              value={form.maxScore}
              onChange={(e) => setForm({ ...form, maxScore: e.target.value })}
            />
          </FormField>
        </form>
      </Drawer>
    </div>
  );
}
