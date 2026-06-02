'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, MessageCircle, CheckCheck } from 'lucide-react';
import { useApp } from '@/context/AppContext';

const SUPPORT_WS_URL = (process.env.NEXT_PUBLIC_CORE_WS_URL ?? 'ws://localhost:4010/ws/orders')
  .replace('/ws/orders', '/ws/support');

interface SupportMessage {
  id: string;
  sender: 'user' | 'admin';
  content: string;
  created_at: string;
}

interface Props {
  /** Override actor identity — used by merchant dashboard */
  actorType?: string;
  actorId?: string;
}

export function SupportBubbleInline({ actorType: propActorType, actorId: propActorId }: Props = {}) {
  const { user } = useApp();

  const actorType = propActorType ?? 'user';
  const actorId = propActorId ?? user?.id ?? '';

  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState('');
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [sessionId, setSessionId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const connect = useCallback(() => {
    if (!actorId) return;
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    setWsStatus('connecting');
    const ws = new WebSocket(SUPPORT_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('connected');
      ws.send(JSON.stringify({ type: 'join', actorType, actorId, displayName: actorId }));
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'joined') {
          setSessionId(msg.sessionId);
          setMessages(msg.history ?? []);
        }
        if (msg.type === 'message') {
          setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, { id: msg.id, sender: msg.sender, content: msg.content, created_at: msg.created_at }]);
        }
        if (msg.type === 'session_resolved') {
          setMessages((prev) => [...prev, { id: 'resolved-' + Date.now(), sender: 'admin', content: 'Conversation resolved. Send a message if you need further help.', created_at: new Date().toISOString() }]);
          setSessionId(null);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setWsStatus('disconnected');
      setTimeout(() => { if (wsRef.current === ws) connect(); }, 5000);
    };
    ws.onerror = () => ws.close();
  }, [actorType, actorId]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || !sessionId || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current!.send(JSON.stringify({ type: 'message', content: text, sessionId }));
    setInput('');
  };

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-primary, #0a0a0a)' }}>
      {/* Status */}
      <div className="px-3 py-2 border-b border-white/[0.05] flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
        <span className="text-[11px] font-mono text-white/40">
          {wsStatus === 'connected' ? 'Blip Support · Online' : 'Connecting…'}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {wsStatus === 'connecting' && (
          <div className="flex justify-center mt-8">
            <Loader2 size={18} className="animate-spin text-white/20" />
          </div>
        )}
        {wsStatus === 'connected' && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
              <MessageCircle size={20} className="text-white/20" />
            </div>
            <p className="text-[13px] font-semibold text-white/30">How can we help?</p>
            <p className="text-[11px] text-white/15 font-mono">Send a message — we reply fast</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[78%] px-3 py-2 rounded-2xl text-[12px] leading-relaxed ${
              m.sender === 'user'
                ? 'bg-primary text-white rounded-br-sm'
                : 'bg-white/[0.06] border border-white/[0.08] text-white/70 rounded-bl-sm'
            }`}>
              {m.content}
              {m.sender === 'user' && <CheckCheck size={9} className="inline ml-1 opacity-40" />}
              <p className={`text-[9px] mt-0.5 ${m.sender === 'user' ? 'text-white/40 text-right' : 'text-white/20'}`}>
                {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-white/[0.05] flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Message support…"
          rows={1}
          maxLength={2000}
          className="flex-1 resize-none bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-[12px] text-white/70 outline-none placeholder:text-white/20 max-h-20 overflow-y-auto leading-5 focus:border-white/20 transition-colors"
          style={{ minHeight: '36px' }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || wsStatus !== 'connected' || !sessionId}
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-primary text-white hover:opacity-80 disabled:opacity-25 disabled:cursor-not-allowed transition-opacity"
        >
          <Send size={13} />
        </button>
      </div>
    </div>
  );
}
