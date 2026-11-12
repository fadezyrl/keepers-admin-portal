"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { AppSetting, RatingCriterion } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function SettingsPage() {
  const settings = useAsync(() => api.get<AppSetting[]>("/content/settings"), []);
  const criteria = useAsync(
    () => api.get<RatingCriterion[]>("/ratings/criteria?includeInactive=true"),
    [],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [critForm, setCritForm] = useState({
    code: "",
    name: "",
    description: "",
    minScore: "1",
    maxScore: "5",
    displayOrder: "0",
  });
  const [message, setMessage] = useState<string | null>(null);
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
    setBusy(true);
    setMessage(null);
    try {
      const raw = drafts[key];
      let value: unknown = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
      await api.patch(`/content/settings/${key}`, { value });
      setMessage(`Saved setting “${key}”`);
      await settings.reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to save setting");
    } finally {
      setBusy(false);
    }
  }

  async function createCriterion(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/ratings/criteria", {
        code: critForm.code.trim(),
        name: critForm.name.trim(),
        description: critForm.description.trim() || undefined,
        minScore: Number(critForm.minScore) || 1,
        maxScore: Number(critForm.maxScore) || 5,
        displayOrder: Number(critForm.displayOrder) || 0,
        isActive: true,
      });
      setCritForm({
        code: "",
        name: "",
        description: "",
        minScore: "1",
        maxScore: "5",
        displayOrder: "0",
      });
      setMessage("Rating criterion saved");
      await criteria.reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to save criterion");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Application settings and marshall rating criteria."
      />

      {message ? (
        <div className="mb-6">
          <Alert>{message}</Alert>
        </div>
      ) : null}

      <section className="mb-12">
        <h2 className="font-display mb-4 text-2xl">App settings</h2>
        {settings.loading ? <LoadingBlock /> : null}
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
                  disabled={busy || drafts[s.key] === undefined}
                  onClick={() => saveSetting(s.key)}
                >
                  Save
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="font-display mb-4 text-2xl">Rating criteria</h2>

        <form
          onSubmit={createCriterion}
          className="panel mb-6 grid gap-4 p-6 sm:grid-cols-2"
        >
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Code
            </span>
            <input
              className="admin-input"
              required
              value={critForm.code}
              onChange={(e) => setCritForm({ ...critForm, code: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Name
            </span>
            <input
              className="admin-input"
              required
              value={critForm.name}
              onChange={(e) => setCritForm({ ...critForm, name: e.target.value })}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Description
            </span>
            <input
              className="admin-input"
              value={critForm.description}
              onChange={(e) => setCritForm({ ...critForm, description: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Min score
            </span>
            <input
              className="admin-input"
              type="number"
              value={critForm.minScore}
              onChange={(e) => setCritForm({ ...critForm, minScore: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
              Max score
            </span>
            <input
              className="admin-input"
              type="number"
              value={critForm.maxScore}
              onChange={(e) => setCritForm({ ...critForm, maxScore: e.target.value })}
            />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Add criterion
            </button>
          </div>
        </form>

        {criteria.loading ? <LoadingBlock /> : null}
        {criteria.error ? <ErrorBlock message={criteria.error} /> : null}
        {!criteria.loading && !criteria.error && (criteria.data || []).length === 0 ? (
          <EmptyBlock title="No criteria" description="Add scoring dimensions above." />
        ) : null}
        {!criteria.loading && !criteria.error && (criteria.data || []).length > 0 ? (
          <div className="panel overflow-x-auto">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Range</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {criteria.data!.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-sm">{c.code}</td>
                    <td>
                      <div className="font-medium">{c.name}</div>
                      {c.description ? (
                        <div className="text-sm text-[var(--keepers-muted)]">{c.description}</div>
                      ) : null}
                    </td>
                    <td>
                      {c.min_score}–{c.max_score}
                    </td>
                    <td>
                      <StatusBadge status={c.is_active === false ? "draft" : "active"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
