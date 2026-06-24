'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, MessageCircle } from 'lucide-react';
import { useApp } from '@/context/AppContext';

const SUPPORT_WS_URL = (process.env.NEXT_PUBLIC_CORE_WS_URL ?? 'ws://localhost:4010/ws/orders')
  .replace('/ws/orders', '/ws/support');

interface SupportMessage {
  id: string;
  sender: 'user' | 'admin';
  content: string;
  created_at: string;
}

interface SupportBubbleInlineProps {
  /** Explicit actor for the support session (e.g. a merchant). Falls back to the logged-in user from AppContext. */
  actorType?: 'user' | 'merchant';
  actorId?: string;
}

export function SupportBubbleInline({ actorType, actorId }: SupportBubbleInlineProps = {}) {
  const { user } = useApp();
  // Prefer an explicitly-passed actor (MerchantChatTabs passes the merchant);
  // fall back to the logged-in user. This is what lets support work in the
  // merchant UI, where AppContext.user is not populated.
  const resolvedId = actorId ?? user?.id;
  const resolvedType: 'user' | 'merchant' = actorType ?? 'user';
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState('');
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const connect = useCallback(() => {
    if (!resolvedId || wsRef.current?.readyState === WebSocket.OPEN) return;
    setWsStatus('connecting');
    const ws = new WebSocket(`${SUPPORT_WS_URL}?userId=${resolvedId}&actorType=${resolvedType}`);
    wsRef.current = ws;
    ws.onopen = () => setWsStatus('connected');
    ws.onclose = () => setWsStatus('disconnected');
    ws.onerror = () => setWsStatus('disconnected');
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'history') setMessages(data.messages ?? []);
        else if (data.type === 'message') setMessages(p => [...p, data.message]);
      } catch {}
    };
  }, [resolvedId, resolvedType]);

  useEffect(() => { connect(); return () => wsRef.current?.close(); }, [connect]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'message', content: text }));
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg-secondary)]">
      <div className="shrink-0 px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center shrink-0">
          <MessageCircle className="w-4 h-4 text-foreground" />
        </div>
        <div>
          <p className="text-sm font-semibold">Blip Support</p>
          <p className="text-xs text-muted">
            {wsStatus === 'connected' ? 'Online' : wsStatus === 'connecting' ? 'Connecting…' : 'Offline'}
          </p>
        </div>
      </div>
      {messages.length === 0 ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 text-center">
          <MessageCircle className="w-8 h-8 text-muted/30 mb-3" />
          <p className="text-sm text-muted">No messages yet</p>
          <p className="text-xs text-muted/60 mt-1">Send a message to start</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 scrollbar-hide">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm ${
                msg.sender === 'user'
                  ? 'bg-primary text-white rounded-br-sm'
                  : 'bg-[var(--color-bg-tertiary)] text-foreground rounded-bl-sm'
              }`}>
                <p>{msg.content}</p>
                <p className={`text-[10px] mt-1 ${msg.sender === 'user' ? 'text-white/60' : 'text-muted'}`}>
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
      <div className="shrink-0 px-4 py-3 border-t border-border">
        <div className="flex items-center gap-2 bg-[var(--color-bg-tertiary)] rounded-2xl px-4 py-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Message support…"
            maxLength={1000}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          {wsStatus === 'connecting'
            ? <Loader2 className="w-4 h-4 text-muted animate-spin" />
            : <button onClick={send} disabled={!input.trim() || wsStatus !== 'connected'} className="text-foreground disabled:opacity-30"><Send className="w-4 h-4" /></button>
          }
        </div>
      </div>
    </div>
  );
}
