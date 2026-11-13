"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { FormField } from "./FormField";

const BUCKETS = ["gallery", "trips", "sponsors", "documents", "avatars", "vehicles"] as const;

export function MediaPicker({
  label = "Image",
  value,
  onChange,
  bucket = "gallery",
  allowUrl = true,
}: {
  label?: string;
  value: string;
  onChange: (url: string) => void;
  bucket?: (typeof BUCKETS)[number];
  allowUrl?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("bucket", bucket);
      const data = await api.upload<{ publicUrl: string }>("/content/media/upload", fd);
      onChange(data.publicUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {allowUrl ? (
        <FormField label={`${label} URL`} error={error}>
          <input
            className="admin-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…"
          />
        </FormField>
      ) : null}
      <FormField label={allowUrl ? "Or upload file" : label} error={allowUrl ? null : error}>
        <input
          className="admin-input"
          type="file"
          accept="image/*,video/*,application/pdf"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
      </FormField>
      {busy ? <p className="m-0 text-sm text-[var(--keepers-muted)]">Uploading…</p> : null}
      {value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="thumb" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}>
            Clear
          </button>
        </div>
      ) : null}
    </div>
  );
}
