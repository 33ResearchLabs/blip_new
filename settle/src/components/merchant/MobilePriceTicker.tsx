"use client";

import { useCorridorPrices } from "@/hooks/useCorridorPrices";
import { formatRate } from "@/lib/format";

// Tiny, mobile-only ticker that replaces the legacy "stats bar" beneath the
// navbar. Renders a horizontally scrolling marquee of live prices for USDT
// and the two supported corridors (AED, INR). Reads the same singleton
// `useCorridorPrices` polling loop that the order panels use, so no extra
// network traffic.
export function MobilePriceTicker() {
  const prices = useCorridorPrices();

  // USDT is pegged — show as $1.00. AED/INR pull from the live ref price.
  const items = [
    { flag: "💵", label: "USDT", value: "$1.00", color: "text-foreground/70" },
    {
      flag: "🇦🇪",
      label: "USDT / AED",
      value: prices.USDT_AED ? formatRate(prices.USDT_AED) : "—",
      color: "text-emerald-300",
    },
    {
      flag: "🇮🇳",
      label: "USDT / INR",
      value: prices.USDT_INR ? formatRate(prices.USDT_INR) : "—",
      color: "text-amber-300",
    },
  ] as const;

  // Render the items twice so the -50% translate keyframe loops seamlessly.
  const Strip = (
    <div className="flex items-center gap-6 px-3 shrink-0">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-2 whitespace-nowrap text-[11px] font-mono">
          <span className="text-base leading-none">{it.flag}</span>
          <span className="text-foreground/40 uppercase tracking-wider">{it.label}</span>
          <span className={`font-bold tabular-nums ${it.color}`}>{it.value}</span>
        </span>
      ))}
    </div>
  );

  return (
    <div
      role="marquee"
      aria-label="Live USDT and corridor prices"
      className="md:hidden relative overflow-hidden bg-foreground/[0.02] border-b border-foreground/[0.04] py-1.5"
    >
      <div className="flex w-max animate-marquee-x">
        {Strip}
        {Strip}
      </div>
    </div>
  );
}
