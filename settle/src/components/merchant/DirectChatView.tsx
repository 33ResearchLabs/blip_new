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
    <div className="h-full flex flex-col bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] bg-[#0d0d0d]">
        <button
          onClick={onBack}
          className="p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-white/60" />
        </button>
        <div className="w-9 h-9 rounded-full bg-white/5 border border-white/6 flex items-center justify-center text-base">
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-white truncate">{contactName}</span>
            {contactType === 'merchant' ? (
              <Store className="w-3.5 h-3.5 text-[#c9a962]" />
            ) : (
              <User className="w-3.5 h-3.5 text-white/40" />
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-[#c9a962] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40">
            <p className="text-sm">No messages yet</p>
            <p className="text-xs mt-1">Say hello!</p>
          </div>
        ) : (
          <div className="space-y-1">
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
                    <div className="flex justify-center my-3">
                      <span className="text-[10px] text-white/30 bg-white/5 px-2.5 py-0.5 rounded-full">
                        {msgDate}
                      </span>
                    </div>
                  )}

                  {msg.from === 'them' ? (
                    /* Incoming message with avatar */
                    <div className={`flex items-end gap-2 ${isFirstInGroup ? 'mt-3' : 'mt-0.5'}`}>
                      {isFirstInGroup ? (
                        <div className="w-6 h-6 rounded-full bg-white/5 border border-white/6 flex items-center justify-center text-xs shrink-0">
                          {emoji}
                        </div>
                      ) : (
                        <div className="w-6 shrink-0" />
                      )}
                      <div className="max-w-[75%]">
                        <div className="px-3 py-2 rounded-2xl rounded-bl-md bg-white/[0.06] text-sm text-white/90">
                          {msg.messageType === 'image' && msg.imageUrl && (
                            <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.imageUrl}
                                alt="Shared image"
                                className="max-w-full max-h-48 rounded-lg mb-1 object-contain"
                                loading="lazy"
                              />
                            </a>
                          )}
                          {msg.text !== 'Photo' && <span>{msg.text}</span>}
                          <span className="text-[9px] text-white/30 ml-2 whitespace-nowrap">
                            {formatTime(msg.timestamp)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Outgoing message with read receipts */
                    <div className={`flex justify-end ${isFirstInGroup ? 'mt-3' : 'mt-0.5'}`}>
                      <div className="max-w-[75%]">
                        <div className="px-3 py-2 rounded-2xl rounded-br-md bg-[#c9a962]/20 text-sm text-white">
                          {msg.messageType === 'image' && msg.imageUrl && (
                            <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.imageUrl}
                                alt="Shared image"
                                className="max-w-full max-h-48 rounded-lg mb-1 object-contain"
                                loading="lazy"
                              />
                            </a>
                          )}
                          {msg.text !== 'Photo' && <span>{msg.text}</span>}
                          <span className="inline-flex items-center gap-0.5 ml-2 align-bottom">
                            <span className="text-[9px] text-white/30 whitespace-nowrap">
                              {formatTime(msg.timestamp)}
                            </span>
                            <CheckCheck className={`w-3.5 h-3.5 ${
                              msg.isRead ? 'text-[#c9a962]' : 'text-white/25'
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
      <div className="px-4 py-3 border-t border-white/[0.04] bg-[#0d0d0d]">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="p-2.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] transition-colors disabled:opacity-50"
            title="Attach image"
          >
            {isUploading ? (
              <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
            ) : (
              <Paperclip className="w-4 h-4 text-white/40" />
            )}
          </button>
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 text-sm bg-white/[0.04] border border-white/[0.08] rounded-full
                       text-white placeholder:text-white/40 focus:outline-none focus:border-[#c9a962]/50"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="p-2.5 rounded-full bg-[#c9a962] text-black disabled:opacity-30
                       hover:bg-[#d4b46e] transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default DirectChatView;
