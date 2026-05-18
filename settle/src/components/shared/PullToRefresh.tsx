"use client";

import { useRef, type ReactNode } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import {
  usePullToRefresh,
  type PullStatus,
} from "@/hooks/usePullToRefresh";

interface PullToRefreshProps {
  /** Callback fired when the user releases past `threshold`. */
  onRefresh: () => void | Promise<void>;
  /** The scrollable content this gesture is attached to. */
  children: ReactNode;
  /** px the user must pull before release triggers a refresh. Default 72. */
  threshold?: number;
  /** Extra classes on the scrolling wrapper. */
  className?: string;
  /** Disable the gesture (e.g. on desktop or inside a modal flow). */
  disabled?: boolean;
  /**
   * When true, the wrapped content also translates with the pull for a more
   * tactile feel. Default true. Set false if the children own their own
   * scroll/animation and you only want the indicator to move.
   */
  followContent?: boolean;
}

const labelFor = (status: PullStatus): string => {
  if (status === "refreshing") return "Refreshing…";
  if (status === "ready") return "Release to refresh";
  return "Pull to refresh";
};

const SPRING = "transform 360ms cubic-bezier(0.34, 1.56, 0.64, 1)";
const EASE = "all 220ms cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * Native-style pull-to-refresh wrapper. Owns its own scroll container so the
 * gesture can preventDefault cleanly without fighting the browser's built-in
 * overscroll behaviour. The indicator is rendered as an absolutely-positioned
 * overlay above the content with a soft glow that intensifies with pull.
 *
 * For pages that scroll on `window`, use the {@link usePullToRefresh} hook
 * directly instead and render the indicator inside a fixed-position element.
 */
export function PullToRefresh({
  onRefresh,
  children,
  threshold = 72,
  className,
  disabled,
  followContent = true,
}: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { pull, status, progress } = usePullToRefresh({
    onRefresh,
    threshold,
    enabled: !disabled,
    scrollContainerRef: containerRef,
  });

  const isRefreshing = status === "refreshing";
  const isActive = pull > 0 || isRefreshing;

  // Indicator visuals — scale + rotate driven by pull progress.
  const indicatorScale = 0.55 + Math.min(progress, 1) * 0.55;
  const indicatorOpacity = Math.min(0.18 + progress * 0.9, 1);
  const indicatorRotation = isRefreshing ? 0 : progress * 220;
  const arrowFlipped = status === "ready";

  // Glow halo — fades in with the pull.
  const glow = Math.min(progress, 1);

  // While the user is dragging, no CSS transition (movement must track the
  // finger 1:1). On release / refresh-complete we add a spring transition so
  // the indicator bounces back smoothly.
  const isDragging = status === "pulling" || status === "ready";
  const transformTransition = isDragging ? "none" : SPRING;

  const overlayHeight = Math.max(pull, isRefreshing ? threshold : 0);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-y-auto overscroll-y-contain ${className ?? ""}`}
      style={{
        // Belt-and-braces: also disable the browser's native pull-to-refresh
        // chrome (Chrome Android) so it never competes with our gesture.
        overscrollBehaviorY: "contain",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {/* ── Indicator overlay ─────────────────────────────────────────────── */}
      <div
        aria-hidden={!isActive}
        className="pointer-events-none absolute left-0 right-0 top-0 z-40 flex items-end justify-center"
        style={{
          height: `${overlayHeight}px`,
          transition: transformTransition,
          willChange: "height",
        }}
      >
        {/* Soft halo / blur glow that grows with the pull */}
        <div
          className="absolute left-1/2 -translate-x-1/2 rounded-full blur-2xl"
          style={{
            width: 180,
            height: 180,
            top: -40,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.42) 0%, rgba(120,180,255,0.22) 38%, rgba(120,180,255,0) 72%)",
            opacity: glow * 0.85,
            transform: `scale(${0.6 + glow * 0.7})`,
            transition: transformTransition,
          }}
        />

        {/* Spinner pill */}
        <div
          className="relative mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 backdrop-blur-md dark:bg-zinc-900/90"
          style={{
            transform: `scale(${indicatorScale}) rotate(${indicatorRotation}deg)`,
            opacity: indicatorOpacity,
            transition: transformTransition,
            boxShadow: `0 6px 22px -6px rgba(0,0,0,0.28), 0 0 ${28 * glow}px rgba(120,180,255,${0.4 * glow})`,
          }}
        >
          {isRefreshing ? (
            <Loader2 className="h-5 w-5 animate-spin text-zinc-700 dark:text-zinc-200" />
          ) : (
            <ArrowDown
              className="h-5 w-5 text-zinc-700 dark:text-zinc-200"
              style={{
                transform: `rotate(${arrowFlipped ? 180 : 0}deg)`,
                transition: EASE,
              }}
            />
          )}
        </div>
      </div>

      {/* ── Floating status label ─────────────────────────────────────────── */}
      {isActive && (
        <div
          className="pointer-events-none absolute left-0 right-0 z-40 flex justify-center"
          style={{
            top: Math.max(overlayHeight - 22, -22),
            opacity: Math.min(progress * 1.4, 1),
            transition: transformTransition,
          }}
        >
          <span className="rounded-full bg-black/55 px-3 py-[3px] text-[11px] font-medium tracking-wide text-white shadow-sm backdrop-blur-md">
            {labelFor(status)}
          </span>
        </div>
      )}

      {/* ── Content (optionally translated with the pull) ─────────────────── */}
      <div
        style={{
          transform: followContent
            ? `translate3d(0, ${pull}px, 0)`
            : undefined,
          transition: transformTransition,
          willChange: followContent ? "transform" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
