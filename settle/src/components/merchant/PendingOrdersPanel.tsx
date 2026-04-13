"use client";

import { memo, useRef, useState, useEffect, useMemo } from "react";
import {
  Search,
  SlidersHorizontal,
  Loader2,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  Zap,
  Target,
  Clock,
  ArrowRight,
  Flame,
  ChevronDown,
  Check,
  XCircle,
  CheckCircle2,
  AlertCircle,
  CircleDot,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CountdownRing } from "./CountdownRing";
import { useMerchantStore } from "@/stores/merchantStore";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { useSounds } from "@/hooks/useSounds";

interface PendingOrdersPanelProps {
  orders: any[];
  mempoolOrders: any[];
  merchantInfo: any;
  onSelectOrder: (order: any) => void;
  onSelectMempoolOrder: (order: any) => void;
  onAcceptOrder: (order: any) => void;
  acceptingOrderId?: string | null;
  fetchOrders: () => void;
  onCancelOrder?: (order: any) => void;
  onOpenChat?: (order: any) => void;
  // Pagination
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

// ─── Virtualized order list (renders only visible rows) ──────────
const ITEM_HEIGHT = 170; // Estimated row height in px (mempool cards are taller with earnings hero)

const OrderList = memo(function OrderList({
  filteredOrders,
  merchantInfo,
  onSelectOrder,
  onSelectMempoolOrder,
  onAcceptOrder,
  acceptingOrderId,
}: {
  filteredOrders: any[];
  merchantInfo: any;
  onSelectOrder: (order: any) => void;
  onSelectMempoolOrder: (order: any) => void;
  onAcceptOrder: (order: any) => void;
  acceptingOrderId?: string | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Live tick — updates every second for countdown + fee decay
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const virtualizer = useVirtualizer({
    count: filteredOrders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  if (filteredOrders.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-1.5">
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-foreground/20" />
          </div>
          <div className="text-center">
            <p className="text-[11px] font-medium text-foreground/30 mb-0.5">
              No pending orders
            </p>
            <p className="text-[9px] text-foreground/15 font-mono">
              New orders from the network show here
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto p-1.5">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const order = filteredOrders[virtualRow.index];
          const isMempoolOrder = (order as any).isMempoolOrder;
          const isMyMempoolOrder = (order as any).isMyMempoolOrder;

          if (isMempoolOrder) {
            const mOrder = order as any;
            const amount = Number(mOrder.amount_usdt);

            // Live decay: compute elapsed since data was received
            const elapsed = Math.floor(
              (now - (mOrder._receivedAt || now)) / 1000,
            );
            const liveExpiry = Math.max(
              0,
              mOrder.seconds_until_expiry - elapsed,
            );

            // Premium decays between bumps (resets on next data fetch)
            const bumpInterval = mOrder.bump_interval_sec || 60;
            const bumpStep = mOrder.bump_step_bps || 10;
            const decayPerSec = bumpStep / bumpInterval;
            const decayedBps = Math.max(
              mOrder.premium_bps_current - bumpStep,
              mOrder.premium_bps_current - elapsed * decayPerSec,
            );
            const livePremiumPct = decayedBps / 100;
            const livePrice = (
              Number(mOrder.ref_price_at_create) *
              (1 + decayedBps / 10000)
            ).toFixed(2);

            // YOUR CUT — what the merchant earns by accepting
            const yourCut = amount * (decayedBps / 10000);

            // Decay progress: 1.0 right after bump, 0.0 at next bump
            const decayProgress = Math.max(
              0,
              Math.min(1, 1 - (elapsed * decayPerSec) / bumpStep),
            );

            // Max possible earnings (at premium cap)
            const maxCut = amount * (mOrder.premium_bps_cap / 10000);

            const fiatTotal = Math.round(amount * Number(livePrice));

            return (
              <div
                key={mOrder.id}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="pb-1"
              >
                <div
                  onClick={() => onSelectMempoolOrder(mOrder)}
                  className={`relative p-2.5 rounded-lg border transition-colors cursor-pointer ${
                    isMyMempoolOrder
                      ? "bg-white/[0.01] border-foreground/[0.04] opacity-50"
                      : "glass-card border-white/[0.10] hover:border-primary/30 ring-1 ring-white/[0.04]"
                  }`}
                >
                  {/* Live pulse dot */}
                  <span className="absolute -top-1 -left-1 flex h-2.5 w-2.5 z-20">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                  </span>
                  {/* Processing banner */}
                  {acceptingOrderId === mOrder.id && (
                    <div className="flex items-center gap-1.5 px-2 py-1 mb-1.5 rounded bg-primary/10 border border-primary/20">
                      <Loader2 className="w-3 h-3 text-primary animate-spin" />
                      <span className="text-[9px] text-primary font-mono font-bold tracking-wider uppercase">
                        Accepting...
                      </span>
                    </div>
                  )}
                  {/* Waiting banner for own orders */}
                  {isMyMempoolOrder && !acceptingOrderId && (
                    <div className="flex items-center gap-1.5 px-2 py-1 mb-1.5 rounded bg-foreground/[0.02] border border-foreground/[0.04]">
                      <div className="w-1 h-1 bg-white/20 rounded-full animate-breathe" />
                      <span className="text-[9px] text-foreground/30 font-mono font-bold tracking-wider uppercase">
                        Waiting for acceptance
                      </span>
                    </div>
                  )}
                  {/* Row 1: User + tags on left, timer on right */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="w-7 h-7 rounded-lg bg-primary/[0.06] flex items-center justify-center shrink-0 text-sm border border-primary/20">
                        <Zap className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <span className="text-xs font-medium text-white truncate">
                        {mOrder.creator_username || `#${mOrder.order_number}`}
                      </span>
                      <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border bg-[var(--color-error)]/10 border-[var(--color-error)]/20 text-[var(--color-error)]">
                        You Pay
                      </span>
                      <span className="flex items-center gap-0.5 text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border bg-primary/10 border-primary/20 text-primary">
                        <Zap className="w-2.5 h-2.5" />
                        PRIORITY
                      </span>
                      {isMyMempoolOrder && (
                        <span className="px-1 py-0.5 bg-foreground/[0.04] border border-foreground/[0.06] rounded text-[9px] font-bold text-foreground/40">
                          YOURS
                        </span>
                      )}
                    </div>
                    {/* Timer */}
                    <div
                      className={`flex items-center gap-1 text-sm font-bold font-mono tabular-nums shrink-0 ml-auto ${
                        liveExpiry <= 120 ? "text-red-400" : "text-primary"
                      }`}
                    >
                      {liveExpiry <= 0
                        ? "Expired"
                        : liveExpiry >= 3600
                          ? `${Math.floor(liveExpiry / 3600)}h ${Math.floor((liveExpiry % 3600) / 60)}m`
                          : liveExpiry >= 60
                            ? `${Math.floor(liveExpiry / 60)}m ${liveExpiry % 60}s`
                            : `${liveExpiry}s`}
                      <span
                        className="animate-pulse"
                        style={{
                          filter:
                            liveExpiry <= 120
                              ? "drop-shadow(0 0 6px #ef4444)"
                              : "drop-shadow(0 0 4px #f97316)",
                        }}
                      >
                        🔥
                      </span>
                    </div>
                  </div>

                  {/* Warning banner when under 5 minutes */}
                  {liveExpiry > 0 && liveExpiry <= 300 && (
                    <div
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-1 ${
                        liveExpiry <= 120
                          ? "bg-red-500/10 border border-red-500/20"
                          : "bg-primary/10 border border-primary/20"
                      }`}
                    >
                      <span className="text-xs shrink-0">🔥</span>
                      <span
                        className={`text-[10px] font-bold ${liveExpiry <= 120 ? "text-red-400" : "text-primary"}`}
                      >
                        {liveExpiry <= 120
                          ? "Expiring soon! Act now"
                          : `Expires in ${Math.floor(liveExpiry / 60)}m ${liveExpiry % 60}s`}
                      </span>
                    </div>
                  )}

                  {/* Row 2: You Pay / You Get */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm tabular-nums">
                      <span className="text-[10px] text-[var(--color-error)] font-mono mr-1">
                        Pay
                      </span>
                      <span className="font-bold text-foreground">
                        {Math.round(amount).toLocaleString()} USDT
                      </span>
                    </span>
                    <ArrowRight className="w-3 h-3 text-foreground/20" />
                    <span className="text-sm tabular-nums">
                      <span className="text-[10px] text-[var(--color-success)] font-mono mr-1">
                        Get
                      </span>
                      <span className="font-bold text-[var(--color-success)]">
                        {fiatTotal.toLocaleString()}{" "}
                        {(mOrder as any).corridor_id === "USDT_INR"
                          ? "INR"
                          : "AED"}
                      </span>
                    </span>
                    {yourCut > 0 && (
                      <span className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                        +${yourCut.toFixed(2)}
                      </span>
                    )}
                  </div>

                  {/* Row 3: Rate + action button */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-foreground/40 font-mono">
                      @ {livePrice}
                    </span>
                    {livePremiumPct > 0 && (
                      <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        +{livePremiumPct.toFixed(2)}%
                      </span>
                    )}
                    <div className="flex-1" />
                    {!isMyMempoolOrder && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAcceptOrder(mOrder);
                        }}
                        disabled={acceptingOrderId === mOrder.id}
                        className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all press-effect shrink-0 flex items-center gap-1 ${
                          acceptingOrderId === mOrder.id
                            ? "bg-primary/50 text-black/60 cursor-wait"
                            : "bg-primary text-background hover:bg-primary"
                        }`}
                      >
                        {acceptingOrderId === mOrder.id ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />{" "}
                            Accepting...
                          </>
                        ) : (
                          order.dbOrder?.primaryAction?.label ||
                          (order.escrowTxHash ? "MINE" : "ACCEPT")
                        )}
                      </button>
                    )}
                  </div>
                  {/* Countdown timer bar (bottom) */}
                  {(() => {
                    const total = Math.max(1, mOrder.seconds_until_expiry || 1);
                    const pct = Math.max(
                      0,
                      Math.min(100, (liveExpiry / total) * 100),
                    );
                    return (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground/[0.04] rounded-b-lg overflow-hidden">
                        <div
                          className={`h-full transition-[width] duration-1000 ease-linear ${liveExpiry <= 120 ? "bg-red-400" : "bg-primary"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          }

          const premium = ((order.rate - 3.67) / 3.67) * 100;
          const isHighPremium = premium > 0.5;
          // Mine = escrow already locked (just send fiat)
          // Accept = no escrow yet (you'll lock escrow next)
          const isMineable = !!order.escrowTxHash;
          const dbUsername = order.dbOrder?.user?.username || "";
          const isPlaceholderUser =
            dbUsername.startsWith("open_order_") ||
            dbUsername.startsWith("m2m_");
          // For M2M: the placer is buyer_merchant_id — only they should see "YOURS" / hidden button
          // The counterparty (merchant_id / seller) should see the ACCEPT button
          const isM2MOrder = !!order.buyerMerchantId && isPlaceholderUser;
          const isMyOwnOrder = isM2MOrder
            ? order.buyerMerchantId === merchantInfo?.id
            : !!order.isMyOrder ||
              (isPlaceholderUser && order.orderMerchantId === merchantInfo?.id);

          return (
            <div
              key={order.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-1"
            >
              <div
                data-testid={`order-card-${order.id}`}
                onClick={() => onSelectOrder(order)}
                className={`relative p-2.5 rounded-lg border transition-colors cursor-pointer ${
                  isMyOwnOrder
                    ? "bg-white/[0.01] border-foreground/[0.04] opacity-50"
                    : isMineable
                      ? "glass-card border-white/[0.10] hover:border-primary/30 ring-1 ring-white/[0.04]"
                      : isHighPremium
                        ? "glass-card border-foreground/[0.08] hover:border-border-strong"
                        : "glass-card hover:border-foreground/[0.08]"
                }`}
              >
                {/* Live pulse dot */}
                <span className="absolute -top-1 -left-1 flex h-2.5 w-2.5 z-20">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
                {/* Processing banner */}
                {acceptingOrderId === order.id && (
                  <div className="flex items-center gap-1.5 px-2 py-1 mb-1.5 rounded bg-primary/10 border border-primary/20">
                    <Loader2 className="w-3 h-3 text-primary animate-spin" />
                    <span className="text-[9px] text-primary font-mono font-bold tracking-wider uppercase">
                      Accepting...
                    </span>
                  </div>
                )}
                {/* Waiting banner — top of card for own orders */}
                {isMyOwnOrder && acceptingOrderId !== order.id && (
                  <div className="flex items-center gap-1.5 px-2 py-1 mb-1.5 rounded bg-foreground/[0.02] border border-foreground/[0.04]">
                    <div className="w-1 h-1 bg-white/20 rounded-full animate-breathe" />
                    <span className="text-[9px] text-foreground/30 font-mono font-bold tracking-wider uppercase">
                      Waiting for acceptance
                    </span>
                  </div>
                )}
                {/* Row 1: User + tags on left, timer on right */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="w-7 h-7 rounded-lg bg-foreground/[0.02] flex items-center justify-center shrink-0 text-sm border border-foreground/[0.04]">
                      {order.emoji}
                    </div>
                    <span className="text-xs font-medium text-white truncate">
                      {order.user}
                    </span>
                    <span
                      className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${
                        order.orderType === "buy"
                          ? "bg-[var(--color-error)]/10 border-[var(--color-error)]/20 text-[var(--color-error)]"
                          : "bg-[var(--color-success)]/10 border-[var(--color-success)]/20 text-[var(--color-success)]"
                      }`}
                    >
                      {order.orderType === "buy" ? "You Pay" : "You Get"}
                    </span>
                    {order.spreadPreference && (
                      <span
                        className={`flex items-center gap-0.5 text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${
                          order.spreadPreference === "fastest"
                            ? "bg-primary/10 border-primary/20 text-primary"
                            : order.spreadPreference === "cheap"
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                              : "bg-blue-500/10 border-blue-500/20 text-blue-400"
                        }`}
                      >
                        {order.spreadPreference === "fastest" && (
                          <Zap className="w-2.5 h-2.5" />
                        )}
                        {order.spreadPreference === "fastest"
                          ? "FAST"
                          : order.spreadPreference === "best"
                            ? "BEST"
                            : "CHEAP"}
                        {order.protocolFeePercent != null &&
                          order.protocolFeePercent >
                            (order.spreadPreference === "fastest"
                              ? 2.5
                              : order.spreadPreference === "best"
                                ? 2.0
                                : 1.5) && (
                            <span className="opacity-70">
                              +
                              {(
                                order.protocolFeePercent -
                                (order.spreadPreference === "fastest"
                                  ? 2.5
                                  : order.spreadPreference === "best"
                                    ? 2.0
                                    : 1.5)
                              ).toFixed(1)}
                              %
                            </span>
                          )}
                      </span>
                    )}
                    {isMyOwnOrder && (
                      <span className="px-1 py-0.5 bg-foreground/[0.04] border border-foreground/[0.06] rounded text-[9px] font-bold text-foreground/40">
                        YOURS
                      </span>
                    )}
                    {order.hasMessages && order.unreadCount > 0 && (
                      <span className="px-1 py-0.5 bg-primary text-background text-[9px] font-bold rounded">
                        {order.unreadCount}
                      </span>
                    )}
                  </div>
                  {/* Timer */}
                  <div
                    className={`flex items-center gap-1 text-sm font-bold font-mono tabular-nums shrink-0 ml-auto ${
                      order.expiresIn <= 120 ? "text-red-400" : "text-primary"
                    }`}
                  >
                    {order.expiresIn <= 0
                      ? "Expired"
                      : order.expiresIn >= 3600
                        ? `${Math.floor(order.expiresIn / 3600)}h ${Math.floor((order.expiresIn % 3600) / 60)}m`
                        : order.expiresIn >= 60
                          ? `${Math.floor(order.expiresIn / 60)}m ${order.expiresIn % 60}s`
                          : `${order.expiresIn}s`}
                    <CountdownRing
                      remaining={order.expiresIn}
                      total={900}
                      size={18}
                      strokeWidth={2.5}
                    />
                  </div>
                </div>

                {/* Payment method badge with icon */}
                {(() => {
                  const pmType =
                    order.lockedPaymentMethod?.type ||
                    order.dbOrder?.payment_method ||
                    (order.userBankDetails ? "bank" : null);
                  if (!pmType) return null;
                  const config: Record<
                    string,
                    { label: string; icon: string }
                  > = {
                    bank: { label: "Bank", icon: "🏦" },
                    cash: { label: "Cash", icon: "💵" },
                    upi: { label: "UPI", icon: "📱" },
                  };
                  const { label, icon } = config[pmType] || {
                    label: pmType.toUpperCase(),
                    icon: "💳",
                  };
                  return (
                    <div className="flex justify-end mb-1.5">
                      <span className="flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded border border-border text-secondary">
                        <span className="text-[10px]">{icon}</span>
                        {label}
                      </span>
                    </div>
                  );
                })()}

                {/* Row 2: You Pay / You Get */}
                <div className="flex items-center gap-2 mb-1">
                  {order.orderType === "buy" ? (
                    <>
                      <span className="text-sm tabular-nums">
                        <span className="text-[10px] text-[var(--color-error)] font-mono mr-1">
                          Pay
                        </span>
                        <span className="font-bold text-foreground">
                          {Math.round(order.amount).toLocaleString()}{" "}
                          {order.fromCurrency}
                        </span>
                      </span>
                      <ArrowRight className="w-3 h-3 text-foreground/20" />
                      <span className="text-sm tabular-nums">
                        <span className="text-[10px] text-[var(--color-success)] font-mono mr-1">
                          Get
                        </span>
                        <span className="font-bold text-[var(--color-success)]">
                          {Math.round(order.total).toLocaleString()}{" "}
                          {order.toCurrency}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm tabular-nums">
                        <span className="text-[10px] text-[var(--color-success)] font-mono mr-1">
                          Get
                        </span>
                        <span className="font-bold text-[var(--color-success)]">
                          {Math.round(order.amount).toLocaleString()}{" "}
                          {order.fromCurrency}
                        </span>
                      </span>
                      <ArrowRight className="w-3 h-3 text-foreground/20" />
                      <span className="text-sm tabular-nums">
                        <span className="text-[10px] text-[var(--color-error)] font-mono mr-1">
                          Pay
                        </span>
                        <span className="font-bold text-foreground">
                          {Math.round(order.total).toLocaleString()}{" "}
                          {order.toCurrency}
                        </span>
                      </span>
                    </>
                  )}
                  {order.protocolFeePercent != null &&
                    order.protocolFeePercent > 0 && (
                      <span className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                        +$
                        {(
                          (order.amount * order.protocolFeePercent) /
                          100
                        ).toFixed(2)}
                      </span>
                    )}
                </div>

                {/* Row 3: Rate + premium ... small action button on right */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-foreground/40 font-mono">
                    @ {order.rate.toFixed(2)}
                  </span>
                  {order.protocolFeePercent != null &&
                    order.protocolFeePercent >
                      (order.spreadPreference === "fastest"
                        ? 2.5
                        : order.spreadPreference === "best"
                          ? 2.0
                          : 1.5) && (
                      <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        +
                        {(
                          order.protocolFeePercent -
                          (order.spreadPreference === "fastest"
                            ? 2.5
                            : order.spreadPreference === "best"
                              ? 2.0
                              : 1.5)
                        ).toFixed(1)}
                        %
                      </span>
                    )}
                  <div className="flex-1" />
                  {!isMyOwnOrder && (
                    <button
                      data-testid="order-primary-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAcceptOrder(order);
                      }}
                      disabled={acceptingOrderId === order.id}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all press-effect shrink-0 flex items-center gap-1 ${
                        acceptingOrderId === order.id
                          ? "bg-primary/50 text-black/60 cursor-wait"
                          : isMineable
                            ? "bg-primary text-background hover:bg-primary"
                            : "bg-primary/80 text-background hover:bg-primary"
                      }`}
                    >
                      {acceptingOrderId === order.id ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />{" "}
                          Accepting...
                        </>
                      ) : (
                        order.dbOrder?.primaryAction?.label ||
                        (isMineable ? "MINE" : "ACCEPT")
                      )}
                    </button>
                  )}
                </div>
                {/* Countdown timer bar (bottom) */}
                {(() => {
                  const total = 900;
                  const pct = Math.max(
                    0,
                    Math.min(100, (order.expiresIn / total) * 100),
                  );
                  return (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground/[0.04]">
                      <div
                        className={`h-full transition-[width] duration-1000 ease-linear ${order.expiresIn <= 120 ? "bg-red-400" : "bg-primary"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const PendingOrdersPanel = memo(function PendingOrdersPanel({
  orders,
  mempoolOrders,
  merchantInfo,
  onSelectOrder,
  onSelectMempoolOrder,
  onAcceptOrder,
  acceptingOrderId,
  fetchOrders,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
}: PendingOrdersPanelProps) {
  // ─── Filter/sort state from Zustand (no prop drilling) ───────────
  const searchQuery = useMerchantStore((s) => s.searchQuery);
  const setSearchQuery = useMerchantStore((s) => s.setSearchQuery);
  const orderViewFilter = useMerchantStore((s) => s.orderViewFilter);
  const setOrderViewFilter = useMerchantStore((s) => s.setOrderViewFilter);
  const pendingFilter = useMerchantStore((s) => s.pendingFilter);
  const setPendingFilter = useMerchantStore((s) => s.setPendingFilter);
  const pendingSortBy = useMerchantStore((s) => s.pendingSortBy);
  const setPendingSortBy = useMerchantStore((s) => s.setPendingSortBy);
  const soundEnabled = useMerchantStore((s) => s.soundEnabled);
  const setSoundEnabled = useMerchantStore((s) => s.setSoundEnabled);
  const { playSound } = useSounds();
  const showOrderFilters = useMerchantStore((s) => s.showOrderFilters);
  const setShowOrderFilters = useMerchantStore((s) => s.setShowOrderFilters);
  const orderFilters = useMerchantStore((s) => s.orderFilters);
  const setOrderFilters = useMerchantStore((s) => s.setOrderFilters);

  // Dropdown states
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // ─── Tab switch: All / Pending / My Orders ─────────────────────────
  const merchantId = merchantInfo?.id as string | undefined;
  type ViewTab = "all" | "pending" | "mine";
  const [view, setView] = useState<ViewTab>("pending");
  type MyOrdersFilter =
    | "all"
    | "active"
    | "completed"
    | "cancelled"
    | "expired";
  const [myFilter, setMyFilter] = useState<MyOrdersFilter>("all");
  const [myOrders, setMyOrders] = useState<any[]>([]);
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);

  // Derive whether a row was created by the logged-in merchant.
  // Uses the canonical placeholder-user marker (`open_order_*` / `m2m_*`) plus
  // a merchant_id / buyer_merchant_id match. This is the same convention used
  // throughout the codebase (mappers.ts:46) — no business-logic change.
  const isCreatedByMe = (order: any): boolean => {
    if (!merchantId) return false;
    const dbOrder = order?.dbOrder || order;
    const username: string = dbOrder?.user?.username || "";
    const isPlaceholder =
      username.startsWith("open_order_") || username.startsWith("m2m_");
    if (!isPlaceholder) return false;
    return (
      dbOrder?.merchant_id === merchantId ||
      dbOrder?.buyer_merchant_id === merchantId
    );
  };

  // Fetch the merchant's full order history (includes completed / cancelled /
  // expired) when the My Orders tab is opened. Pending list alone is not enough
  // because cancelled/expired drop out of the active feed.
  const myOrdersCursorRef = useRef<string | null>(null);
  const [hasMoreMyOrders, setHasMoreMyOrders] = useState(false);

  useEffect(() => {
    if (!merchantId) return;
    let cancelled = false;
    const load = async () => {
      setMyOrdersLoading(true);
      try {
        const res = await fetchWithAuth(
          `/api/merchant/orders?merchant_id=${merchantId}&status=pending,escrowed,accepted,payment_sent,payment_pending,payment_confirmed,completed,cancelled,expired,disputed&limit=10`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.success && Array.isArray(data.data)) {
          setMyOrders(data.data);
          if (data.pagination) {
            myOrdersCursorRef.current = data.pagination.next_cursor;
            setHasMoreMyOrders(data.pagination.has_more);
          }
        }
      } catch {
        // Best-effort
      } finally {
        if (!cancelled) setMyOrdersLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [view, merchantId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(e.target as Node)
      ) {
        setSortDropdownOpen(false);
      }
      setFilterDropdownOpen(false);
    };
    if (sortDropdownOpen || filterDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [sortDropdownOpen, filterDropdownOpen]);

  // Wrap my orders from the dedicated fetch into the same shape as UI orders
  const wrappedMyOrders = myOrders.map((dbRow: any) => {
    const userName =
      dbRow.user?.name ||
      dbRow.user?.username ||
      dbRow.merchant?.display_name ||
      "Trader";
    return {
      id: dbRow.id,
      dbOrder: dbRow,
      amount:
        typeof dbRow.crypto_amount === "string"
          ? parseFloat(dbRow.crypto_amount)
          : dbRow.crypto_amount,
      total:
        typeof dbRow.fiat_amount === "string"
          ? parseFloat(dbRow.fiat_amount)
          : dbRow.fiat_amount,
      rate:
        typeof dbRow.rate === "string" ? parseFloat(dbRow.rate) : dbRow.rate,
      status: dbRow.status,
      orderType: dbRow.type,
      timestamp: new Date(dbRow.created_at),
      expiresIn: 0,
      fromCurrency: dbRow.crypto_currency || "USDT",
      toCurrency: dbRow.fiat_currency || "AED",
      user: userName,
      emoji: userName.charAt(0)?.toUpperCase() || "🔸",
      order_number: dbRow.order_number,
      protocolFeePercent: parseFloat(
        String(dbRow.protocol_fee_percentage ?? 0),
      ),
    };
  });

  let displayOrders: any[];

  if (view === "mine") {
    // ─── MY ORDERS: merchant's own orders (last 7 days) ────────────
    displayOrders = wrappedMyOrders.filter((o: any) => isCreatedByMe(o));

    if (myFilter !== "all") {
      const activeStatuses = new Set([
        "pending",
        "escrowed",
        "accepted",
        "payment_pending",
        "payment_sent",
        "payment_confirmed",
        "disputed",
      ]);
      displayOrders = displayOrders.filter((o: any) => {
        const s = o.status as string;
        if (myFilter === "active") return activeStatuses.has(s);
        if (myFilter === "completed") return s === "completed";
        if (myFilter === "cancelled") return s === "cancelled";
        if (myFilter === "expired") return s === "expired";
        return true;
      });
    }
  } else if (view === "pending") {
    // ─── PENDING: orders waiting to be accepted (NOT escrowed/active) ──
    // Escrowed orders belong in "In Progress", not here. Including them
    // caused a bug where the order showed "Expired" (stale local countdown
    // from the original 15-min pending window) even though the order was
    // actively escrowed with an extended 120-min deadline.
    const pendingStatuses = new Set(["pending"]);
    const marketOrders = [...orders].filter((o: any) =>
      pendingStatuses.has(o.status || o.dbOrder?.status),
    );
    const myPending = wrappedMyOrders.filter(
      (o: any) => isCreatedByMe(o) && pendingStatuses.has(o.status),
    );

    // Merge and deduplicate
    const seenIds = new Set(marketOrders.map((o: any) => o.id));
    const uniqueMyPending = myPending.filter((o: any) => !seenIds.has(o.id));
    displayOrders = [...marketOrders, ...uniqueMyPending];

    // Add mempool orders
    if (mempoolOrders.length > 0) {
      const allIds = new Set(displayOrders.map((o: any) => o.id));
      const uniqueMempool = mempoolOrders.filter((mo) => !allIds.has(mo.id));
      const mempoolAsOrders = uniqueMempool.map((mo) => ({
        ...mo,
        isMempoolOrder: true,
        isMyMempoolOrder: mo.creator_username === merchantInfo?.username,
      }));
      displayOrders = [...mempoolAsOrders, ...displayOrders];
    }
  } else {
    // ─── ALL: everything (market orders + my orders combined) ──────
    const marketOrders = [...orders];

    // Add mempool orders
    let allOrders = [...marketOrders];
    if (mempoolOrders.length > 0) {
      const regularIds = new Set(allOrders.map((o: any) => o.id));
      const uniqueMempool = mempoolOrders.filter(
        (mo) => !regularIds.has(mo.id),
      );
      const mempoolAsOrders = uniqueMempool.map((mo) => ({
        ...mo,
        isMempoolOrder: true,
        isMyMempoolOrder: mo.creator_username === merchantInfo?.username,
      }));
      allOrders = [...mempoolAsOrders, ...allOrders];
    }

    // Merge my orders (for completed/cancelled that aren't in the active feed)
    const allIds = new Set(allOrders.map((o: any) => o.id));
    const uniqueMyOrders = wrappedMyOrders.filter(
      (o: any) => !allIds.has(o.id) && isCreatedByMe(o),
    );
    displayOrders = [...allOrders, ...uniqueMyOrders];
  }

  if (pendingFilter !== "all") {
    displayOrders = displayOrders.filter((order) => {
      if ((order as any).isMempoolOrder) return true;
      if (pendingFilter === "mineable") return !!order.escrowTxHash;
      else if (pendingFilter === "premium") {
        const premium = ((order.rate - 3.67) / 3.67) * 100;
        return premium > 0.5;
      } else if (pendingFilter === "large") return order.amount >= 2000;
      else if (pendingFilter === "expiring") return order.expiresIn < 300;
      return true;
    });
  }

  if (pendingSortBy !== "time") {
    displayOrders = [...displayOrders].sort((a, b) => {
      if ((a as any).isMempoolOrder || (b as any).isMempoolOrder) return 0;
      if (pendingSortBy === "premium") return b.rate - a.rate;
      else if (pendingSortBy === "amount") return b.amount - a.amount;
      else if (pendingSortBy === "rating")
        return (b.dbOrder?.user?.rating || 0) - (a.dbOrder?.user?.rating || 0);
      return 0;
    });
  } else {
    // Default sort: newest first (by created_at descending)
    displayOrders = [...displayOrders].sort((a, b) => {
      if ((a as any).isMempoolOrder || (b as any).isMempoolOrder) return 0;
      const aTime = new Date(a.dbOrder?.created_at || a.createdAt || 0).getTime();
      const bTime = new Date(b.dbOrder?.created_at || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  }

  const filteredOrders = displayOrders.filter((order) => {
    if ((order as any).isMempoolOrder) {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesOrderNum = (order as any).order_number
          ?.toLowerCase()
          .includes(q);
        const matchesAmount = (order as any).amount_usdt
          ?.toString()
          .includes(q);
        if (!matchesOrderNum && !matchesAmount) return false;
      }
      return true;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesUser = order.user?.toLowerCase().includes(q);
      const matchesAmount = order.amount.toString().includes(q);
      const matchesTotal = Math.round(order.total).toString().includes(q);
      const matchesId = order.id?.toLowerCase().includes(q);
      const matchesOrderNum = order.dbOrder?.order_number
        ?.toLowerCase()
        .includes(q);
      if (
        !matchesUser &&
        !matchesAmount &&
        !matchesTotal &&
        !matchesId &&
        !matchesOrderNum
      )
        return false;
    }
    if (orderFilters.type !== "all" && order.orderType !== orderFilters.type)
      return false;
    if (orderFilters.amount === "small" && order.amount >= 500) return false;
    if (
      orderFilters.amount === "medium" &&
      (order.amount < 500 || order.amount > 2000)
    )
      return false;
    if (orderFilters.amount === "large" && order.amount <= 2000) return false;
    if (
      orderFilters.method !== "all" &&
      order.dbOrder?.payment_method !== orderFilters.method
    )
      return false;
    if (orderFilters.secured === "yes" && !order.escrowTxHash) return false;
    if (orderFilters.secured === "no" && order.escrowTxHash) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-section-divider">
        {/* ─── Row 1: Tabs + controls ─── */}
        <div className="flex items-center justify-between mb-2">
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-foreground/[0.04] border border-foreground/[0.06]">
            {(["all", "pending", "mine"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setView(tab)}
                className={`px-3 py-1 rounded-md text-[10px] font-bold transition-all ${
                  view === tab
                    ? "bg-foreground text-background shadow"
                    : "text-foreground/40 hover:text-foreground/60"
                }`}
              >
                {tab === "all"
                  ? "All"
                  : tab === "pending"
                    ? "Pending"
                    : "My Orders"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-foreground/[0.02] rounded border border-foreground/[0.06]">
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-live-dot" />
              <span className="text-[9px] text-white/35 font-mono">Live</span>
            </div>
            <button
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                // Play confirmation ping when enabling. This click also acts as
                // the required user gesture to unlock the browser's AudioContext.
                if (next) {
                  setTimeout(() => playSound?.('notification'), 0);
                }
              }}
              className={`p-1 rounded border transition-all ${
                soundEnabled
                  ? "bg-primary/15 border-primary/30 text-primary ring-1 ring-primary/20"
                  : "bg-foreground/[0.02] border-foreground/[0.06] text-foreground/30 hover:bg-foreground/[0.05]"
              }`}
              title={soundEnabled ? "Sound on — click to mute" : "Sound off — click to enable"}
            >
              {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            </button>
            <button
              onClick={fetchOrders}
              className="p-1 hover:bg-foreground/[0.04] rounded transition-colors"
            >
              <RotateCcw className="w-3 h-3 text-foreground/25 hover:text-foreground/50" />
            </button>
            <button
              onClick={() => setShowOrderFilters(!showOrderFilters)}
              className={`p-1 rounded transition-all ${showOrderFilters || Object.values(orderFilters).some((v) => v !== "all") ? "bg-white/[0.08] text-foreground/60" : "hover:bg-foreground/[0.04] text-foreground/25"}`}
            >
              <SlidersHorizontal className="w-3 h-3" />
            </button>
            <span className="text-[10px] border border-foreground/[0.08] text-foreground/50 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
              {filteredOrders.length}
            </span>
          </div>
        </div>

        {/* ─── My Orders sub-filter (only when My Orders tab active) ─── */}
        {view === "mine" && (
          <div className="flex items-center gap-1 mb-2">
            {(
              ["all", "active", "completed", "cancelled", "expired"] as const
            ).map((f) => (
              <button
                key={f}
                onClick={() => setMyFilter(f)}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all capitalize ${
                  myFilter === f
                    ? "bg-white/[0.08] text-white border border-white/[0.12]"
                    : "text-foreground/30 hover:text-foreground/50"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {/* Search + Filter + Sort */}
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-1.5 bg-foreground/[0.02] border border-foreground/[0.06] rounded-lg px-2.5 py-1.5">
            <Search className="w-3 h-3 text-foreground/20" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search orders..."
              className="flex-1 bg-transparent text-[11px] text-white placeholder:text-foreground/15 outline-none font-mono"
            />
          </div>

          {/* Filter dropdown */}
          <div className="relative">
            <button
              onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
              className={`flex items-center gap-1 text-[9px] font-mono bg-foreground/[0.02] border rounded-lg px-1.5 py-1.5 cursor-pointer transition-colors ${
                pendingFilter !== "all"
                  ? "text-primary border-primary/30 bg-primary/5"
                  : "text-white/35 border-foreground/[0.06] hover:border-border-strong"
              }`}
            >
              {
                {
                  all: "Filter",
                  mineable: "Mineable",
                  premium: "Premium",
                  large: "Large",
                  expiring: "Expiring",
                }[pendingFilter]
              }
              <ChevronDown
                className={`w-2.5 h-2.5 transition-transform ${filterDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>
            <AnimatePresence>
              {filterDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 z-30 bg-card-solid border border-foreground/[0.08] rounded-lg shadow-xl py-1 min-w-[120px]"
                >
                  {(
                    ["all", "mineable", "premium", "large", "expiring"] as const
                  ).map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setPendingFilter(f);
                        setFilterDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-[10px] font-medium transition-colors ${
                        pendingFilter === f
                          ? "text-primary bg-primary/5"
                          : "text-foreground/60 hover:bg-foreground/[0.04]"
                      }`}
                    >
                      {f === "all"
                        ? "All"
                        : f === "mineable"
                          ? "Mineable"
                          : f === "premium"
                            ? "High Premium"
                            : f === "large"
                              ? "Large"
                              : "Expiring"}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sort dropdown */}
          <div className="relative" ref={sortDropdownRef}>
            <button
              onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
              className="flex items-center gap-1 text-[9px] font-mono text-white/35 bg-foreground/[0.02] border border-foreground/[0.06] rounded-lg px-1.5 py-1.5 cursor-pointer hover:border-border-strong transition-colors"
            >
              {
                {
                  time: "Time",
                  premium: "Premium",
                  amount: "Size",
                  rating: "Rating",
                }[pendingSortBy]
              }
              <ChevronDown
                className={`w-2.5 h-2.5 transition-transform ${sortDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>
            <AnimatePresence>
              {sortDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 z-50 min-w-[100px] bg-[#1a1a1a] border border-foreground/[0.08] rounded-lg shadow-xl overflow-hidden"
                >
                  {(
                    [
                      { value: "time", label: "Time" },
                      { value: "premium", label: "Premium" },
                      { value: "amount", label: "Size" },
                      { value: "rating", label: "Rating" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setPendingSortBy(option.value);
                        setSortDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] font-mono transition-colors ${
                        pendingSortBy === option.value
                          ? "text-foreground/70 bg-foreground/[0.06]"
                          : "text-white/35 hover:text-foreground/50 hover:bg-foreground/[0.04]"
                      }`}
                    >
                      {option.label}
                      {pendingSortBy === option.value && (
                        <Check className="w-2.5 h-2.5 text-foreground/50" />
                      )}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Advanced Filters */}
        <AnimatePresence>
          {showOrderFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mt-1.5"
            >
              <div className="flex flex-wrap items-center gap-1 p-1.5 bg-white/[0.015] rounded-lg border border-foreground/[0.04]">
                {/* Type */}
                <div className="flex items-center gap-0.5 bg-foreground/[0.02] rounded p-0.5">
                  {(["all", "buy", "sell"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() =>
                        setOrderFilters((f: any) => ({ ...f, type: t }))
                      }
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                        orderFilters.type === t
                          ? "bg-white/[0.08] text-foreground/80"
                          : "text-foreground/25 hover:text-foreground/40"
                      }`}
                    >
                      {t === "all" ? "Type" : t.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Amount */}
                <div className="flex items-center gap-0.5 bg-foreground/[0.02] rounded p-0.5">
                  {[
                    { key: "all", label: "Amt" },
                    { key: "small", label: "<500" },
                    { key: "medium", label: "500-2k" },
                    { key: "large", label: "2k+" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() =>
                        setOrderFilters((f: any) => ({ ...f, amount: key }))
                      }
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                        orderFilters.amount === key
                          ? "bg-white/[0.08] text-foreground/80"
                          : "text-foreground/25 hover:text-foreground/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Method */}
                <div className="flex items-center gap-0.5 bg-foreground/[0.02] rounded p-0.5">
                  {[
                    { key: "all", label: "Method" },
                    { key: "bank", label: "Bank" },
                    { key: "cash", label: "Cash" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() =>
                        setOrderFilters((f: any) => ({ ...f, method: key }))
                      }
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                        orderFilters.method === key
                          ? "bg-white/[0.08] text-foreground/80"
                          : "text-foreground/25 hover:text-foreground/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Escrow */}
                <div className="flex items-center gap-0.5 bg-foreground/[0.02] rounded p-0.5">
                  {[
                    { key: "all", label: "Escrow" },
                    { key: "yes", label: "Secured" },
                    { key: "no", label: "Open" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() =>
                        setOrderFilters((f: any) => ({ ...f, secured: key }))
                      }
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                        orderFilters.secured === key
                          ? "bg-white/[0.08] text-foreground/80"
                          : "text-foreground/25 hover:text-foreground/40"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {Object.values(orderFilters).some((v) => v !== "all") && (
                  <button
                    onClick={() =>
                      setOrderFilters({
                        type: "all",
                        amount: "all",
                        method: "all",
                        secured: "all",
                      })
                    }
                    className="px-1.5 py-0.5 text-[9px] font-medium text-foreground/40 hover:text-foreground/60 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Orders List */}
      {view === "mine" ? (
        <MyOrdersList
          orders={filteredOrders}
          isLoading={myOrdersLoading}
          onSelectOrder={onSelectOrder}
        />
      ) : (
        <OrderList
          filteredOrders={filteredOrders}
          merchantInfo={merchantInfo}
          onSelectOrder={onSelectOrder}
          onSelectMempoolOrder={onSelectMempoolOrder}
          onAcceptOrder={onAcceptOrder}
          acceptingOrderId={acceptingOrderId}
        />
      )}

      {/* Load More button */}
      {hasMore && onLoadMore && (
        <div className="px-3 py-2 border-t border-section-divider">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="w-full py-2 rounded-lg text-[11px] font-bold text-foreground/40 hover:text-foreground/60 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.06] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {isLoadingMore ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              'Load More'
            )}
          </button>
        </div>
      )}
    </div>
  );
});

// ─── My Orders list — non-virtualized, status-aware card render ────────
const MY_STATUS_BADGE: Record<
  string,
  { label: string; cls: string; Icon: any }
> = {
  pending: {
    label: "Pending",
    cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    Icon: CircleDot,
  },
  escrowed: {
    label: "Escrowed",
    cls: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    Icon: CircleDot,
  },
  accepted: {
    label: "Accepted",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Icon: CheckCircle2,
  },
  payment_pending: {
    label: "Payment Pending",
    cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    Icon: CircleDot,
  },
  payment_sent: {
    label: "Payment Sent",
    cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    Icon: CircleDot,
  },
  payment_confirmed: {
    label: "Confirmed",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Icon: CheckCircle2,
  },
  completed: {
    label: "Completed",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-red-500/10 text-red-400 border-red-500/20",
    Icon: XCircle,
  },
  expired: {
    label: "Expired",
    cls: "bg-foreground/[0.06] text-foreground/40 border-foreground/[0.10]",
    Icon: AlertCircle,
  },
  disputed: {
    label: "Disputed",
    cls: "bg-red-500/10 text-red-400 border-red-500/20",
    Icon: AlertCircle,
  },
};

const MyOrdersList = memo(function MyOrdersList({
  orders,
  isLoading,
  onSelectOrder,
}: {
  orders: any[];
  isLoading: boolean;
  onSelectOrder: (order: any) => void;
}) {
  if (isLoading && orders.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-foreground/30 animate-spin" />
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-1.5">
        <div className="flex flex-col items-center justify-center h-full gap-3 py-10">
          <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-foreground/20" />
          </div>
          <p className="text-[11px] font-medium text-foreground/30">
            No orders
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
      {orders.map((order: any) => {
        const db = order.dbOrder || order;
        const status: string = db.status || "pending";
        const badge = MY_STATUS_BADGE[status] || MY_STATUS_BADGE.pending;
        const StatusIcon = badge.Icon;
        const amount = order.amount ?? 0;
        const total = order.total ?? 0;
        const rate = order.rate ?? 0;
        const fiatCurrency = db.fiat_currency || "AED";
        const createdAt = order.timestamp ?? new Date(db.created_at);
        const isCancelled = status === "cancelled";
        const isAccepted = !!db.accepted_at;

        // Counterparty name when accepted/claimed
        const acceptedByName: string | null = (() => {
          if (!isAccepted) return null;
          // M2M: counterparty is whichever side is NOT the creator. For
          // a merchant-created order with placeholder user, the acceptor
          // is whichever side filled in (buyer_merchant_id usually).
          if (db.buyer_merchant?.display_name)
            return db.buyer_merchant.display_name;
          if (db.merchant?.display_name) return db.merchant.display_name;
          return db.user?.name || db.user?.username || null;
        })();

        const cancelReason: string | null = isCancelled
          ? db.cancellation_reason || db.cancel_request_reason || null
          : null;

        return (
          <button
            key={order.id}
            onClick={() => onSelectOrder(order)}
            className="w-full text-left p-2.5 rounded-lg glass-card border border-foreground/[0.06] hover:border-foreground/[0.12] transition-colors"
          >
            {/* Header row: status badge + timestamp */}
            <div className="flex items-center justify-between mb-1.5">
              <span
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono uppercase tracking-wider border ${badge.cls}`}
              >
                <StatusIcon className="w-2.5 h-2.5" />
                {badge.label}
              </span>
              <span className="text-[9px] text-foreground/30 font-mono">
                {createdAt instanceof Date
                  ? createdAt.toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""}
              </span>
            </div>

            {/* Amount: You Pay / You Get */}
            <div className="flex items-center gap-2 mb-1">
              {order.orderType === "buy" ? (
                <>
                  <span className="text-sm tabular-nums">
                    <span className="text-[10px] text-[var(--color-error)] font-mono mr-1">
                      Pay
                    </span>
                    <span className="font-bold text-foreground">
                      {Math.round(amount).toLocaleString()} USDT
                    </span>
                  </span>
                  <ArrowRight className="w-3 h-3 text-foreground/20" />
                  <span className="text-sm tabular-nums">
                    <span className="text-[10px] text-[var(--color-success)] font-mono mr-1">
                      Get
                    </span>
                    <span className="font-bold text-[var(--color-success)]">
                      {Math.round(total).toLocaleString()} {fiatCurrency}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm tabular-nums">
                    <span className="text-[10px] text-[var(--color-success)] font-mono mr-1">
                      Get
                    </span>
                    <span className="font-bold text-[var(--color-success)]">
                      {Math.round(amount).toLocaleString()} USDT
                    </span>
                  </span>
                  <ArrowRight className="w-3 h-3 text-foreground/20" />
                  <span className="text-sm tabular-nums">
                    <span className="text-[10px] text-[var(--color-error)] font-mono mr-1">
                      Pay
                    </span>
                    <span className="font-bold text-foreground">
                      {Math.round(total).toLocaleString()} {fiatCurrency}
                    </span>
                  </span>
                </>
              )}
            </div>

            {/* Rate + type */}
            <div className="flex items-center gap-2 text-[10px] text-foreground/40 font-mono">
              <span>@ {rate?.toFixed?.(2) ?? rate}</span>
              <span className="text-foreground/15">·</span>
              <span className="uppercase">{db.type}</span>
            </div>

            {/* Accepted by */}
            {acceptedByName && !isCancelled && status !== "expired" && (
              <div className="mt-1 text-[10px] text-foreground/50 font-mono">
                Accepted by{" "}
                <span className="text-foreground/80 font-bold">
                  {acceptedByName}
                </span>
              </div>
            )}

            {/* Cancel reason */}
            {cancelReason && (
              <div className="mt-1.5 px-2 py-1 rounded bg-red-500/[0.06] border border-red-500/15 text-[10px] text-red-300/80 font-mono">
                Reason: {cancelReason}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
});
