"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/chatTypes";
import { VoicePlayer } from "./VoicePlayer";

export function ChatMessageBubble({
  message,
  isMine,
  onDelete,
}: {
  message: ChatMessage;
  isMine: boolean;
  onDelete?: (id: string) => void;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const att = message.attachments?.[0];
  const failed = message.localStatus === "failed";
  const sending = message.localStatus === "sending";

  return (
    <>
      <div
        className={[
          "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
          isMine
            ? "ml-auto border-[var(--keepers-black)]/20 bg-[var(--keepers-cream)]"
            : "mr-auto border-[var(--keepers-border)] bg-white",
          failed ? "opacity-80 ring-1 ring-red-400" : "",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="m-0 text-[11px] uppercase tracking-[0.12em] text-[var(--keepers-muted)]">
            {message.sender?.name || (message.type === "system" ? "System" : "Unknown")}
            {sending ? " · sending" : ""}
            {failed ? " · failed" : ""}
            {message.deletedAt ? " · deleted" : ""}
          </p>
          {!message.deletedAt && onDelete ? (
            <button
              type="button"
              className="shrink-0 text-[11px] uppercase tracking-wide underline"
              onClick={() => onDelete(message.id)}
            >
              Delete
            </button>
          ) : null}
        </div>

        <div className="mt-2">
          {message.deletedAt ? (
            <p className="m-0 italic text-[var(--keepers-muted)]">Message deleted</p>
          ) : message.type === "text" || message.type === "system" ? (
            <p className="m-0 whitespace-pre-wrap break-words">{message.content}</p>
          ) : message.type === "image" ? (
            att?.url ? (
              <button
                type="button"
                className="block overflow-hidden rounded"
                onClick={() => setLightbox(att.url || null)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={att.url}
                  alt={message.content || "Image"}
                  className="max-h-64 max-w-full object-contain"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).alt = "Failed to load image";
                  }}
                />
              </button>
            ) : (
              <p className="m-0 text-[var(--keepers-muted)]">Image unavailable</p>
            )
          ) : message.type === "video" ? (
            att?.url ? (
              <video
                src={att.url}
                controls
                preload="metadata"
                poster={att.thumbnailUrl || undefined}
                className="max-h-72 max-w-full rounded"
              />
            ) : (
              <p className="m-0 text-[var(--keepers-muted)]">Video unavailable</p>
            )
          ) : message.type === "voice" ? (
            <VoicePlayer url={att?.url} durationMs={att?.durationMs} />
          ) : (
            <p className="m-0">{message.content || `[${message.type}]`}</p>
          )}
        </div>

        <p className="m-0 mt-2 text-[11px] text-[var(--keepers-muted)]">
          {new Date(message.createdAt).toLocaleString()}
        </p>
      </div>

      {lightbox ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightbox(null)}
          role="presentation"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt=""
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
