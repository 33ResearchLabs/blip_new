"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

interface UseSwipeToReplyOptions {
  onReply: () => void;
  enabled?: boolean;
  /** Horizontal distance (px) to trigger reply. WhatsApp-ish default. */
  threshold?: number;
  /** Clamp the drag so the row can't be dragged arbitrarily far. */
  maxDrag?: number;
}

export interface SwipeHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
}

/**
 * WhatsApp-style swipe-to-reply. Rightward drag past a threshold fires onReply.
 *
 * Performance: the transform is written straight to the element via the passed
 * ref during pointermove (no per-frame React re-render → 60fps). React state is
 * used only for the discrete `replyReady` flag (flips at most twice per gesture).
 *
 * Scroll-conflict: the consumer sets `touch-action: pan-y` on the element, so
 * the browser keeps vertical scrolling while we own horizontal gestures. We also
 * lock to the dominant axis on first movement as a belt-and-braces guard.
 */
export function useSwipeToReply<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
  {
    onReply,
    enabled = true,
    threshold = 32,
    maxDrag = 44,
  }: UseSwipeToReplyOptions,
): { replyReady: boolean; dragging: boolean; swipeHandlers: SwipeHandlers } {
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"h" | "v" | null>(null);
  const dragX = useRef(0);
  const [replyReady, setReplyReady] = useState(false);
  // True only while an active horizontal drag is in progress — lets the caller
  // hide the reply-reveal icon at rest (otherwise it shows behind right-aligned
  // own-messages that don't cover the leading edge).
  const [dragging, setDragging] = useState(false);

  const setTransform = useCallback(
    (x: number) => {
      dragX.current = x;
      const el = elementRef.current;
      if (el) el.style.transform = x ? `translateX(${x}px)` : "";
    },
    [elementRef],
  );

  const reset = useCallback(() => {
    const el = elementRef.current;
    if (el) {
      el.style.transition = "transform 0.18s ease-out";
      el.style.transform = "";
      const clear = () => {
        el.style.transition = "";
        el.removeEventListener("transitionend", clear);
      };
      el.addEventListener("transitionend", clear);
    }
    dragX.current = 0;
    setReplyReady(false);
    setDragging(false);
  }, [elementRef]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      // Mouse, touch and pen all get the drag gesture (desktop ALSO has the
      // hover Reply button). Ignore non-left mouse buttons only.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      start.current = { x: event.clientX, y: event.clientY };
      axis.current = null;
      const el = elementRef.current;
      if (el) el.style.transition = "";
    },
    [enabled, elementRef],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled || !start.current) return;
      const dx = event.clientX - start.current.x;
      const dy = event.clientY - start.current.y;

      if (axis.current === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // ignore tiny jitter
        axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
      if (axis.current !== "h") return; // vertical intent → let the list scroll

      setDragging(true);
      const x = Math.min(0, Math.max(dx, -maxDrag)); // reply is a leftward swipe
      setTransform(x);
      const ready = x <= -threshold;
      setReplyReady((prev) => (prev !== ready ? ready : prev));
    },
    [enabled, threshold, maxDrag, setTransform],
  );

  const finish = useCallback(() => {
    if (!start.current) return;
    const triggered = dragX.current <= -threshold;
    reset();
    start.current = null;
    axis.current = null;
    if (triggered) onReply();
  }, [reset, threshold, onReply]);

  // ─── Trackpad two-finger swipe (Telegram / iMessage on macOS) ────────────
  // A two-finger horizontal swipe is delivered by the OS as a horizontal-
  // dominant `wheel` event (deltaX), NOT a pointer drag. We slide the message
  // left with the fingers and fire reply past the threshold. A NATIVE
  // non-passive listener is required so we can preventDefault the browser's
  // two-finger back/forward swipe-navigation and horizontal page scroll.
  const onReplyRef = useRef(onReply);
  useEffect(() => {
    onReplyRef.current = onReply;
  });

  useEffect(() => {
    const el = elementRef.current;
    if (!el || !enabled) return;

    let offset = 0;
    let endTimer: ReturnType<typeof setTimeout> | null = null;
    // Axis is locked once per gesture and released when it settles, so a
    // slightly-diagonal trackpad swipe still engages reliably (and a vertical
    // scroll stays a scroll). This mirrors the pointer-drag axis lock.
    let wheelAxis: "h" | "v" | null = null;

    const springBack = (fire: boolean) => {
      el.style.transition = "transform 0.18s ease-out";
      el.style.transform = "";
      const clear = () => {
        el.style.transition = "";
        el.removeEventListener("transitionend", clear);
      };
      el.addEventListener("transitionend", clear);
      offset = 0;
      setDragging(false);
      setReplyReady(false);
      if (fire) onReplyRef.current();
    };

    const onWheel = (event: WheelEvent) => {
      // First meaningful event of a gesture decides the axis for the whole run.
      if (wheelAxis === null) {
        if (Math.abs(event.deltaX) < 1 && Math.abs(event.deltaY) < 1) return;
        wheelAxis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "h" : "v";
      }

      if (wheelAxis !== "h") {
        // Vertical gesture — let the list scroll. Release the lock once the
        // scroll settles so the next gesture is re-evaluated.
        if (endTimer) clearTimeout(endTimer);
        endTimer = setTimeout(() => {
          wheelAxis = null;
        }, 90);
        return;
      }

      // Horizontal swipe → own it. Stop the browser's two-finger back/forward
      // navigation + horizontal page scroll.
      event.preventDefault();

      // Natural scrolling: a leftward two-finger swipe reports deltaX > 0, so
      // subtracting it moves the message left (negative translateX).
      offset = Math.max(-maxDrag, Math.min(0, offset - event.deltaX));
      el.style.transition = "";
      el.style.transform = offset ? `translateX(${offset}px)` : "";
      setDragging(true);
      setReplyReady(offset <= -threshold);

      // The gesture has no explicit end — settle shortly after the last event.
      if (endTimer) clearTimeout(endTimer);
      endTimer = setTimeout(() => {
        springBack(offset <= -threshold);
        wheelAxis = null;
      }, 90);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (endTimer) clearTimeout(endTimer);
    };
  }, [elementRef, enabled, threshold, maxDrag]);

  return {
    replyReady,
    dragging,
    swipeHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
