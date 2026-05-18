"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export type PullStatus = "idle" | "pulling" | "ready" | "refreshing";

export interface UsePullToRefreshOptions {
  /** Called when the user releases past `threshold`. May return a promise. */
  onRefresh: () => void | Promise<void>;
  /** Distance (px) the user must pull before release triggers a refresh. */
  threshold?: number;
  /** Maximum visual pull distance (px). Past this the indicator stops moving. */
  maxPull?: number;
  /** Initial drag resistance — 0..1. Lower = stiffer rubber-band. */
  resistance?: number;
  /** Disable the gesture entirely (e.g. inside a modal / on desktop). */
  enabled?: boolean;
  /**
   * Element that actually scrolls. If omitted, the hook listens on `window`
   * and reads `document.scrollingElement.scrollTop` to decide if the user
   * is at the top.
   */
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

function getScrollTop(container: HTMLElement | null): number {
  if (container) return container.scrollTop;
  if (typeof window === "undefined") return 0;
  const el = (document.scrollingElement || document.documentElement) as HTMLElement | null;
  return el?.scrollTop ?? window.scrollY ?? 0;
}

/**
 * Native-style pull-to-refresh. Attaches passive-aware touch listeners to a
 * scroll container (or window) and exposes the current pull distance + status
 * so a presentational component can render the indicator however it likes.
 *
 * Single source of truth for the gesture so multiple surfaces (home, orders,
 * wallet, …) can share the same physics without duplicating event handling.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 72,
  maxPull = 140,
  resistance = 0.55,
  enabled = true,
  scrollContainerRef,
}: UsePullToRefreshOptions) {
  const [pull, setPull] = useState(0);
  const [status, setStatus] = useState<PullStatus>("idle");

  const pullRef = useRef(0);
  const startYRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const refreshingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Keep the latest onRefresh in a ref so re-renders don't re-attach listeners.
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    // Touch-only feature. Skip pointer / mouse environments to avoid
    // interfering with regular drag interactions on desktop.
    if (!("ontouchstart" in window)) return;

    const target: HTMLElement | Window = scrollContainerRef?.current ?? window;
    const getEl = (): HTMLElement | null => scrollContainerRef?.current ?? null;

    const scheduleSetPull = (next: number) => {
      pullRef.current = next;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setPull(next);
      });
    };

    const reset = (toIdle: boolean) => {
      activeRef.current = false;
      startYRef.current = null;
      if (toIdle) {
        scheduleSetPull(0);
        setStatus("idle");
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (e.touches.length !== 1) return;
      if (getScrollTop(getEl()) > 0) return;
      startYRef.current = e.touches[0].clientY;
      activeRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (startYRef.current == null) return;
      if (e.touches.length !== 1) return;

      const delta = e.touches[0].clientY - startYRef.current;

      // Pulling up (or stationary) — let the native scroll do its thing.
      if (delta <= 0) {
        if (activeRef.current) reset(true);
        return;
      }

      // The user may have scrolled away from the top mid-gesture (e.g. they
      // pulled, then the page momentum kept scrolling down). Bail out.
      if (getScrollTop(getEl()) > 0) {
        reset(true);
        return;
      }

      // Rubber-band resistance — diminishing returns past the threshold so
      // the indicator never feels like it's "stuck" but also never overshoots.
      const eased =
        delta < threshold
          ? delta * resistance
          : threshold * resistance + (delta - threshold) * resistance * 0.35;
      const clamped = Math.min(eased, maxPull);

      activeRef.current = true;
      // preventDefault blocks the browser's own overscroll / pull-to-refresh
      // chrome behaviour. Must be a non-passive listener (registered below).
      if (e.cancelable) e.preventDefault();

      scheduleSetPull(clamped);
      setStatus(clamped >= threshold ? "ready" : "pulling");
    };

    const onTouchEnd = async () => {
      if (refreshingRef.current) return;
      const wasActive = activeRef.current;
      const finalPull = pullRef.current;
      activeRef.current = false;
      startYRef.current = null;

      if (!wasActive) return;

      if (finalPull >= threshold) {
        refreshingRef.current = true;
        setStatus("refreshing");
        // Park indicator at threshold height while the refresh runs.
        scheduleSetPull(threshold);
        try {
          await onRefreshRef.current();
        } catch {
          // Swallow — the consumer is responsible for surfacing failures.
          // We still need to reset the indicator so the UI doesn't hang.
        } finally {
          refreshingRef.current = false;
          scheduleSetPull(0);
          setStatus("idle");
        }
      } else {
        scheduleSetPull(0);
        setStatus("idle");
      }
    };

    const onTouchCancel = () => {
      if (refreshingRef.current) return;
      reset(true);
    };

    // touchstart/touchmove MUST be {passive: false} because we conditionally
    // call preventDefault during the pull. touchend/touchcancel can stay
    // passive (no preventDefault inside).
    const moveOpts: AddEventListenerOptions = { passive: false };
    const endOpts: AddEventListenerOptions = { passive: true };

    target.addEventListener("touchstart", onTouchStart as EventListener, moveOpts);
    target.addEventListener("touchmove", onTouchMove as EventListener, moveOpts);
    target.addEventListener("touchend", onTouchEnd as EventListener, endOpts);
    target.addEventListener("touchcancel", onTouchCancel as EventListener, endOpts);

    return () => {
      target.removeEventListener("touchstart", onTouchStart as EventListener);
      target.removeEventListener("touchmove", onTouchMove as EventListener);
      target.removeEventListener("touchend", onTouchEnd as EventListener);
      target.removeEventListener("touchcancel", onTouchCancel as EventListener);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled, threshold, maxPull, resistance, scrollContainerRef]);

  return {
    /** Current visual pull distance in px (after resistance + clamping). */
    pull,
    /** Lifecycle state — drives indicator label and visuals. */
    status,
    /** 0..1 ratio of pull to threshold — handy for scaling / opacity. */
    progress: Math.min(pull / threshold, 1),
    isRefreshing: status === "refreshing",
  };
}
