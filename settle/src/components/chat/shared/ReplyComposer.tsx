'use client';

import { X } from 'lucide-react';
import type { ReplyDraft } from './types';
import { ReplyPreview } from './ReplyPreview';

interface ReplyComposerProps {
  draft: ReplyDraft;
  onCancel: () => void;
  className?: string;
}

/**
 * Banner shown above the message input while composing a reply: original
 * sender, a message-type preview, and a close (X) button. Additive — surfaces
 * render it just above their existing composer, so the input is untouched.
 */
export function ReplyComposer({ draft, onCancel, className }: ReplyComposerProps) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border-l-2 border-indigo-400 bg-white/[0.04] px-3 py-2 ${className ?? ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-text-primary">
          Replying to {draft.isMe ? 'yourself' : draft.senderName || 'Unknown'}
        </div>
        <ReplyPreview reference={draft} className="text-text-secondary" />
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        className="shrink-0 rounded p-1 text-gray-400 outline-none transition-colors hover:text-gray-200 focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
