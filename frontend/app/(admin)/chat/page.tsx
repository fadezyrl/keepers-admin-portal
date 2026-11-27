"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";
import { ChatReportsPanel } from "@/components/chat/ChatReportsPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/lib/auth";
import {
  fetchChatInbox,
  fetchChatMessages,
  markConversationRead,
  softDeleteChatMessage,
} from "@/lib/chatApi";
import {
  connectChatSocket,
  disconnectChatSocket,
  joinChatConversation,
  leaveChatConversation,
  setChatViewing,
} from "@/lib/chatSocket";
import type { ChatInboxItem, ChatMessage } from "@/lib/chatTypes";
import { useToast } from "@/lib/toast";

type CommTab = "inbox" | "reports";

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  const byClient = new Map<string, string>();
  for (const m of existing) {
    byId.set(m.id, m);
    if (m.clientMessageId) byClient.set(m.clientMessageId, m.id);
  }
  for (const m of incoming) {
    if (m.clientMessageId && byClient.has(m.clientMessageId)) {
      const tempId = byClient.get(m.clientMessageId)!;
      byId.delete(tempId);
    }
    // Drop optimistic temp if server echo arrives with same id
    byId.set(m.id, { ...byId.get(m.id), ...m, localStatus: m.localStatus || "sent" });
    if (m.clientMessageId) byClient.set(m.clientMessageId, m.id);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export default function ChatModerationPage() {
  const { user, token } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<CommTab>("inbox");
  const [items, setItems] = useState<ChatInboxItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(null);
  const myId = user?.id || "";

  selectedRef.current = selected;

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selected) || null,
    [items, selected],
  );

  const loadInbox = useCallback(async () => {
    try {
      const data = await fetchChatInbox();
      setItems(data.items || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chats");
    }
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    setSelected(id);
    setBusy(true);
    setError(null);
    try {
      const data = await fetchChatMessages(id, { limit: 50 });
      // API returns chronological (oldest → newest).
      const itemsAsc = data.items || [];
      setMessages(itemsAsc);
      setNextBefore(data.nextBefore || null);
      await markConversationRead(id, itemsAsc[itemsAsc.length - 1]?.id).catch(() => undefined);
      requestAnimationFrame(() => {
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load messages");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadOlder = useCallback(async () => {
    if (!selected || !nextBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await fetchChatMessages(selected, { before: nextBefore, limit: 40 });
      setMessages((prev) => mergeMessages(data.items || [], prev));
      setNextBefore(data.nextBefore || null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load older messages");
    } finally {
      setLoadingOlder(false);
    }
  }, [selected, nextBefore, loadingOlder, toast]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    try {
      connectChatSocket({
        onMessageNew: (message) => {
          if (cancelled) return;
          if (message.conversationId === selectedRef.current) {
            setMessages((prev) => mergeMessages(prev, [message]));
            void markConversationRead(message.conversationId, message.id).catch(() => undefined);
            requestAnimationFrame(() => {
              const el = listRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }
          void loadInbox();
        },
        onMessageDeleted: ({ messageId, conversationId }) => {
          if (cancelled) return;
          if (conversationId === selectedRef.current) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), content: null } : m,
              ),
            );
          }
          void loadInbox();
        },
        onError: (err) => {
          if (!cancelled) setError(err.message || "Realtime connection error");
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Socket connect failed");
    }
    return () => {
      cancelled = true;
      disconnectChatSocket();
    };
  }, [token, loadInbox]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    (async () => {
      try {
        await joinChatConversation(selected);
        if (!active) return;
        setChatViewing(selected, true);
      } catch {
        // REST history still works without socket join
      }
    })();
    return () => {
      active = false;
      setChatViewing(selected, false);
      void leaveChatConversation(selected);
    };
  }, [selected]);

  async function deleteMessage(messageId: string) {
    if (!confirm("Soft-delete this message?")) return;
    try {
      await softDeleteChatMessage(messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), content: null } : m,
        ),
      );
      toast.success("Message deleted");
      void loadInbox();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Communication"
        subtitle="Trip chats, media replies, and reported user-generated content moderation."
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={["btn btn-sm", tab === "inbox" ? "btn-primary" : "btn-ghost"].join(" ")}
          onClick={() => setTab("inbox")}
        >
          Inbox
        </button>
        <button
          type="button"
          className={["btn btn-sm", tab === "reports" ? "btn-primary" : "btn-ghost"].join(" ")}
          onClick={() => setTab("reports")}
        >
          Reports
        </button>
      </div>

      {tab === "reports" ? <ChatReportsPanel /> : null}

      {tab === "inbox" && error ? (
        <p className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}

      {tab === "inbox" ? (
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--keepers-border)] px-4 py-3">
            <h2 className="m-0 text-sm font-semibold uppercase tracking-wide">Conversations</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadInbox()}>
              Refresh
            </button>
          </div>
          <ul className="max-h-[70vh] divide-y divide-[var(--keepers-border)] overflow-auto">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void loadMessages(item.id)}
                  className={[
                    "block w-full px-4 py-3 text-left hover:bg-[var(--keepers-cream)]",
                    selected === item.id ? "bg-[var(--keepers-cream)]" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.tripTitle}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--keepers-muted)]">
                      {item.type}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-[var(--keepers-muted)]">
                    {item.lastPreview || "No messages"}
                  </p>
                  {item.unreadCount > 0 ? (
                    <span className="mt-1 inline-block rounded-full bg-[var(--keepers-black)] px-2 py-0.5 text-[10px] text-white">
                      {item.unreadCount}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
            {items.length === 0 ? (
              <li className="px-4 py-8 text-sm text-[var(--keepers-muted)]">No conversations yet.</li>
            ) : null}
          </ul>
        </div>

        <div className="panel flex min-h-[70vh] flex-col overflow-hidden">
          <div className="border-b border-[var(--keepers-border)] px-4 py-3">
            <h2 className="m-0 text-sm font-semibold uppercase tracking-wide">
              {selectedItem ? selectedItem.tripTitle : "Messages"}
            </h2>
            {selectedItem ? (
              <p className="m-0 mt-1 text-xs text-[var(--keepers-muted)]">
                {selectedItem.type}
                {selectedItem.isReadonly ? " · read-only" : ""}
              </p>
            ) : null}
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-auto p-4">
            {!selected ? (
              <p className="text-sm text-[var(--keepers-muted)]">Select a conversation.</p>
            ) : null}
            {selected && nextBefore ? (
              <div className="text-center">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder ? "Loading…" : "Load older"}
                </button>
              </div>
            ) : null}
            {busy && messages.length === 0 ? (
              <p className="text-sm text-[var(--keepers-muted)]">Loading…</p>
            ) : null}
            {!busy && selected && messages.length === 0 ? (
              <p className="text-sm text-[var(--keepers-muted)]">No messages.</p>
            ) : null}
            {messages.map((m) => (
              <ChatMessageBubble
                key={m.id}
                message={m}
                isMine={Boolean(myId && m.sender?.id === myId)}
                onDelete={m.deletedAt ? undefined : deleteMessage}
              />
            ))}
          </div>

          {selected && !selectedItem?.isReadonly ? (
            <ChatComposer
              conversationId={selected}
              onOptimistic={(msg) => {
                setMessages((prev) => mergeMessages(prev, [msg]));
                requestAnimationFrame(() => {
                  const el = listRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                });
              }}
              onSent={(tempId, sent) => {
                setMessages((prev) => {
                  const withoutTemp = prev.filter((m) => m.id !== tempId);
                  return mergeMessages(withoutTemp, [sent]);
                });
                void loadInbox();
              }}
              onFailed={(tempId) => {
                setMessages((prev) =>
                  prev.map((m) => (m.id === tempId ? { ...m, localStatus: "failed" } : m)),
                );
              }}
            />
          ) : selectedItem?.isReadonly ? (
            <p className="border-t border-[var(--keepers-border)] px-4 py-3 text-sm text-[var(--keepers-muted)]">
              This conversation is read-only.
            </p>
          ) : null}
        </div>
      </div>
      ) : null}
    </div>
  );
}
