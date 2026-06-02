"use client";

import { useMemo } from "react";

// Lax shape — accepts the project's Order type plus anything with the
// few fields we read. Keeps the component decoupled from any one type.
type OrderLike = {
  amount?: number;
  orderType?: string;
  dbOrder?: { type?: string };
  protocolFeePercent?: number | null;
};

interface BalanceSparklineProps {
  /** Current USDT balance — the right-edge of the series. */
  currentBalance: number | null;
  /** Completed orders newest-first; same shape as the dashboard panel uses. */
  completedOrders: OrderLike[];
  /** Optional: how many recent orders to consider. Older orders compressed
   *  too tightly hurt readability. Default 20. */
  windowSize?: number;
  /** Optional: clip to a target render size. The component itself uses a
   *  fixed viewBox + preserveAspectRatio="none" so it stretches to the
   *  parent box. width defaults to "100%" so it fills its container;
   *  height accepts a px number. */
  width?: number | string;
  height?: number;
}

const VB_W = 200;
const VB_H = 60;

/**
 * Balance sparkline. Replays recent completed orders backwards from the
 * current balance to derive a "balance over time" series, then plots it
 * as a single SVG path with a glowing end-dot.
 *
 * Buy order = merchant SOLD crypto (balance ↓), Sell order = merchant
 * BOUGHT crypto (balance ↑ by amount minus fee). Mirrors the balance-
 * after math in CompletedOrdersPanel so the two views agree.
 *
 * Stroke color is keyed off net change across the window — emerald if
 * the balance is higher now than at the start of the window, rose if
 * lower, neutral if flat or there isn't enough data.
 */
export function BalanceSparkline({
  currentBalance,
  completedOrders,
  windowSize = 20,
  width = "100%",
  height = 60,
}: BalanceSparklineProps) {
  const series = useMemo(() => {
    if (currentBalance == null) return null;
    const slice = completedOrders.slice(0, windowSize);
    if (slice.length === 0) return null;

    // Walk backwards: each older entry is `running` BEFORE that trade
    // was applied. We push `running` (the balance AFTER each trade
    // when reading the array in display order, i.e. oldest → newest).
    // The final entry equals currentBalance.
    let running = currentBalance;
    const points: number[] = [currentBalance];
    for (const o of slice) {
      const type = o.orderType || o.dbOrder?.type;
      const amount = o.amount || 0;
      const fee = (o.protocolFeePercent ?? 0) * amount / 100;
      // Reverse the trade's effect on running.
      if (type === "buy") {
        // Merchant sold: balance went DOWN by amount when this trade
        // happened, so before it ran balance was HIGHER.
        running += amount;
      } else {
        // Merchant bought: balance went UP by (amount - fee).
        running -= amount - fee;
      }
      points.push(running);
    }
    // points is newest→oldest with currentBalance at index 0; reverse
    // so it reads oldest→newest along the X axis.
    points.reverse();
    return points;
  }, [currentBalance, completedOrders, windowSize]);

  // No real history yet — render a gentle synthetic curve so the card
  // doesn't look broken. Neutral grey + lighter stroke makes it clear
  // this is a placeholder, not a real signal.
  const isPlaceholder = !series || series.length < 2;
  const effectiveSeries: number[] = isPlaceholder
    // Subtle sine wave anchored near the middle of the viewBox so the
    // shape mimics a real sparkline at a glance.
    ? Array.from({ length: 20 }, (_, i) => Math.sin(i / 2) * 0.25 + 0.55)
    : (series as number[]);

  const min = Math.min(...effectiveSeries);
  const max = Math.max(...effectiveSeries);
  const range = max - min || 1; // avoid /0 on a flat line
  const stepX = VB_W / (effectiveSeries.length - 1);

  // Smooth path via mid-point quadratic curves so the line reads like
  // the reference design (gentle wave, no zigzag) without overshooting.
  const coords = effectiveSeries.map((v, i) => {
    const x = i * stepX;
    // Invert Y so larger values sit higher on screen.
    const y = VB_H - ((v - min) / range) * VB_H;
    return { x, y };
  });
  let d = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const cur = coords[i];
    const midX = (prev.x + cur.x) / 2;
    const midY = (prev.y + cur.y) / 2;
    d += ` Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`;
  }
  // Final straight segment to the last point so the endpoint is exact.
  const last = coords[coords.length - 1];
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;

  // Single accent colour regardless of direction — direction is already
  // signalled by the +/- 24h earnings line above the chart, so painting
  // the line red on a dip felt alarming. Theme-aware via CSS var so the
  // colour follows whichever palette the merchant is on.
  const color = "var(--color-primary)";
  const glow = color;
  // Unique gradient id per mount so multiple sparklines on one page
  // (e.g. desktop split view) don't clobber each other's defs.
  const gradientId = useMemo(
    () => `bsl-stroke-${Math.random().toString(36).slice(2, 9)}`,
    [],
  );

  return (
    <svg
      role="img"
      aria-label="Recent balance trend"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      width={width}
      height={height}
      className="block"
    >
      <defs>
        {/* Horizontal stroke gradient: faded on the LEFT (older data,
            visually receding) → solid on the RIGHT where the end-dot
            sits. Matches the reference design. */}
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="55%" stopColor={color} stopOpacity="0.45" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
      </defs>
      <path
        d={d}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: `drop-shadow(0 0 4px ${glow})` }}
      />
      {/* End-point dot — always full-opacity so it anchors the eye. */}
      <circle
        cx={last.x}
        cy={last.y}
        r="3"
        fill={color}
        style={{ filter: `drop-shadow(0 0 6px ${glow})` }}
      />
    </svg>
  );
}
