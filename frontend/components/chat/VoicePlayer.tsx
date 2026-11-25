"use client";

import { useEffect, useRef, useState } from "react";

function formatMs(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VoicePlayer({
  url,
  durationMs,
}: {
  url?: string | null;
  durationMs?: number | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(durationMs || 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setError(null);
    setDuration(durationMs || 0);
  }, [url, durationMs]);

  if (!url) {
    return <p className="m-0 text-sm text-[var(--keepers-muted)]">Voice unavailable</p>;
  }

  async function toggle() {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (playing) {
        el.pause();
        setPlaying(false);
        return;
      }
      await el.play();
      setPlaying(true);
      setError(null);
    } catch {
      setError("Could not play voice message");
      setPlaying(false);
    }
  }

  return (
    <div className="flex min-w-[200px] items-center gap-3">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={() => {
          const el = audioRef.current;
          if (el && Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(el.duration * 1000);
          }
        }}
        onTimeUpdate={() => {
          const el = audioRef.current;
          if (!el || !el.duration) return;
          setProgress(el.currentTime / el.duration);
        }}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onError={() => setError("Failed to load audio")}
      />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void toggle()}>
        {playing ? "Pause" : "Play"}
      </button>
      <div className="min-w-0 flex-1">
        <div className="h-1.5 overflow-hidden rounded bg-[var(--keepers-border)]">
          <div
            className="h-full bg-[var(--keepers-black)] transition-[width]"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <p className="m-0 mt-1 text-[11px] text-[var(--keepers-muted)]">
          {error || formatMs((duration || 0) * (playing || progress > 0 ? progress : 1))}
          {duration ? ` / ${formatMs(duration)}` : ""}
        </p>
      </div>
    </div>
  );
}
