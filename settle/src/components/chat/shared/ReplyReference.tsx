'use client';

import type { ReplyReference as ReplyRef } from './types';
import { ReplyPreview } from './ReplyPreview';

interface ReplyReferenceProps {
  reference: ReplyRef;
  /** When provided, the block is clickable and jumps to the original message. */
  onJump?: (id: string) => void;
  className?: string;
}

/**
 * The compact quoted block rendered ABOVE a message that is a reply. Additive —
 * surfaces render it just above their existing bubble content, so it never
 * changes how the message itself renders. Clicking jumps to the original.
 */
export function ReplyReference({ reference, onJump, className }: ReplyReferenceProps) {
  const clickable = !!onJump;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={clickable ? () => onJump?.(reference.id) : undefined}
      aria-label={
        clickable ? `Reply to ${reference.senderName ?? 'a message'}, jump to original` : undefined
      }
      className={`flex w-full items-stretch gap-2 overflow-hidden rounded-md bg-current/[0.13] px-2 py-1 text-left ${
        clickable ? 'cursor-pointer hover:bg-current/20' : 'cursor-default'
      } ${className ?? ''}`}
    >
      <span aria-hidden className="w-[3px] shrink-0 rounded-full bg-indigo-400" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-current opacity-95">
          {reference.senderName || 'Unknown'}
        </span>
        <ReplyPreview reference={reference} className="opacity-80" />
      </span>
    </button>
  );
}
