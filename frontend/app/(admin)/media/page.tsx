"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Alert } from "@/components/ui/Alert";

const BUCKETS = ["gallery", "trips", "sponsors", "documents", "avatars", "vehicles"] as const;

export default function MediaPage() {
  const [bucket, setBucket] = useState<(typeof BUCKETS)[number]>("gallery");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    publicUrl?: string;
    path?: string;
    bucket?: string;
  } | null>(null);

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
      const data = await api.upload<{
        publicUrl: string;
        path: string;
        bucket: string;
      }>("/content/media/upload", fd);
      setResult(data);
      setFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Media"
        subtitle="Upload images, video, or PDFs to Keepers storage buckets."
      />

      <form onSubmit={onSubmit} className="panel max-w-xl space-y-5 p-6">
        <label className="block">
          <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
            Bucket
          </span>
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
        </label>

        <label className="block">
          <span className="mb-2 block text-[0.68rem] tracking-[0.14em] uppercase text-[var(--keepers-muted)]">
            File
          </span>
          <input
            className="admin-input"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>

        {error ? <Alert tone="danger">{error}</Alert> : null}
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
    </div>
  );
}
