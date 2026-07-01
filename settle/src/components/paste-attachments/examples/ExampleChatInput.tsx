'use client';

import { useCallback, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { PasteAttachments } from '../PasteAttachments';
import type { ChatAttachment } from '../types';

/** Max visible height of the auto-growing textarea, in px (matches `max-h-40`). */
const MAX_TEXTAREA_HEIGHT = 160;

/**
 * A small, self-contained chat composer demonstrating how to wire
 * {@link PasteAttachments} into a real input. It is intentionally decoupled
 * from any backend — "sending" just logs the parsed attachment metadata and
 * clears the state (which triggers object-URL cleanup in the hook).
 */

const ACCEPTED_TYPES = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'text/plain',
  'text/csv',
];

export function ExampleChatInput() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit its content (capped) so multi-line pastes stay
  // fully visible instead of hiding inside a one-row box.
  const autoGrow = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  // Text-only pastes are inserted natively by the textarea, which preserves the
  // copied line breaks and whitespace exactly. This fires purely as a
  // notification — we do NOT re-insert (that would duplicate the native paste).
  // `html` carries the original rich formatting if the source had any.
  const handleTextPaste = useCallback((pasted: string, html: string) => {
    console.log('[PasteAttachments] text pasted:', { text: pasted, html });
  }, []);

  const handleSend = useCallback(() => {
    console.log('Sending message:', {
      text,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        mimeType: attachment.mimeType,
        size: attachment.size,
        extension: attachment.extension,
      })),
    });
    setText('');
    setAttachments([]); // the hook revokes object URLs via its controlled-list reconcile
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [text, attachments]);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <PasteAttachments
      attachments={attachments}
      onAttachmentsChange={setAttachments}
      onTextPaste={handleTextPaste}
      maxFileSize={20 * 1024 * 1024}
      maxFiles={10}
      acceptedTypes={ACCEPTED_TYPES}
      className="rounded-2xl border border-white/10 bg-[#141414] p-3"
    >
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            autoGrow();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (canSend) handleSend();
            }
          }}
          rows={1}
          maxLength={1000}
          placeholder="Type a message or press Ctrl/Cmd+V to paste files…"
          aria-label="Message"
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2 text-sm text-gray-100 outline-none placeholder:text-gray-500"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </PasteAttachments>
  );
}

export default ExampleChatInput;
