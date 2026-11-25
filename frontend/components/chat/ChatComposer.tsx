"use client";

import { useEffect, useRef, useState } from "react";
import {
  kindFromFile,
  newClientMessageId,
  pickVoiceMime,
  sendChatMessage,
  uploadChatAttachment,
} from "@/lib/chatApi";
import type { ChatMessage } from "@/lib/chatTypes";
import { ApiError } from "@/lib/api";
import { prepareBrowserFile } from "@/lib/mediaCompress";
import { VoicePlayer } from "./VoicePlayer";

type Props = {
  conversationId: string;
  disabled?: boolean;
  onOptimistic: (message: ChatMessage) => void;
  onSent: (tempId: string, message: ChatMessage) => void;
  onFailed: (tempId: string) => void;
};

export function ChatComposer({
  conversationId,
  disabled,
  onOptimistic,
  onSent,
  onFailed,
}: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const [pendingVoice, setPendingVoice] = useState<{
    blob: Blob;
    url: string;
    durationMs: number;
    mimeType: string;
    ext: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordStartedAt = useRef(0);
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
      if (pendingVoice?.url) URL.revokeObjectURL(pendingVoice.url);
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function makeOptimistic(
    partial: Partial<ChatMessage> & {
      type: ChatMessage["type"];
      clientMessageId: string;
    },
  ): ChatMessage {
    return {
      id: `temp-${partial.clientMessageId}`,
      conversationId,
      clientMessageId: partial.clientMessageId,
      type: partial.type,
      content: partial.content ?? null,
      attachments: partial.attachments || [],
      createdAt: new Date().toISOString(),
      sender: partial.sender || { id: "me", name: "You" },
      localStatus: "sending",
    };
  }

  async function sendText() {
    const content = text.trim();
    if (!content || busy || disabled) return;
    setBusy(true);
    setError(null);
    const clientMessageId = newClientMessageId();
    const optimistic = makeOptimistic({
      type: "text",
      content,
      clientMessageId,
    });
    onOptimistic(optimistic);
    setText("");
    try {
      const sent = await sendChatMessage(conversationId, {
        messageType: "text",
        content,
        clientMessageId,
      });
      onSent(optimistic.id, { ...sent, localStatus: "sent" });
    } catch (err) {
      onFailed(optimistic.id);
      setError(err instanceof ApiError ? err.message : "Failed to send");
    } finally {
      setBusy(false);
    }
  }

  async function sendMediaFile(file: File) {
    const kind = kindFromFile(file);
    if (!kind) {
      setError("Only images and videos are supported");
      return;
    }
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    const clientMessageId = newClientMessageId();
    const localUrl = URL.createObjectURL(file);
    const optimistic = makeOptimistic({
      type: kind,
      clientMessageId,
      attachments: [
        {
          id: `local-${clientMessageId}`,
          kind,
          mimeType: file.type,
          byteSize: file.size,
          url: localUrl,
        },
      ],
    });
    onOptimistic(optimistic);
    try {
      const prepared =
        kind === "image" ? await prepareBrowserFile(file) : file;
      const uploaded = await uploadChatAttachment(
        conversationId,
        prepared,
        { kind },
        (p) => setProgress(p.percent),
      );
      const sent = await sendChatMessage(conversationId, {
        messageType: kind,
        clientMessageId,
        attachmentId: uploaded.id,
      });
      onSent(optimistic.id, { ...sent, localStatus: "sent" });
    } catch (err) {
      onFailed(optimistic.id);
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      URL.revokeObjectURL(localUrl);
      setBusy(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function startRecording() {
    if (busy || disabled || recording) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mimeType, ext } = pickVoiceMime();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType.split(";")[0] });
        const durationMs = Math.max(500, Date.now() - recordStartedAt.current);
        if (pendingVoice?.url) URL.revokeObjectURL(pendingVoice.url);
        setPendingVoice({
          blob,
          url: URL.createObjectURL(blob),
          durationMs,
          mimeType: mimeType.split(";")[0],
          ext,
        });
        setRecording(false);
        if (tickRef.current) window.clearInterval(tickRef.current);
      };
      mediaRecorderRef.current = recorder;
      recordStartedAt.current = Date.now();
      setRecordMs(0);
      tickRef.current = window.setInterval(() => {
        setRecordMs(Date.now() - recordStartedAt.current);
        if (Date.now() - recordStartedAt.current >= 120_000) {
          stopRecording();
        }
      }, 200);
      recorder.start(250);
      setRecording(true);
    } catch {
      setError("Microphone permission denied or unavailable");
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      return;
    }
    recorder.stop();
  }

  function cancelPendingVoice() {
    if (pendingVoice?.url) URL.revokeObjectURL(pendingVoice.url);
    setPendingVoice(null);
  }

  async function sendPendingVoice() {
    if (!pendingVoice || busy || disabled) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    const clientMessageId = newClientMessageId();
    const file = new File(
      [pendingVoice.blob],
      `voice-${Date.now()}.${pendingVoice.ext}`,
      { type: pendingVoice.mimeType },
    );
    const optimistic = makeOptimistic({
      type: "voice",
      clientMessageId,
      attachments: [
        {
          id: `local-${clientMessageId}`,
          kind: "voice",
          mimeType: pendingVoice.mimeType,
          byteSize: file.size,
          durationMs: pendingVoice.durationMs,
          url: pendingVoice.url,
        },
      ],
    });
    onOptimistic(optimistic);
    try {
      const peaks = 24;
      const waveform = Array.from({ length: peaks }, (_, i) =>
        Math.max(0.15, Math.abs(Math.sin(i / 3 + pendingVoice.durationMs / 1000)) * 0.9),
      );
      const uploaded = await uploadChatAttachment(
        conversationId,
        file,
        {
          kind: "voice",
          durationMs: pendingVoice.durationMs,
          waveform,
        },
        (p) => setProgress(p.percent),
      );
      const sent = await sendChatMessage(conversationId, {
        messageType: "voice",
        clientMessageId,
        attachmentId: uploaded.id,
      });
      onSent(optimistic.id, { ...sent, localStatus: "sent" });
      setPendingVoice(null);
    } catch (err) {
      onFailed(optimistic.id);
      setError(err instanceof ApiError ? err.message : "Voice send failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3 border-t border-[var(--keepers-border)] bg-white p-3">
      {error ? (
        <p className="m-0 rounded border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      {progress != null ? (
        <p className="m-0 text-xs text-[var(--keepers-muted)]">Uploading… {progress}%</p>
      ) : null}

      {pendingVoice ? (
        <div className="rounded border border-[var(--keepers-border)] p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--keepers-muted)]">
            Voice preview
          </p>
          <VoicePlayer url={pendingVoice.url} durationMs={pendingVoice.durationMs} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || disabled}
              onClick={() => void sendPendingVoice()}
            >
              Send voice
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={cancelPendingVoice}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <textarea
          className="admin-textarea min-h-[44px] flex-1"
          rows={2}
          placeholder={disabled ? "Conversation is read-only" : "Write a message…"}
          value={text}
          disabled={busy || disabled || recording}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendText();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || disabled || !text.trim() || recording}
          onClick={() => void sendText()}
        >
          Send
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void sendMediaFile(file);
          }}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={busy || disabled || recording}
          onClick={() => fileRef.current?.click()}
        >
          Attach image/video
        </button>
        {!recording ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy || disabled || Boolean(pendingVoice)}
            onClick={() => void startRecording()}
          >
            Record voice
          </button>
        ) : (
          <button type="button" className="btn btn-danger btn-sm" onClick={stopRecording}>
            Stop ({Math.round(recordMs / 1000)}s)
          </button>
        )}
      </div>
    </div>
  );
}
