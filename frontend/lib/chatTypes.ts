export type ChatMessageType = "text" | "image" | "video" | "voice" | "system";

export type ChatAttachment = {
  id: string;
  kind: "image" | "video" | "voice";
  mimeType: string;
  byteSize: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  waveform?: number[] | null;
  thumbnailUrl?: string | null;
  url?: string | null;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  clientMessageId?: string | null;
  type: ChatMessageType;
  content?: string | null;
  replyToMessageId?: string | null;
  sender?: { id: string; name: string; avatar?: string | null } | null;
  attachments: ChatAttachment[];
  createdAt: string;
  editedAt?: string | null;
  deletedAt?: string | null;
  receipt?: { delivered: number; read: number; total: number } | null;
  myReceipt?: { delivered_at?: string | null; read_at?: string | null } | null;
  localStatus?: "sending" | "failed" | "sent";
};

export type ChatInboxItem = {
  id: string;
  type: "group" | "private" | string;
  tripId: string;
  tripTitle: string;
  tripDate?: string;
  lastPreview?: string | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  isReadonly: boolean;
  isArchived: boolean;
};
