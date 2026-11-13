"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { FormField } from "@/components/ui/FormField";
import { Alert } from "@/components/ui/Alert";

const BUCKETS = ["gallery", "trips", "sponsors", "documents", "avatars", "vehicles"] as const;

type UploadResult = {
  publicUrl?: string;
  path?: string;
  bucket?: string;
};

export default function MediaPage() {
  const toast = useToast();
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]>("gallery");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [history, setHistory] = useState<UploadResult[]>([]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file to upload");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bucket", bucket);
      const data = await api.upload<UploadResult>("/content/media/upload", fd);
      setResult(data);
      setHistory((prev) => [data, ...prev].slice(0, 12));
      setFile(null);
      toast.success("Upload complete");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Upload failed";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Media"
        subtitle="Upload images, video, or PDFs. Content editors can also upload directly from drawers."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <form onSubmit={onSubmit} className="panel space-y-5 p-6">
          <FormField label="Bucket">
            <select
              className="admin-select"
              value={bucket}
              onChange={(e) => setBucket(e.target.value as (typeof BUCKETS)[number])}
            >
              {BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="File" error={error}>
            <input
              className="admin-input"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </FormField>

          {result ? (
            <Alert tone="success">
              Uploaded to <strong>{result.bucket}</strong>
              {result.publicUrl ? (
                <>
                  {" · "}
                  <a href={result.publicUrl} target="_blank" rel="noreferrer" className="underline">
                    Open public URL
                  </a>
                </>
              ) : null}
              {result.path ? (
                <div className="mt-2 break-all text-xs opacity-80">{result.path}</div>
              ) : null}
            </Alert>
          ) : null}

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </form>

        <section className="panel p-6">
          <h2 className="font-display m-0 text-2xl">Recent uploads</h2>
          <p className="mt-1 text-sm text-[var(--keepers-muted)]">
            Session history only — use drawers elsewhere to attach assets without leaving the page.
          </p>
          {history.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--keepers-muted)]">No uploads in this session yet.</p>
          ) : (
            <ul className="mt-5 list-none space-y-3 p-0">
              {history.map((item, index) => (
                <li
                  key={`${item.path || item.publicUrl}-${index}`}
                  className="flex items-center gap-3 border-b border-[var(--keepers-line)] pb-3"
                >
                  {item.publicUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.publicUrl} alt="" className="thumb" />
                  ) : (
                    <div className="thumb" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-medium">{item.bucket}</p>
                    {item.publicUrl ? (
                      <a
                        href={item.publicUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-xs text-[var(--keepers-muted)] hover:underline"
                      >
                        {item.publicUrl}
                      </a>
                    ) : null}
                  </div>
                  {item.publicUrl ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(item.publicUrl || "");
                        toast.success("URL copied");
                      }}
                    >
                      Copy
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
