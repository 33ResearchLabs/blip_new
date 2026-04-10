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
  walletBalance?: number | null;
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
  balanceAfter,
}: {
  order: any;
  onClick: () => void;
  balanceAfter?: number;
}) {
  const completedAt =
    order.dbOrder?.completed_at || order.dbOrder?.updated_at || order.timestamp;
  const completedDate = completedAt ? new Date(completedAt) : null;
  const orderType: "buy" | "sell" | undefined =
    order.orderType || order.dbOrder?.type;
  const cryptoCode: string = order.fromCurrency || "USDT";
  const fiatCode: string =
    order.toCurrency || order.dbOrder?.fiat_currency || "AED";
  const cryptoAmount: number = order.amount || 0;
  const fiatAmount: number = order.total ?? cryptoAmount * (order.rate || 0);
  const orderNumber: string = order.dbOrder?.order_number || "";

  // Fee calculation — net amount after platform fee
  const feePercent = order.protocolFeePercent
    ?? parseFloat(String(order.dbOrder?.protocol_fee_percentage ?? 0));
  const feeAmount = cryptoAmount * (feePercent / 100);
  const netCryptoAmount = cryptoAmount - feeAmount;
  const netFiatAmount = fiatAmount - (fiatAmount * (feePercent / 100));

  // Merchant perspective: order type is from user's view.
  // buy order = user buys, merchant SELLS (crypto goes out, fiat comes in)
  // sell order = user sells, merchant BUYS (crypto comes in, fiat goes out)
  const isBuy = orderType === "buy";
  const isSell = orderType === "sell";
  const merchantSold = isBuy;   // merchant sold crypto, got fiat
  const merchantBought = isSell; // merchant bought crypto, paid fiat

  // Show what the merchant GOT (net after fee)
  // Sold: merchant got fiat (net) → show fiat in green
  // Bought: merchant got crypto (net) → show crypto in green
  const Icon = merchantBought ? ArrowDownLeft : merchantSold ? ArrowUpRight : Repeat;
  const tagLabel = merchantSold ? "SELL" : merchantBought ? "BUY" : "TRADE";
  const tagCls = merchantSold
    ? "bg-[var(--color-error)]/10 text-[var(--color-error)]"
    : merchantBought
      ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
      : "bg-foreground/[0.06] text-foreground/50";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-foreground/[0.04] transition-colors active:scale-[0.99]"
    >
      {/* Icon */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${isBuy ? 'bg-emerald-500/10' : isSell ? 'bg-red-500/10' : 'bg-foreground/[0.05]'}`}>
        <Icon className={`w-3.5 h-3.5 ${isBuy ? 'text-emerald-400' : isSell ? 'text-red-400' : 'text-foreground/50'}`} />
      </div>

      {/* Middle: name + order + time */}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-foreground truncate">
            {order.user || "Unknown"}
          </span>
          <span className={`text-[8px] font-bold px-1 py-[1px] rounded ${tagCls}`}>
            {tagLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {orderNumber && (
            <span className="text-[9px] text-foreground/25 font-mono">
              {orderNumber.slice(0, 15)}
            </span>
          )}
          <span className="text-[9px] text-foreground/20">
            {completedDate ? formatRelative(completedDate, new Date()) : "—"}
          </span>
        </div>
      </div>

      {/* Right: amount + balance after */}
      <div className="flex flex-col items-end shrink-0">
        {merchantSold ? (
          <>
            <span className="text-[12px] font-bold font-mono tabular-nums text-[var(--color-error)]">
              -{Math.round(cryptoAmount).toLocaleString()} {cryptoCode}
            </span>
            <span className="text-[9px] text-foreground/30 font-mono tabular-nums">
              {formatConverted(fiatAmount, fiatCode)}
            </span>
          </>
        ) : merchantBought ? (
          <>
            <span className="text-[12px] font-bold font-mono tabular-nums text-[var(--color-success)]">
              +{Math.round(netCryptoAmount).toLocaleString()} {cryptoCode}
            </span>
            <span className="text-[9px] text-foreground/30 font-mono tabular-nums">
              {formatConverted(fiatAmount, fiatCode)}
            </span>
          </>
        ) : (
          <>
            <span className="text-[12px] font-bold font-mono tabular-nums text-foreground/80">
              {Math.round(cryptoAmount).toLocaleString()} {cryptoCode}
            </span>
            <span className="text-[9px] text-foreground/30 font-mono tabular-nums">
              {formatConverted(fiatAmount, fiatCode)}
            </span>
          </>
        )}
        {balanceAfter != null && (
          <span className="text-[9px] text-foreground/40 font-mono tabular-nums mt-0.5">
            Bal: {Math.round(balanceAfter).toLocaleString()} USDT
          </span>
        )}
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
  walletBalance,
}: CompletedOrdersPanelProps) {
  // Compute running balance backwards from current wallet balance.
  // Orders are sorted newest-first, so we subtract each order's net effect.
  const balanceAfterMap = useMemo(() => {
    if (walletBalance == null) return new Map<string, number>();
    const map = new Map<string, number>();
    let running = walletBalance;
    for (const o of orders) {
      const orderType = o.orderType || o.dbOrder?.type;
      const amount = o.amount || 0;
      const feePercent = o.protocolFeePercent ?? parseFloat(String(o.dbOrder?.protocol_fee_percentage ?? 0));
      const fee = amount * (feePercent / 100);
      map.set(o.id, running);
      // Work backwards: reverse the effect of this trade
      if (orderType === "buy") {
        // Merchant sold crypto: balance went down by (amount)
        running += amount;
      } else {
        // Merchant bought crypto: balance went up by (amount - fee)
        running -= (amount - fee);
      }
    }
    return map;
  }, [orders, walletBalance]);
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
          <div className="flex-1 overflow-y-auto px-1.5 py-1">
            {grouped.map((group) => (
              <section key={group.label}>
                <div className="sticky top-0 z-[1] px-2 py-1.5 bg-background/95 backdrop-blur-sm">
                  <span className="text-[9px] font-bold font-mono text-foreground/35 uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.items.map((order) => (
                    <TransactionCard
                      key={order.id}
                      order={order}
                      onClick={() => onSelectOrder(order)}
                      balanceAfter={balanceAfterMap.get(order.id)}
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
