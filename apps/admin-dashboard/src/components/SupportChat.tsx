/**
 * SupportChat Admin Panel
 *
 * Connects to /ws/support with admin credentials.
 * Shows a list of support sessions on the left, active chat on the right.
 * Admins can reply and resolve sessions.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  MessageCircle,
  CheckCheck,
  Send,
  Loader2,
  CheckCircle2,
  User,
  Store,
  Circle,
  RefreshCw,
} from "lucide-react";

const CORE_WS_URL =
  (import.meta.env.VITE_CORE_WS_URL as string | undefined) ??
  "ws://localhost:4010/ws/support";

const ADMIN_SECRET =
  (import.meta.env.VITE_SUPPORT_ADMIN_SECRET as string | undefined) ??
  "support-admin-dev";

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

interface WsMessageEvent {
  type: "message";
  sessionId: string;
  id: string;
  sender: "user" | "admin";
  content: string;
  created_at: string;
  actorId?: string;
  actorType?: string;
}

interface WsAdminJoined {
  type: "admin_joined";
  sessions: SupportSession[];
}

interface WsSessionResolved {
  type: "session_resolved";
  sessionId: string;
}

type WsEvent = WsMessageEvent | WsAdminJoined | WsSessionResolved | { type: string };

// Track messages per session
type SessionMessages = Record<string, SupportMessage[]>;

export function SupportChat() {
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
        const evt = JSON.parse(e.data) as WsEvent;

        if (evt.type === "admin_joined") {
          const data = evt as WsAdminJoined;
          setSessions(data.sessions);
        }

        if (evt.type === "message") {
          const data = evt as WsMessageEvent;
          setMessagesBySession((prev) => {
            const existing = prev[data.sessionId] ?? [];
            if (existing.find((m) => m.id === data.id)) return prev;
            return {
              ...prev,
              [data.sessionId]: [
                ...existing,
                { id: data.id, sender: data.sender, content: data.content, created_at: data.created_at },
              ],
            };
          });
          // Update session preview
          setSessions((prev) =>
            prev.map((s) =>
              s.id === data.sessionId
                ? { ...s, last_message_at: data.created_at, last_message_preview: data.content.slice(0, 100), unread_admin: data.sender === "user" ? s.unread_admin + 1 : s.unread_admin }
                : s
            )
          );
        }

        if (evt.type === "session_resolved") {
          const data = evt as WsSessionResolved;
          setSessions((prev) =>
            prev.map((s) => (s.id === data.sessionId ? { ...s, status: "resolved" } : s))
          );
          if (activeId === data.sessionId) setActiveId(null);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setWsStatus("disconnected");
      setTimeout(() => { if (wsRef.current === ws) connect(); }, 5000);
    };

    ws.onerror = () => { ws.close(); };
  }, [activeId]);

  useEffect(() => {
    connect();
    return () => { wsRef.current?.close(); };
  }, []);

  // Load history when switching sessions
  const loadHistory = useCallback(async (sessionId: string) => {
    if (messagesBySession[sessionId]) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `${CORE_WS_URL.replace("ws://", "http://").replace("wss://", "https://").replace("/ws/support", "")}/v1/support/sessions/${sessionId}/messages`,
        { headers: { "x-support-admin-secret": ADMIN_SECRET } }
      );
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
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages.length, activeId]);

  const send = () => {
    if (!input.trim() || !activeId || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "message", sessionId: activeId, content: input.trim() }));
    setInput("");
    inputRef.current?.focus();
  };

  const resolve = (sessionId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "resolve", sessionId }));
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const filteredSessions = sessions.filter((s) => s.status === filter);

  const fmt = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="flex h-full min-h-[600px] rounded-xl overflow-hidden border border-slate-800 bg-slate-900">
      {/* Sidebar */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-slate-800">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <MessageCircle size={16} className="text-blue-400" />
            <span className="text-sm font-semibold text-white">Support</span>
            <div className={`w-2 h-2 rounded-full ml-1 ${wsStatus === "connected" ? "bg-green-400" : "bg-yellow-400 animate-pulse"}`} />
          </div>
          <button onClick={connect} title="Reconnect" className="text-slate-500 hover:text-white transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-slate-800">
          {(["open", "resolved"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${filter === f ? "text-blue-400 border-b-2 border-blue-400" : "text-slate-500 hover:text-white"}`}
            >
              {f === "open" ? "Open" : "Resolved"}
            </button>
          ))}
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {filteredSessions.length === 0 && (
            <div className="text-center text-slate-600 text-xs mt-8">No {filter} conversations</div>
          )}
          {filteredSessions
            .sort((a, b) => new Date(b.last_message_at ?? b.created_at).getTime() - new Date(a.last_message_at ?? a.created_at).getTime())
            .map((s) => (
              <button
                key={s.id}
                onClick={() => selectSession(s.id)}
                className={`w-full text-left px-4 py-3 border-b border-slate-800/50 transition-colors hover:bg-slate-800 ${activeId === s.id ? "bg-slate-800" : ""}`}
              >
                <div className="flex items-start gap-2">
                  {/* Actor icon */}
                  <div className="flex-shrink-0 mt-0.5 w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
                    {s.actor_type === "merchant"
                      ? <Store size={12} className="text-amber-400" />
                      : <User size={12} className="text-blue-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-white truncate max-w-[120px]">{s.display_name || s.actor_id}</span>
                      <span className="text-[10px] text-slate-500 ml-1 flex-shrink-0">{fmt(s.last_message_at)}</span>
                    </div>
                    <div className="flex justify-between items-center mt-0.5">
                      <span className="text-[11px] text-slate-400 truncate max-w-[140px]">
                        {s.last_message_preview ?? "No messages yet"}
                      </span>
                      {s.unread_admin > 0 && (
                        <span className="flex-shrink-0 ml-1 bg-blue-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                          {s.unread_admin}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Circle size={6} className={s.status === "open" ? "text-green-400 fill-green-400" : "text-slate-600 fill-slate-600"} />
                      <span className="text-[10px] text-slate-600">{s.actor_type}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
        </div>
      </div>

      {/* Chat panel */}
      <div className="flex-1 flex flex-col">
        {!activeSession ? (
          <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
            Select a conversation to view
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
                  {activeSession.actor_type === "merchant"
                    ? <Store size={14} className="text-amber-400" />
                    : <User size={14} className="text-blue-400" />
                  }
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{activeSession.display_name || activeSession.actor_id}</div>
                  <div className="text-[11px] text-slate-500">
                    {activeSession.actor_type} · ID: {activeSession.actor_id.slice(0, 12)}…
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeSession.status === "open" && (
                  <button
                    onClick={() => resolve(activeSession.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 text-xs font-medium transition-colors"
                  >
                    <CheckCircle2 size={13} />
                    Resolve
                  </button>
                )}
                {activeSession.status === "resolved" && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <CheckCircle2 size={12} className="text-green-400" /> Resolved
                  </span>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {historyLoading && (
                <div className="flex justify-center">
                  <Loader2 size={18} className="animate-spin text-slate-500" />
                </div>
              )}
              {activeMessages.length === 0 && !historyLoading && (
                <div className="text-center text-slate-600 text-xs mt-8">No messages yet</div>
              )}
              {activeMessages.map((m) => (
                <div key={m.id} className={`flex ${m.sender === "admin" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                    m.sender === "admin"
                      ? "bg-blue-600 text-white rounded-br-sm"
                      : "bg-slate-700 text-slate-100 rounded-bl-sm"
                  }`}>
                    {m.content}
                    {m.sender === "admin" && (
                      <CheckCheck size={10} className="inline ml-1 text-blue-300 opacity-70" />
                    )}
                    <div className={`text-[10px] mt-0.5 ${m.sender === "admin" ? "text-blue-300/70 text-right" : "text-slate-500"}`}>
                      {fmt(m.created_at)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            {activeSession.status === "open" ? (
              <div className="px-4 py-3 border-t border-slate-800 flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Reply to user…"
                  rows={1}
                  maxLength={2000}
                  className="flex-1 resize-none bg-slate-800 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-slate-500 max-h-28 overflow-y-auto leading-5 border border-slate-700 focus:border-blue-500 transition-colors"
                  style={{ minHeight: "38px" }}
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || wsStatus !== "connected"}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={15} />
                </button>
              </div>
            ) : (
              <div className="px-4 py-3 border-t border-slate-800 text-center text-xs text-slate-600">
                This conversation is resolved
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
