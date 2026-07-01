"use client";

import { useEffect, useRef } from "react";

/**
 * Auto-focus a form field when a modal opens — but ONLY on precise-pointer
 * (desktop) devices.
 *
 * Plain `autoFocus` / an unconditional `.focus()` pops the on-screen keyboard
 * on phones and tablets, which is why blanket autofocus was deferred. Gating on
 * `(pointer: fine)` keeps the desktop convenience (start typing immediately)
 * without the mobile keyboard-pop.
 *
 * Usage:
 *   const ref = useDesktopAutoFocus<HTMLInputElement>(isOpen);
 *   <input ref={ref} ... />
 *
 * @param active  Re-focus each time this flips false→true (e.g. pass the
 *                modal's `isOpen`). Defaults to true for always-mounted fields.
 */
export function useDesktopAutoFocus<T extends HTMLElement>(active: boolean = true) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;
    // Only where a physical keyboard is likely — avoids the mobile keyboard pop.
    const finePointer = window.matchMedia?.("(pointer: fine)")?.matches;
    if (!finePointer) return;
    // Defer a tick so the modal's mount/enter animation settles before focus,
    // otherwise the focus can be lost to the animating container.
    const id = window.setTimeout(() => ref.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [active]);

  return ref;
}
