"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type InboxItem = {
  id: string;
  type: string;
  tripId: string;
  tripTitle: string;
  tripDate?: string;
  lastPreview?: string | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  isReadonly: boolean;
  isArchived: boolean;
};

type Message = {
  id: string;
  type: string;
  content?: string | null;
  createdAt: string;
  deletedAt?: string | null;
  sender?: { name?: string } | null;
};

export default function ChatModerationPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadInbox = async () => {
    setError(null);
    try {
      const data = await api.get<{ items: InboxItem[] }>("/chat/inbox");
      setItems(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chats");
    }
  };

  const loadMessages = async (id: string) => {
    setSelected(id);
    setBusy(true);
    try {
      const data = await api.get<{ items: Message[] }>(
        `/chat/conversations/${id}/messages?limit=50`,
      );
      setMessages(data.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load messages");
    } finally {
      setBusy(false);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!confirm("Soft-delete this message?")) return;
    await api.delete(`/chat/messages/${messageId}`);
    if (selected) await loadMessages(selected);
  };

  useEffect(() => {
    loadInbox();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-keepers-muted">
          Communication
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-keepers-black">
          Trip chats
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-keepers-muted">
          Moderate group and private trip conversations. Message content in
          private threads is visible only to users with chat.moderate /
          Admin access.
        </p>
      </div>

      {error ? (
        <p className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="border border-keepers-black/15 bg-white">
          <div className="flex items-center justify-between border-b border-keepers-black/10 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              Conversations
            </h2>
            <button
              type="button"
              onClick={loadInbox}
              className="text-xs uppercase tracking-wide underline"
            >
              Refresh
            </button>
          </div>
          <ul className="max-h-[70vh] divide-y divide-keepers-black/10 overflow-auto">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => loadMessages(item.id)}
                  className={[
                    "block w-full px-4 py-3 text-left hover:bg-keepers-sand/40",
                    selected === item.id ? "bg-keepers-sand/60" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.tripTitle}</span>
                    <span className="text-[10px] uppercase tracking-wide text-keepers-muted">
                      {item.type}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-keepers-muted">
                    {item.lastPreview || "No messages"}
                  </p>
                </button>
              </li>
            ))}
            {items.length === 0 ? (
              <li className="px-4 py-8 text-sm text-keepers-muted">
                No conversations yet.
              </li>
            ) : null}
          </ul>
        </div>

        <div className="border border-keepers-black/15 bg-white">
          <div className="border-b border-keepers-black/10 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              Messages
            </h2>
          </div>
          <ul className="max-h-[70vh] space-y-3 overflow-auto p-4">
            {busy ? (
              <li className="text-sm text-keepers-muted">Loading…</li>
            ) : null}
            {!busy && selected && messages.length === 0 ? (
              <li className="text-sm text-keepers-muted">No messages.</li>
            ) : null}
            {messages.map((m) => (
              <li
                key={m.id}
                className="border border-keepers-black/10 px-3 py-2 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-keepers-muted">
                      {m.sender?.name || "System"} · {m.type}
                      {m.deletedAt ? " · deleted" : ""}
                    </p>
                    <p className="mt-1">
                      {m.deletedAt
                        ? "Message deleted"
                        : m.content || `[${m.type}]`}
                    </p>
                    <p className="mt-1 text-[11px] text-keepers-muted">
                      {new Date(m.createdAt).toLocaleString()}
                    </p>
                  </div>
                  {!m.deletedAt ? (
                    <button
                      type="button"
                      onClick={() => deleteMessage(m.id)}
                      className="text-xs uppercase tracking-wide underline"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
