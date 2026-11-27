import { api, getApiBase, uploadWithProgress, type UploadProgress } from "./api";
import type {
  ChatReport,
  ChatReportStatus,
  ChatReportType,
  ReviewReportAction,
} from "./chatModeration";
import type { ChatAttachment, ChatInboxItem, ChatMessage } from "./chatTypes";

export function chatSocketOrigin(): string {
  return getApiBase().replace(/\/api\/?$/, "");
}

export function newClientMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function fetchChatInbox(limit = 50) {
  return api.get<{ items: ChatInboxItem[] }>(`/chat/inbox?limit=${limit}`);
}

export async function fetchChatMessages(
  conversationId: string,
  params: { before?: string; after?: string; limit?: number } = {},
) {
  const qs = new URLSearchParams();
  if (params.before) qs.set("before", params.before);
  if (params.after) qs.set("after", params.after);
  qs.set("limit", String(params.limit ?? 50));
  return api.get<{ items: ChatMessage[]; nextBefore: string | null }>(
    `/chat/conversations/${conversationId}/messages?${qs.toString()}`,
  );
}

export async function sendChatMessage(
  conversationId: string,
  payload: {
    messageType: ChatMessage["type"];
    content?: string;
    clientMessageId: string;
    attachmentId?: string;
  },
) {
  return api.post<ChatMessage>(`/chat/conversations/${conversationId}/messages`, payload);
}

export async function uploadChatAttachment(
  conversationId: string,
  file: File,
  fields: {
    kind: "image" | "video" | "voice";
    durationMs?: number;
    width?: number;
    height?: number;
    waveform?: number[];
  },
  onProgress?: (p: UploadProgress) => void,
) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kind", fields.kind);
  if (fields.durationMs != null) fd.append("durationMs", String(fields.durationMs));
  if (fields.width != null) fd.append("width", String(fields.width));
  if (fields.height != null) fd.append("height", String(fields.height));
  if (fields.waveform) fd.append("waveform", JSON.stringify(fields.waveform));
  return uploadWithProgress<ChatAttachment>(
    `/chat/conversations/${conversationId}/attachments`,
    fd,
    onProgress,
  );
}

export async function markConversationRead(conversationId: string, upToMessageId?: string) {
  return api.post(`/chat/conversations/${conversationId}/read`, {
    upToMessageId: upToMessageId || null,
  });
}

export async function softDeleteChatMessage(messageId: string) {
  return api.delete(`/chat/messages/${messageId}`);
}

export async function fetchChatReports(params: {
  status?: ChatReportStatus | "";
  reportType?: ChatReportType | "";
  page?: number;
  limit?: number;
} = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.reportType) qs.set("reportType", params.reportType);
  qs.set("page", String(params.page ?? 1));
  qs.set("limit", String(params.limit ?? 20));
  return api.get<{
    items: ChatReport[];
    page: number;
    limit: number;
    total: number;
  }>(`/chat/reports?${qs.toString()}`);
}

export async function fetchChatReport(id: string) {
  return api.get<ChatReport>(`/chat/reports/${id}`);
}

export async function reviewChatReport(
  id: string,
  payload: { action: ReviewReportAction; reviewNotes?: string | null },
) {
  return api.patch<ChatReport>(`/chat/reports/${id}`, payload);
}

export async function fetchModerationActions(params: {
  page?: number;
  limit?: number;
} = {}) {
  const qs = new URLSearchParams();
  qs.set("page", String(params.page ?? 1));
  qs.set("limit", String(params.limit ?? 30));
  return api.get<{
    items: Array<{
      id: string;
      action: string;
      conversationId?: string | null;
      messageId?: string | null;
      targetUserId?: string | null;
      reason?: string | null;
      metadata?: unknown;
      createdAt: string;
      actor: { id: string; name?: string | null };
      targetUser?: { id: string; name?: string | null } | null;
    }>;
    page: number;
    limit: number;
    total: number;
  }>(`/chat/moderation-actions?${qs.toString()}`);
}

export function pickVoiceMime(): { mimeType: string; ext: string } {
  if (typeof MediaRecorder === "undefined") {
    return { mimeType: "audio/webm", ext: "webm" };
  }
  const candidates: Array<{ mimeType: string; ext: string }> = [
    { mimeType: "audio/mp4", ext: "m4a" },
    { mimeType: "audio/aac", ext: "aac" },
    { mimeType: "audio/mpeg", ext: "mp3" },
    { mimeType: "audio/webm;codecs=opus", ext: "webm" },
    { mimeType: "audio/webm", ext: "webm" },
    { mimeType: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "audio/webm", ext: "webm" };
}

export function kindFromFile(file: File): "image" | "video" | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return null;
}
