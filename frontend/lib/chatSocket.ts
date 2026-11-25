"use client";

import { io, type Socket } from "socket.io-client";
import { getStoredToken } from "./api";
import { chatSocketOrigin } from "./chatApi";
import type { ChatMessage } from "./chatTypes";

type Handlers = {
  onMessageNew?: (message: ChatMessage) => void;
  onMessageDeleted?: (payload: { messageId: string; conversationId: string }) => void;
  onReady?: (payload: { userId: string }) => void;
  onError?: (err: Error) => void;
};

let shared: Socket | null = null;
let joinedConversationId: string | null = null;

export function getChatSocket(): Socket | null {
  return shared;
}

export function connectChatSocket(handlers: Handlers = {}): Socket {
  const token = getStoredToken();
  if (!token) {
    throw new Error("Not authenticated");
  }

  if (shared?.connected) {
    attachHandlers(shared, handlers);
    return shared;
  }

  if (shared) {
    shared.removeAllListeners();
    shared.disconnect();
    shared = null;
  }

  const socket = io(chatSocketOrigin(), {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 12,
  });

  attachHandlers(socket, handlers);
  shared = socket;
  return socket;
}

function attachHandlers(socket: Socket, handlers: Handlers) {
  socket.off("chat:ready");
  socket.off("chat:message.new");
  socket.off("chat:message.deleted");
  socket.off("connect_error");

  if (handlers.onReady) {
    socket.on("chat:ready", handlers.onReady);
  }
  if (handlers.onMessageNew) {
    socket.on("chat:message.new", (payload: { message: ChatMessage }) => {
      if (payload?.message) handlers.onMessageNew?.(payload.message);
    });
  }
  if (handlers.onMessageDeleted) {
    socket.on("chat:message.deleted", handlers.onMessageDeleted);
  }
  if (handlers.onError) {
    socket.on("connect_error", (err) => handlers.onError?.(err));
  }
}

export function joinChatConversation(conversationId: string): Promise<void> {
  const socket = shared;
  if (!socket) return Promise.reject(new Error("Socket not connected"));
  return new Promise((resolve, reject) => {
    socket.emit(
      "chat:join",
      { conversationId },
      (ack: { ok?: boolean; error?: string | { message?: string } }) => {
        if (ack?.ok) {
          joinedConversationId = conversationId;
          resolve();
        } else {
          const msg =
            typeof ack?.error === "string"
              ? ack.error
              : ack?.error?.message || "Failed to join conversation";
          reject(new Error(msg));
        }
      },
    );
  });
}

export function leaveChatConversation(conversationId?: string): Promise<void> {
  const socket = shared;
  const id = conversationId || joinedConversationId;
  if (!socket || !id) return Promise.resolve();
  return new Promise((resolve) => {
    socket.emit("chat:leave", { conversationId: id }, () => {
      if (joinedConversationId === id) joinedConversationId = null;
      resolve();
    });
  });
}

export function setChatViewing(conversationId: string, viewing: boolean) {
  shared?.emit("chat:presence.viewing", { conversationId, viewing });
}

export function disconnectChatSocket() {
  if (!shared) return;
  shared.removeAllListeners();
  shared.disconnect();
  shared = null;
  joinedConversationId = null;
}
