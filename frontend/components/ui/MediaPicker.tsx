"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { prepareBrowserFile } from "@/lib/mediaCompress";
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
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  async function uploadFile(file: File) {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setBusy(true);
    setError(null);
    setProgress(0);
    setFailedFile(null);
    try {
      const prepared = await prepareBrowserFile(file);
      const fd = new FormData();
      fd.append("file", prepared);
      fd.append("bucket", bucket);
      const data = await api.uploadWithProgress<{ publicUrl: string }>(
        "/content/media/upload",
        fd,
        (p) => setProgress(p.percent),
      );
      onChange(data.publicUrl);
      setProgress(null);
    } catch (err) {
      setFailedFile(file);
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      uploadingRef.current = false;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onFile(file: File | null) {
    if (!file) return;
    await uploadFile(file);
  }

  return (
    <div className="space-y-3">
      {allowUrl ? (
        <FormField label={`${label} URL`} error={error && !failedFile ? error : null}>
          <input
            className="admin-input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…"
            disabled={busy}
          />
        </FormField>
      ) : null}
      <FormField
        label={allowUrl ? "Or upload file" : label}
        error={allowUrl ? (failedFile ? error : null) : error}
      >
        <input
          ref={inputRef}
          className="admin-input"
          type="file"
          accept="image/*,video/*,application/pdf"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0] || null)}
        />
      </FormField>
      {busy ? (
        <p className="m-0 text-sm text-[var(--keepers-muted)]">
          {progress != null ? `Uploading… ${progress}%` : "Preparing…"}
        </p>
      ) : null}
      {!busy && failedFile ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void uploadFile(failedFile)}
        >
          Retry upload
        </button>
      ) : null}
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
