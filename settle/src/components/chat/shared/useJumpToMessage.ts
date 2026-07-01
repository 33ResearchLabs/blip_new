'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseJumpToMessageOptions {
  /**
   * Load an older page of messages when the target isn't in the DOM yet.
   * Resolve to `true` if more messages were loaded, `false` when exhausted.
   */
  loadOlder?: () => Promise<boolean> | boolean;
  /** Bound on how many older pages to pull while searching. */
  maxAttempts?: number;
  /** How long the highlight flash stays, in ms. */
  flashMs?: number;
}

/**
 * "Jump to original" for reply references: scroll the target message into view
 * and flash-highlight it briefly. If the target isn't loaded, it pulls older
 * pages (bounded) until it appears. Surfaces mark rows with
 * `data-message-id={id}` and apply a highlight when `flashId === id`.
 */
export function useJumpToMessage(options?: UseJumpToMessageOptions) {
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const flash = useCallback(
    (id: string) => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      setFlashId(id);
      flashTimer.current = setTimeout(() => setFlashId(null), options?.flashMs ?? 1800);
    },
    [options?.flashMs],
  );

  const scrollToEl = useCallback((id: string): boolean => {
    if (typeof document === 'undefined') return false;
    const el = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }, []);

  const jumpTo = useCallback(
    async (id: string) => {
      if (scrollToEl(id)) {
        flash(id);
        return;
      }
      const loadOlder = options?.loadOlder;
      if (!loadOlder) return;
      const maxAttempts = options?.maxAttempts ?? 8;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const more = await loadOlder();
        // Wait a frame so the newly-loaded rows are in the DOM before we look.
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        if (scrollToEl(id)) {
          flash(id);
          return;
        }
        if (!more) break;
      }
    },
    [scrollToEl, flash, options?.loadOlder, options?.maxAttempts],
  );

  return { flashId, jumpTo };
}
