'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Send, Store, User, CheckCheck, Paperclip, Loader2, X, Image as ImageIcon } from 'lucide-react';

interface DirectChatMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  timestamp: Date;
  messageType: 'text' | 'image';
  imageUrl?: string | null;
  isRead: boolean;
}

interface DirectChatViewProps {
  contactName: string;
  contactType: 'user' | 'merchant';
  messages: DirectChatMessage[];
  isLoading: boolean;
  onSendMessage: (text: string, imageUrl?: string) => void;
  onBack: () => void;
}

function getUserEmoji(username: string): string {
  const emojis = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦋', '🐳', '🦄', '🐲'];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function DirectChatView({
  contactName,
  contactType,
  messages,
  isLoading,
  onSendMessage,
  onBack,
}: DirectChatViewProps) {
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emoji = getUserEmoji(contactName);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim());
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) return; // 10MB max
    if (!file.type.startsWith('image/')) return; // Images only for now

    setIsUploading(true);
    try {
      const sigRes = await fetch('/api/upload/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'direct-chat' }),
      });
      if (!sigRes.ok) { setIsUploading(false); return; }
      const sigData = await sigRes.json();
      if (!sigData.success) { setIsUploading(false); return; }
      const sig = sigData.data;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', sig.signature);
      formData.append('timestamp', sig.timestamp.toString());
      formData.append('api_key', sig.apiKey);
      formData.append('folder', sig.folder);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        { method: 'POST', body: formData }
      );
      if (uploadRes.ok) {
        const result = await uploadRes.json();
        onSendMessage('Photo', result.secure_url);
      }
    } catch {
      // Upload failed silently
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Group messages by date and detect consecutive same-sender groups
  let lastDate = '';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded hover:bg-white/[0.06] transition-colors text-white/30 hover:text-white/50"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="w-6 h-6 rounded-md bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-xs">
            {emoji}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase truncate">
              {contactName}
            </span>
            {contactType === 'merchant' ? (
              <Store className="w-2.5 h-2.5 text-orange-400/60" />
            ) : (
              <User className="w-2.5 h-2.5 text-white/25" />
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-4 h-4 border-2 border-orange-500/40 border-t-orange-400 rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/15">
            <p className="text-[10px] font-mono">No messages yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {messages.map((msg, i) => {
              const msgDate = formatDateSeparator(msg.timestamp);
              const showDate = msgDate !== lastDate;
              lastDate = msgDate;

              // Show avatar only on first message in a group from same sender
              const prevMsg = i > 0 ? messages[i - 1] : null;
              const isFirstInGroup = !prevMsg || prevMsg.from !== msg.from ||
                (msg.timestamp.getTime() - prevMsg.timestamp.getTime() > 120000); // 2 min gap = new group

              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex justify-center my-2">
                      <span className="text-[9px] text-white/20 bg-white/[0.03] px-2 py-0.5 rounded-full font-mono">
                        {msgDate}
                      </span>
                    </div>
                  )}

                  {msg.from === 'them' ? (
                    /* Incoming message */
                    <div className={`flex items-end gap-1.5 ${isFirstInGroup ? 'mt-2' : 'mt-0.5'}`}>
                      {isFirstInGroup ? (
                        <div className="w-5 h-5 rounded-md bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-[10px] shrink-0">
                          {emoji}
                        </div>
                      ) : (
                        <div className="w-5 shrink-0" />
                      )}
                      <div className="max-w-[80%]">
                        <div className="px-2.5 py-1.5 rounded-lg rounded-bl-sm bg-white/[0.04] border border-white/[0.06] text-[11px] text-white/80">
                          {msg.messageType === 'image' && msg.imageUrl && (
                            <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.imageUrl}
                                alt="Shared image"
                                className="max-w-full max-h-36 rounded-md mb-1 object-contain"
                                loading="lazy"
                              />
                            </a>
                          )}
                          {msg.text !== 'Photo' && <span>{msg.text}</span>}
                          <span className="text-[9px] text-white/20 ml-1.5 whitespace-nowrap font-mono">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Outgoing message */
                    <div className={`flex justify-end ${isFirstInGroup ? 'mt-2' : 'mt-0.5'}`}>
                      <div className="max-w-[80%]">
                        <div className="px-2.5 py-1.5 rounded-lg rounded-br-sm bg-orange-500/10 border border-orange-500/15 text-[11px] text-white/80">
                          {msg.messageType === 'image' && msg.imageUrl && (
                            <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.imageUrl}
                                alt="Shared image"
                                className="max-w-full max-h-36 rounded-md mb-1 object-contain"
                                loading="lazy"
                              />
                            </a>
                          )}
                          {msg.text !== 'Photo' && <span>{msg.text}</span>}
                          <span className="inline-flex items-center gap-0.5 ml-1.5 align-bottom">
                            <span className="text-[9px] text-white/20 whitespace-nowrap font-mono">
                              {formatTime(msg.timestamp)}
                            </span>
                            <CheckCheck className={`w-2.5 h-2.5 ${
                              msg.isRead ? 'text-orange-400/60' : 'text-white/15'
                            }`} />
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-2 py-1.5 border-t border-white/[0.04]">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="p-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-colors disabled:opacity-50"
            title="Attach image"
          >
            {isUploading ? (
              <Loader2 className="w-3 h-3 text-white/30 animate-spin" />
            ) : (
              <Paperclip className="w-3 h-3 text-white/30" />
            )}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 px-3 py-1.5 text-[11px] bg-white/[0.02] border border-white/[0.06] rounded-lg
                       text-white placeholder:text-white/15 focus:outline-none focus:border-white/15 transition-colors font-mono"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="p-1.5 rounded-lg bg-orange-500/20 border border-orange-500/30 text-orange-400 disabled:opacity-20
                       hover:bg-orange-500/30 transition-colors"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default DirectChatView;
