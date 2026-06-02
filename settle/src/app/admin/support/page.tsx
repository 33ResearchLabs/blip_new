"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle,
  Send,
  CheckCircle2,
  User,
  Store,
  Circle,
  Loader2,
  CheckCheck,
  RefreshCw,
} from "lucide-react";
import { ADMIN_COOKIE_SENTINEL } from "@/lib/api/adminSession";

const CORE_WS_URL =
  (process.env.NEXT_PUBLIC_CORE_WS_URL ?? "ws://localhost:4010/ws/orders")
    .replace("/ws/orders", "/ws/support");

const ADMIN_SECRET =
  process.env.NEXT_PUBLIC_SUPPORT_ADMIN_SECRET ?? "support-admin-dev";

interface SupportSession {
  id: string;
  actor_type: string;
  actor_id: string;
  display_name: string;
  status: "open" | "resolved";
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_admin: number;
  created_at: string;
}

interface SupportMessage {
  id: string;
  sender: "user" | "admin";
  content: string;
  created_at: string;
}

type SessionMessages = Record<string, SupportMessage[]>;

function fmtTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function SupportPage() {
  const [sessions, setSessions] = useState<SupportSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<SessionMessages>({});
  const [input, setInput] = useState("");
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [filter, setFilter] = useState<"open" | "resolved">("open");

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const activeMessages = activeId ? (messagesBySession[activeId] ?? []) : [];

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    setWsStatus("connecting");
    const ws = new WebSocket(CORE_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("connected");
      ws.send(JSON.stringify({ type: "join_admin", adminSecret: ADMIN_SECRET }));
    };

    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);

        if (evt.type === "admin_joined") {
          setSessions(evt.sessions ?? []);
        }

        if (evt.type === "message") {
          setMessagesBySession((prev) => {
            const existing = prev[evt.sessionId] ?? [];
            if (existing.find((m: SupportMessage) => m.id === evt.id)) return prev;
            return {
              ...prev,
              [evt.sessionId]: [...existing, { id: evt.id, sender: evt.sender, content: evt.content, created_at: evt.created_at }],
            };
          });
          setSessions((prev) =>
            prev.map((s) =>
              s.id === evt.sessionId
                ? { ...s, last_message_at: evt.created_at, last_message_preview: evt.content.slice(0, 100), unread_admin: evt.sender === "user" ? s.unread_admin + 1 : s.unread_admin }
                : s
            )
          );
        }

        if (evt.type === "session_resolved") {
          setSessions((prev) =>
            prev.map((s) => (s.id === evt.sessionId ? { ...s, status: "resolved" } : s))
          );
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
      setTimeout(() => { if (wsRef.current === ws) connect(); }, 5000);
    };
    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages.length, activeId]);

  const loadHistory = useCallback(async (sessionId: string) => {
    if (messagesBySession[sessionId]) return;
    setHistoryLoading(true);
    try {
      const apiBase = CORE_WS_URL.replace(/^ws/, "http").replace("/ws/support", "");
      const res = await fetch(`${apiBase}/v1/support/sessions/${sessionId}/messages`, {
        headers: { "x-support-admin-secret": ADMIN_SECRET },
      });
      if (res.ok) {
        const data = await res.json();
        setMessagesBySession((prev) => ({ ...prev, [sessionId]: data.messages ?? [] }));
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [messagesBySession]);

  const selectSession = (id: string) => {
    setActiveId(id);
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, unread_admin: 0 } : s)));
    loadHistory(id);
    inputRef.current?.focus();
  };

  const send = () => {
    if (!input.trim() || !activeId || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current!.send(JSON.stringify({ type: "message", sessionId: activeId, content: input.trim() }));
    setInput("");
    inputRef.current?.focus();
  };

  const resolve = (sessionId: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current!.send(JSON.stringify({ type: "resolve", sessionId }));
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const filteredSessions = sessions
    .filter((s) => s.status === filter)
    .sort((a, b) => new Date(b.last_message_at ?? b.created_at).getTime() - new Date(a.last_message_at ?? a.created_at).getTime());

  // suppress unused import warning
  void ADMIN_COOKIE_SENTINEL;

  return (
    <div className="flex h-[calc(100vh-50px)] overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageCircle size={15} className="text-foreground/50" />
            <span className="text-sm font-semibold text-foreground">Support Chat</span>
            <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === "connected" ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`} />
          </div>
          <button onClick={connect} title="Reconnect" className="text-foreground/30 hover:text-foreground/70 transition-colors">
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-border">
          {(["open", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 text-xs font-medium transition-colors capitalize ${
                filter === f ? "text-foreground border-b-2 border-foreground" : "text-foreground/40 hover:text-foreground/70"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {filteredSessions.length === 0 && (
            <p className="text-center text-foreground/30 text-xs mt-10">No {filter} conversations</p>
          )}
          {filteredSessions.map((s) => (
            <button
              key={s.id}
              onClick={() => selectSession(s.id)}
              className={`w-full text-left px-4 py-3 border-b border-border/50 transition-colors hover:bg-accent-subtle ${activeId === s.id ? "bg-accent-subtle" : ""}`}
            >
              <div className="flex items-start gap-2.5">
                <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-background border border-border flex items-center justify-center">
                  {s.actor_type === "merchant"
                    ? <Store size={11} className="text-foreground/60" />
                    : <User size={11} className="text-foreground/60" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-foreground truncate max-w-[120px]">{s.display_name || s.actor_id}</span>
                    <span className="text-[10px] text-foreground/30 flex-shrink-0 ml-1">{fmtTime(s.last_message_at)}</span>
                  </div>
                  <div className="flex justify-between items-center mt-0.5">
                    <span className="text-[11px] text-foreground/50 truncate max-w-[140px]">{s.last_message_preview ?? "No messages yet"}</span>
                    {s.unread_admin > 0 && (
                      <span className="flex-shrink-0 ml-1 bg-foreground text-background text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                        {s.unread_admin > 9 ? "9+" : s.unread_admin}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Circle size={5} className={s.status === "open" ? "text-green-500 fill-green-500" : "text-foreground/20 fill-foreground/20"} />
                    <span className="text-[10px] text-foreground/30">{s.actor_type}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat panel */}
      <div className="flex-1 flex flex-col bg-background min-w-0">
        {!activeSession ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-foreground/30">
            <MessageCircle size={32} strokeWidth={1} />
            <p className="text-sm">Select a conversation</p>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-background border border-border flex items-center justify-center">
                  {activeSession.actor_type === "merchant"
                    ? <Store size={13} className="text-foreground/60" />
                    : <User size={13} className="text-foreground/60" />}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{activeSession.display_name || activeSession.actor_id}</p>
                  <p className="text-[11px] text-foreground/40">{activeSession.actor_type} · {activeSession.actor_id.slice(0, 8)}…</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeSession.status === "open" ? (
                  <button
                    onClick={() => resolve(activeSession.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground/60 hover:text-foreground hover:bg-accent-subtle transition-colors"
                  >
                    <CheckCircle2 size={12} />
                    Resolve
                  </button>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-foreground/40">
                    <CheckCircle2 size={12} className="text-green-500" /> Resolved
                  </span>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {historyLoading && (
                <div className="flex justify-center mt-8">
                  <Loader2 size={18} className="animate-spin text-foreground/30" />
                </div>
              )}
              {activeMessages.length === 0 && !historyLoading && (
                <p className="text-center text-foreground/30 text-xs mt-10">No messages yet</p>
              )}
              {activeMessages.map((m) => (
                <div key={m.id} className={`flex ${m.sender === "admin" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                    m.sender === "admin"
                      ? "bg-foreground text-background rounded-br-sm"
                      : "bg-card border border-border text-foreground rounded-bl-sm"
                  }`}>
                    {m.content}
                    {m.sender === "admin" && (
                      <CheckCheck size={10} className="inline ml-1 opacity-50" />
                    )}
                    <p className={`text-[10px] mt-0.5 ${m.sender === "admin" ? "opacity-50 text-right" : "text-foreground/40"}`}>
                      {fmtTime(m.created_at)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {activeSession.status === "open" ? (
              <div className="px-4 py-3 border-t border-border bg-card flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Reply…"
                  rows={1}
                  maxLength={2000}
                  className="flex-1 resize-none bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground/30 max-h-28 overflow-y-auto leading-5 focus:border-foreground/40 transition-colors"
                  style={{ minHeight: "38px" }}
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || wsStatus !== "connected"}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-foreground text-background hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                >
                  <Send size={14} />
                </button>
              </div>
            ) : (
              <div className="px-4 py-3 border-t border-border text-center text-xs text-foreground/30">
                Conversation resolved
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
