"use client";

import { memo, useMemo } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ArrowDownLeft,
  ArrowUpRight,
  Repeat,
} from "lucide-react";

interface CompletedOrdersPanelProps {
  orders: any[];
  onSelectOrder: (order: any) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

// ─── Pure helpers ─────────────────────────────────────────────────────

/** Map a fiat currency code to its symbol for the "≈ ₹X" display style. */
function currencySymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR":
      return "₹";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    case "AED":
      return "د.إ ";
    default:
      return "";
  }
}

/** Format a fiat amount as "≈ ₹9,800" (no decimals on round-ish values). */
function formatConverted(
  amount: number,
  code: string | undefined | null,
): string {
  const sym = currencySymbol(code);
  const num = Math.round(amount).toLocaleString();
  // For codes without a leading symbol, append the code as a suffix.
  return sym ? `≈ ${sym}${num}` : `≈ ${num} ${(code || "").toUpperCase()}`;
}

/** Day bucket label: "Today" / "Yesterday" / "Mar 24" / "Mar 24, 2024".
 * Each historical day gets its own header instead of being collapsed
 * into a single "Earlier" bucket. */
function dayBucket(date: Date, now: Date): string {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const dayStart = startOfDay(date);
  const dayMs = 24 * 60 * 60 * 1000;
  if (dayStart === today) return "Today";
  if (dayStart === today - dayMs) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

/** "5m ago" / "3h ago" / "Apr 9, 02:30 PM". */
function formatRelative(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Card sub-component ───────────────────────────────────────────────

function TransactionCard({
  order,
  onClick,
}: {
  order: any;
  onClick: () => void;
}) {
  const completedAt =
    order.dbOrder?.completed_at || order.dbOrder?.updated_at || order.timestamp;
  const completedDate = completedAt ? new Date(completedAt) : null;
  const orderType: "buy" | "sell" | undefined =
    order.orderType || order.dbOrder?.type;
  const cryptoCode: string = order.fromCurrency || "USDC";
  const fiatCode: string =
    order.toCurrency || order.dbOrder?.fiat_currency || "AED";
  const cryptoAmount: number = order.amount || 0;
  const fiatAmount: number = order.total ?? cryptoAmount * (order.rate || 0);

  // Direction-aware icon: BUY = incoming (down-left, green); SELL = outgoing (up-right, red);
  // unknown → neutral repeat icon. For completed cards we keep the green accent overall but
  // still show direction in the avatar.
  const isBuy = orderType === "buy";
  const isSell = orderType === "sell";
  const Icon = isBuy ? ArrowDownLeft : isSell ? ArrowUpRight : Repeat;
  const iconCls = isBuy
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
    : isSell
      ? "bg-red-500/10 text-red-400 border-red-500/20"
      : "bg-foreground/[0.06] text-foreground/60 border-foreground/[0.10]";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left rounded-xl p-4 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.06] hover:border-foreground/[0.12] transition-all duration-150 active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        {/* ─── Left: avatar + name + date ───────────────── */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center border ${iconCls}`}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-foreground truncate">
              {order.user || "Unknown"}
            </span>
            <span className="text-xs text-foreground/45 mt-0.5">
              {completedDate ? formatRelative(completedDate, new Date()) : "—"}
            </span>
          </div>
        </div>

        {/* ─── Right: amount + converted + status badge ─── */}
        <div className="flex flex-col items-end shrink-0 gap-1.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Completed
          </span>
          <span className="text-sm font-medium text-foreground tabular-nums whitespace-nowrap">
            {Math.round(cryptoAmount).toLocaleString()} {cryptoCode}
          </span>
          <span className="text-xs text-foreground/45 tabular-nums whitespace-nowrap">
            {formatConverted(fiatAmount, fiatCode)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────

export const CompletedOrdersPanel = memo(function CompletedOrdersPanel({
  orders,
  onSelectOrder,
  collapsed = false,
  onCollapseChange,
}: CompletedOrdersPanelProps) {
  // Group orders by day label. Each unique date (Today / Yesterday / Mar 24 / ...)
  // gets its own bucket, in the order it first appears in `orders` (which is
  // already sorted newest-first by the parent).
  const grouped = useMemo(() => {
    const now = new Date();
    const map = new Map<string, any[]>();
    for (const o of orders) {
      const completedAt =
        o.dbOrder?.completed_at || o.dbOrder?.updated_at || o.timestamp;
      const d = completedAt ? new Date(completedAt) : null;
      const label = d && !isNaN(d.getTime()) ? dayBucket(d, now) : "Unknown";
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(o);
    }
    return Array.from(map.entries()).map(([label, items]) => ({
      label,
      items,
    }));
  }, [orders]);

  return (
    <div className={`flex flex-col ${collapsed ? "" : "h-full"}`}>
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-section-divider cursor-pointer select-none hover:bg-foreground/[0.02] transition-colors"
        onClick={() => onCollapseChange?.(!collapsed)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`w-3 h-3 text-foreground/30 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
            />
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/50" />
            <h2 className="text-[10px] font-bold text-foreground/60 font-mono tracking-wider uppercase">
              Completed
            </h2>
          </div>
          <span className="text-[10px] border border-foreground/[0.08] text-foreground/50 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
            {orders.length}
          </span>
        </div>
      </div>

      {/* Orders List */}
      {!collapsed &&
        (orders.length === 0 ? (
          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex flex-col items-center justify-center h-full gap-3 py-10">
              <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-foreground/20" />
              </div>
              <div className="text-center">
                <p className="text-[11px] font-medium text-foreground/40 mb-0.5">
                  No completed trades
                </p>
                <p className="text-[9px] text-foreground/25 font-mono">
                  Finished orders appear here
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-3 py-1 space-y-4">
            {grouped.map((group) => (
              <section key={group.label} className="space-y-2">
                <div className="sticky top-0 z-[1] -mx-3 px-3 py-1 bg-background/95 backdrop-blur-sm">
                  <span className="text-[10px] font-bold font-mono text-foreground/45 uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.items.map((order) => (
                    <TransactionCard
                      key={order.id}
                      order={order}
                      onClick={() => onSelectOrder(order)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ))}
    </div>
  );
});
