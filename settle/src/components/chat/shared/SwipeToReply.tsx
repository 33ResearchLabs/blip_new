'use client';

import { useRef, useState, type ReactNode } from 'react';
import { Reply } from 'lucide-react';
import { useSwipeToReply } from './useSwipeToReply';

interface SwipeToReplyProps {
  onReply: () => void;
  /** When false, the wrapper is inert — children render exactly as before. */
  canReply: boolean;
  children: ReactNode;
  /** Show the desktop hover Reply button. Default true. */
  showHoverButton?: boolean;
  className?: string;
}

/**
 * Additive wrapper that adds a hover Reply button (desktop, mouse) + swipe-to-
 * reply (mouse drag + touch) AROUND an existing message row. It never alters the
 * child's rendering — zero regression by construction. When `canReply` is false
 * it is a transparent pass-through.
 *
 * The hover button uses explicit onMouseEnter/Leave state (not Tailwind
 * `group-hover`), which reliably fires regardless of stacking / nested groups.
 * It only reacts to a mouse hover, so touch devices never see it (they swipe).
 */
export function SwipeToReply({
  onReply,
  canReply,
  children,
  showHoverButton = true,
  className,
}: SwipeToReplyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const { replyReady, dragging, swipeHandlers } = useSwipeToReply(ref, {
    onReply,
    enabled: canReply,
  });

  if (!canReply) {
    return <div className={className}>{children}</div>;
  }

  const showButton = showHoverButton && hovered && !dragging;

  return (
    <div
      className={`relative ${className ?? ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Reply icon revealed on the trailing (right) edge while dragging left. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute right-2 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full transition-opacity ${
          dragging ? 'opacity-100' : 'opacity-0'
        } ${replyReady ? 'bg-indigo-500 text-white' : 'bg-white/10 text-gray-400'}`}
      >
        <Reply className="h-4 w-4" />
      </span>

      {/* The existing bubble — transformed during drag via a direct style write. */}
      <div ref={ref} style={{ touchAction: 'pan-y' }} {...swipeHandlers}>
        {children}
      </div>

      {/* Desktop hover affordance for users who prefer not to drag. */}
      {showHoverButton && (
        <button
          type="button"
          onClick={onReply}
          aria-label="Reply"
          className={`absolute right-1 top-1 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-gray-100 outline-none transition-opacity hover:bg-black/80 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/60 ${
            showButton ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <Reply className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
