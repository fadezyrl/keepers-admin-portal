"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import type { Sponsor } from "@/lib/types";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

export default function SponsorsPage() {
  const { data, error, loading, reload } = useAsync(
    () => api.get<Sponsor[]>("/content/sponsors?activeOnly=false"),
    [],
  );
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [logo, setLogo] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createSponsor(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/content/sponsors", {
        name: name.trim(),
        url: url.trim() || undefined,
        logo: logo.trim() || undefined,
        isActive: true,
      });
      setName("");
      setUrl("");
      setLogo("");
      setMessage("Sponsor created");
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to create sponsor");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      await api.delete(`/content/sponsors/${id}`);
      setMessage("Sponsor deleted");
      await reload();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Failed to delete sponsor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Sponsors"
        subtitle="Club partners shown across Keepers surfaces."
      />

      {message ? (
        <div className="mb-6">
          <Alert>{message}</Alert>
        </div>
      ) : null}

      <form onSubmit={createSponsor} className="panel mb-8 grid gap-4 p-6 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
            Name
          </span>
          <input
            className="admin-input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
            Website URL
          </span>
          <input
            className="admin-input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
            Logo URL
          </span>
          <input
            className="admin-input"
            value={logo}
            onChange={(e) => setLogo(e.target.value)}
            placeholder="Optional — upload via Media first"
          />
        </label>
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Add sponsor
          </button>
        </div>
      </form>

      {loading ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}
      {!loading && !error && (data || []).length === 0 ? (
        <EmptyBlock title="No sponsors" description="Add the first partner above." />
      ) : null}

      {!loading && !error && (data || []).length > 0 ? (
        <div className="panel overflow-x-auto">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data!.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-sm">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {s.url}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <StatusBadge status={s.isActive === false ? "draft" : "active"} />
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => remove(s.id)}
                    >
                      Delete
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
