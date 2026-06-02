'use client';

/**
 * SupportBubble
 *
 * Floating chat bubble that opens a support chat widget.
 * Connects to /ws/support and lets users send messages to the support team.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, CheckCheck } from 'lucide-react';
import { useApp } from '@/context/AppContext';

const SUPPORT_WS_URL = (process.env.NEXT_PUBLIC_CORE_WS_URL ?? 'ws://localhost:4010/ws/orders')
  .replace('/ws/orders', '/ws/support');

interface SupportMessage {
  id: string;
  sender: 'user' | 'admin';
  content: string;
  created_at: string;
}

type WsStatus = 'disconnected' | 'connecting' | 'connected';

export function SupportBubble() {
  const { user } = useApp();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState('');
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const connect = useCallback(() => {
    if (!user) return;
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;

    setWsStatus('connecting');
    const ws = new WebSocket(SUPPORT_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('connected');
      ws.send(JSON.stringify({
        type: 'join',
        actorType: 'user',
        actorId: user.id,
        displayName: user.username || user.id,
      }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'joined') {
          setSessionId(msg.sessionId);
          setMessages(msg.history ?? []);
        }
        if (msg.type === 'message') {
          setMessages((prev) => {
            if (prev.find((m) => m.id === msg.id)) return prev;
            return [...prev, { id: msg.id, sender: msg.sender, content: msg.content, created_at: msg.created_at }];
          });
          if (msg.sender === 'admin' && !open) setUnread((n) => n + 1);
        }
        if (msg.type === 'session_resolved') {
          setSessionId(null);
          setMessages((prev) => [...prev, { id: 'resolved', sender: 'admin', content: 'This conversation has been resolved. Open a new message if you need further help.', created_at: new Date().toISOString() }]);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      // Reconnect after 5s
      setTimeout(() => { if (wsRef.current === ws) connect(); }, 5000);
    };

    ws.onerror = () => { ws.close(); };
  }, [user, open]);

  // Connect when opened
  useEffect(() => {
    if (open && user) {
      connect();
      setUnread(0);
    }
  }, [open, user, connect]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const send = () => {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !sessionId) return;
    wsRef.current.send(JSON.stringify({ type: 'message', content: input.trim(), sessionId }));
    setInput('');
    inputRef.current?.focus();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  if (!user) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Chat panel */}
      {open && (
        <div className="flex flex-col w-80 h-[460px] rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-gray-900">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${wsStatus === 'connected' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
              <span className="text-sm font-semibold text-white">Blip Support</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
            {messages.length === 0 && wsStatus === 'connected' && (
              <div className="text-center text-gray-500 mt-6 text-xs leading-relaxed">
                Hi! How can we help you today?<br />Send a message and our team will reply shortly.
              </div>
            )}
            {wsStatus === 'connecting' && (
              <div className="flex justify-center mt-8">
                <Loader2 size={20} className="animate-spin text-gray-500" />
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                  m.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-700 text-gray-100 rounded-bl-sm'
                }`}>
                  {m.content}
                  {m.sender === 'user' && (
                    <CheckCheck size={10} className="ml-1 inline text-blue-300 opacity-70" />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-3 py-3 border-t border-white/10 flex items-end gap-2 bg-gray-800">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Type a message…"
              rows={1}
              className="flex-1 resize-none bg-gray-700 text-white text-sm rounded-xl px-3 py-2 outline-none placeholder-gray-500 max-h-24 overflow-y-auto leading-5"
              style={{ minHeight: '36px' }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || wsStatus !== 'connected' || !sessionId}
              className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Bubble button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg flex items-center justify-center transition-all active:scale-95"
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </div>
  );
}
