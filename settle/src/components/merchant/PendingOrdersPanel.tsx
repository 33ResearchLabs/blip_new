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
  ArrowRightLeft,
  Flame,
  ChevronDown,
  Check,
  XCircle,
  CheckCircle2,
  AlertCircle,
  CircleDot,
  Volume2,
  VolumeX,
  X,
  MoreHorizontal,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CountdownRing } from "./CountdownRing";
import { useMerchantStore } from "@/stores/merchantStore";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { useSounds } from "@/hooks/useSounds";
import {
  InfoTooltip,
  type InfoTooltipItem,
} from "@/components/shared/InfoTooltip";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { ProfileSheet } from "@/components/shared/profile/ProfileSheet";
import type { ProfileEntityType } from "@/components/shared/profile/types";
import { deriveCounterparty } from "@/components/shared/profile/counterparty";
import {
  useCorridorPrices,
  resolveCorridorRef,
} from "@/hooks/useCorridorPrices";

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
  // Collapse (mirrors Active Trades panel)
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

// Compute which side ('seller' | 'buyer') the viewing merchant is on for
// this order — either their current role, or the role they'd take if they
// claimed the broadcast. Used to flip YOU PAY / YOU RECEIVE labels.
//
// CLAUDE.md role table (authoritative):
//   U2M BUY    user_id=buyer,  merchant_id=seller, buyer_merchant_id=—
//   U2M SELL   user_id=seller, merchant_id=buyer,  buyer_merchant_id=—
//   M2M any    user_id=placeholder, merchant_id=seller, buyer_merchant_id=buyer
//
// The old implementation treated `merchant_id === myId` as ALWAYS seller,
// which inverted U2M SELL (merchant is buyer there) — producing swapped
// YOU PAY / YOU RECEIVE labels on those cards.
function getViewerSide(
  db: any,
  myId: string | null | undefined,
): "seller" | "buyer" {
  if (!db) return "seller";

  const userIsPlaceholder =
    typeof db.user?.username === "string" &&
    (db.user.username.startsWith("open_order_") ||
      db.user.username.startsWith("m2m_"));
  const isM2M = userIsPlaceholder || !!db.buyer_merchant_id;
  const orderType = String(db.type || "").toLowerCase();

  if (isM2M) {
    // M2M: role by slot. merchant_id is always seller, buyer_merchant_id
    // is always buyer, regardless of the `type` column.
    if (myId && db.merchant_id === myId) return "seller";
    if (myId && db.buyer_merchant_id === myId) return "buyer";
    // Observer on M2M — which role would they claim?
    //   • merchant_id set + bmerch null  → seller slot filled, observer would claim buyer
    //   • merchant_id null + bmerch set  → buyer slot filled,  observer would claim seller
    //   • both null (legacy broadcast pre-shape-fix) → fall back to user-perspective type:
    //     type='buy'  (placeholder=buyer → creator=seller) → observer would claim buyer
    //     type='sell' (placeholder=seller → creator=buyer) → observer would claim seller
    if (db.merchant_id && !db.buyer_merchant_id) return "buyer";
    if (!db.merchant_id && db.buyer_merchant_id) return "seller";
    return orderType === "buy" ? "buyer" : "seller";
  }

  // U2M: role by type. For the merchant slot, BUY → seller, SELL → buyer.
  if (myId && db.merchant_id === myId) {
    return orderType === "buy" ? "seller" : "buyer";
  }
  // Observer on U2M — they would take the merchant slot's role on accept.
  return orderType === "buy" ? "seller" : "buyer";
}

// Resolve seller/buyer display names from the raw DB order. Falls back to
// null on each side when the party hasn't claimed / is a placeholder.
function getPartyNames(db: any): {
  seller: string | null;
  buyer: string | null;
} {
  if (!db) return { seller: null, buyer: null };
  const userIsPlaceholder =
    typeof db.user?.username === "string" &&
    (db.user.username.startsWith("open_order_") ||
      db.user.username.startsWith("m2m_"));
  const userName = userIsPlaceholder
    ? null
    : db.user?.name || db.user?.username || null;
  const merchantName = db.merchant?.display_name || null;
  const buyerMerchantName = db.buyer_merchant?.display_name || null;

  // M2M detection follows the CLAUDE.md rule: placeholder user = M2M, even
  // before a counterparty merchant has claimed. Relying only on
  // `buyer_merchant_id !== null` misses M2M SELL broadcasts (which have
  // `merchant_id = placer` + `buyer_merchant_id = null`) and routes them
  // through the U2M branch, which mislabels the placer's role.
  const isM2M = userIsPlaceholder || !!db.buyer_merchant_id;
  if (isM2M) return { seller: merchantName, buyer: buyerMerchantName };

  const orderType = String(db.type || "").toLowerCase();
  if (orderType === "buy") return { seller: merchantName, buyer: userName };
  return { seller: userName, buyer: merchantName };
}

// Rewrite the generic backend cancel placeholder ("Cancelled by <role>") into
// viewer-perspective copy. A real/custom reason (anything that doesn't match the
// placeholder shape) is returned verbatim, so this is a pure display
// normalization with zero behavior change for meaningful reasons.
//
// The stored reason encodes the canceller's ROLE (merchant/user/system), not an
// entity id. That's enough to be correct here:
//   • user   → in the merchant app the user is always the counterparty customer.
//   • system → an automated/timeout cancel.
//   • merchant → attribute to "you" ONLY when the viewer is the sole merchant on
//     the order (no second merchant could have been the canceller). When another
//     merchant is present (M2M that was accepted), role alone can't disambiguate
//     the two merchants, so we keep the original string rather than risk a wrong
//     attribution — matching today's behaviour exactly for that case.
function humanizeCancelReason(
  rawReason: string | null,
  opts: {
    db: { merchant_id?: string | null; buyer_merchant_id?: string | null };
    myId: string | null | undefined;
    counterpartyName: string | null;
  },
): string | null {
  if (!rawReason) return null;
  const match = /^cancelled by (merchant|user|system)$/i.exec(rawReason.trim());
  if (!match) return rawReason;
  const role = match[1].toLowerCase();
  const { db, myId, counterpartyName } = opts;

  if (role === "system") return "Auto-cancelled";

  if (role === "user")
    return counterpartyName
      ? `Cancelled by ${counterpartyName}`
      : "Cancelled by the customer";

  // role === "merchant"
  const iAmAMerchantOnIt =
    !!myId && (db.merchant_id === myId || db.buyer_merchant_id === myId);
  const otherMerchantPresent =
    (!!db.merchant_id && db.merchant_id !== myId) ||
    (!!db.buyer_merchant_id && db.buyer_merchant_id !== myId);
  if (iAmAMerchantOnIt && !otherMerchantPresent) return "Cancelled by you";
  return rawReason;
}

// ─── Virtualized order list (renders only visible rows) ──────────
const ITEM_HEIGHT = 170; // Estimated row height in px (mempool cards are taller with earnings hero)

const OrderList = memo(function OrderList({
  filteredOrders,
  merchantInfo,
  onSelectOrder,
  onSelectMempoolOrder,
  onAcceptOrder,
  onCancelOrder,
  acceptingOrderId,
  fetchOrders,
}: {
  filteredOrders: any[];
  merchantInfo: any;
  onSelectOrder: (order: any) => void;
  onSelectMempoolOrder: (order: any) => void;
  onAcceptOrder: (order: any) => void;
  onCancelOrder?: (order: any) => void;
  acceptingOrderId?: string | null;
  fetchOrders?: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const corridorPrices = useCorridorPrices();

  // Live tick — updates every second for countdown + fee decay
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Counterparty profile sheet — opened by tapping a card's avatar/name.
  const [profileTarget, setProfileTarget] = useState<{
    entityType: ProfileEntityType;
    id: string;
  } | null>(null);

  // Has the first orders fetch settled? Drives loading-vs-empty so a freshly
  // loaded dashboard shows a spinner here (not a misleading "No pending orders")
  // until orders arrive.
  const ordersLoaded = useMerchantStore((s) => s.ordersLoaded);
  // Last orders-fetch failure (null when healthy). Only used to swap the empty
  // state for an Error + Retry state — never hides an already-populated list.
  const ordersError = useMerchantStore((s) => s.ordersError);
  const [retrying, setRetrying] = useState(false);
  const handleRetry = async () => {
    if (retrying || !fetchOrders) return;
    setRetrying(true);
    try {
      await fetchOrders();
    } finally {
      setRetrying(false);
    }
  };

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
          {ordersError ? (
            <>
              <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-foreground/30" />
              </div>
              <div className="text-center">
                <p className="text-[11px] font-medium text-foreground/40 mb-0.5">
                  Couldn&apos;t load orders
                </p>
                <p className="text-[9px] text-foreground/20 font-mono mb-2 max-w-[200px] mx-auto">
                  {ordersError}
                </p>
                {fetchOrders && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={retrying}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-semibold text-foreground/60 bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/[0.08] transition-all disabled:opacity-50"
                  >
                    {retrying ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3 h-3" />
                    )}
                    {retrying ? "Retrying…" : "Retry"}
                  </button>
                )}
              </div>
            </>
          ) : !ordersLoaded ? (
            <Loader2 className="w-5 h-5 text-foreground/20 animate-spin" />
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
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
                    className={`relative p-2.5 rounded-xl transition-colors cursor-pointer ${
                      isMyMempoolOrder ? "opacity-[0.85]" : ""
                    }`}
                    style={{
                      background: "#111113",
                      border: isMyMempoolOrder
                        ? "1px solid rgba(255,255,255,0.03)"
                        : "1px solid rgba(245,245,247,0.22)",
                      borderLeft: isMyMempoolOrder
                        ? undefined
                        : "2px solid rgba(245,245,247,0.45)",
                    }}
                    onMouseEnter={(e) =>
                      !isMyMempoolOrder &&
                      (e.currentTarget.style.borderColor =
                        "rgba(245,245,247,0.38)")
                    }
                    onMouseLeave={(e) =>
                      !isMyMempoolOrder &&
                      (e.currentTarget.style.borderColor =
                        "rgba(245,245,247,0.22)")
                    }
                  >
                    {/* Live pulse dot */}
                    <span className="absolute -top-1 -left-1 flex h-2.5 w-2.5 z-20">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[#f5f5f7] opacity-75 animate-ping" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#f5f5f7]" />
                    </span>
                    {/* Processing banner */}
                    {acceptingOrderId === mOrder.id && (
                      <div className="flex items-center gap-1.5 px-2 py-1 mb-1.5 rounded bg-white/[0.06] border border-white/[0.12]">
                        <Loader2 className="w-3 h-3 text-[#f5f5f7] animate-spin" />
                        <span className="text-[9px] text-[#f5f5f7] font-mono font-bold tracking-wider uppercase">
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
                        <div className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0 text-sm border border-white/[0.12]">
                          <Zap className="w-3.5 h-3.5 text-[#f5f5f7]" />
                        </div>
                        <span className="text-xs font-medium text-white truncate">
                          {mOrder.creator_username || `#${mOrder.order_number}`}
                        </span>
                        <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border bg-[var(--color-error)]/10 border-[var(--color-error)]/20 text-[var(--color-error)]">
                          You Pay
                        </span>
                        <span className="flex items-center gap-0.5 text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border bg-white/[0.06] border-white/[0.12] text-[#f5f5f7]">
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
                          liveExpiry <= 120 ? "text-foreground/50" : "text-[#f5f5f7]"
                        }`}
                      >
                        {liveExpiry <= 0
                          ? "Expired"
                          : liveExpiry >= 3600
                          ? `${Math.floor(liveExpiry / 3600)}h ${Math.floor(
                              (liveExpiry % 3600) / 60,
                            )}m`
                          : liveExpiry >= 60
                          ? `${Math.floor(liveExpiry / 60)}m ${
                              liveExpiry % 60
                            }s`
                          : `${liveExpiry}s`}
                        <span
                          className="animate-pulse"
                          style={{
                            filter:
                              liveExpiry <= 120
                                ? "drop-shadow(0 0 6px #ef4444)"
                                : "drop-shadow(0 0 4px #f5f5f7)",
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
                            ? "bg-white/[0.06] border border-white/[0.12]"
                            : "bg-white/[0.06] border border-white/[0.12]"
                        }`}
                      >
                        <span className="text-xs shrink-0">🔥</span>
                        <span
                          className={`text-[10px] font-bold ${
                            liveExpiry <= 120
                              ? "text-foreground/50"
                              : "text-[#f5f5f7]"
                          }`}
                        >
                          {liveExpiry <= 120
                            ? "Expiring soon! Act now"
                            : `Expires in ${Math.floor(liveExpiry / 60)}m ${
                                liveExpiry % 60
                              }s`}
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
                        <span className="text-[10px] text-[#f5f5f7] font-mono mr-1">
                          Get
                        </span>
                        <span className="font-bold text-[#f5f5f7]">
                          {fiatTotal.toLocaleString()}{" "}
                          {(mOrder as any).corridor_id === "USDT_INR"
                            ? "INR"
                            : "AED"}
                        </span>
                      </span>
                      {yourCut > 0 && (
                        <span className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-[#f5f5f7]">
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
                        <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-[#f5f5f7]">
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
                              ? "bg-white/[0.06] text-black/60 cursor-wait"
                              : "bg-[#f5f5f7] text-[#0b0b0c] hover:bg-white/90"
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
                      const total = Math.max(
                        1,
                        mOrder.seconds_until_expiry || 1,
                      );
                      const pct = Math.max(
                        0,
                        Math.min(100, (liveExpiry / total) * 100),
                      );
                      return (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground/[0.04] rounded-b-lg overflow-hidden">
                          <div
                            className={`h-full transition-[width] duration-1000 ease-linear ${
                              liveExpiry <= 120 ? "bg-[#f5f5f7]" : "bg-[#f5f5f7]"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            }

            // Premium vs the LIVE per-corridor reference price (AED and INR
            // have different price levels — AED ≈ 3.67, INR ≈ 83 — so we
            // can't share a single fallback). Live price comes from the
            // shared useCorridorPrices hook backed by /api/corridor/dynamic-rate.
            // Falls through to the order's stored ref_price_at_create if live
            // is unavailable.
            const liveRef = resolveCorridorRef(
              corridorPrices,
              order.dbOrder?.corridor_id,
              order.toCurrency || order.dbOrder?.fiat_currency,
            );
            const storedRef = Number(order.dbOrder?.ref_price_at_create);
            const refPrice =
              liveRef && liveRef > 0
                ? liveRef
                : Number.isFinite(storedRef) && storedRef > 0
                ? storedRef
                : null;
            const premium =
              refPrice && order.rate
                ? ((order.rate - refPrice) / refPrice) * 100
                : 0;
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
                (isPlaceholderUser &&
                  order.orderMerchantId === merchantInfo?.id);

            const effStatusForDot: string =
              order.status || order.dbOrder?.status || "pending";
            const isActivelyPendingForDot =
              effStatusForDot === "pending" && order.expiresIn > 0;

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
                {/* Live pulse dot — sits exactly on the card's top-left corner.
                  Rendered OUTSIDE the overflow-hidden inner wrapper so the
                  pinging halo isn't clipped. */}
                {isActivelyPendingForDot && (
                  <span className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 flex h-2.5 w-2.5 z-20 pointer-events-none">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-[#f5f5f7] opacity-60 animate-ping" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#f5f5f7]" />
                  </span>
                )}
                <div
                  data-testid={`order-card-${order.id}`}
                  onClick={() => onSelectOrder(order)}
                  className={`relative p-3 rounded-xl transition-all cursor-pointer overflow-hidden ${
                    isMyOwnOrder ? "opacity-[0.85]" : ""
                  }`}
                  style={{
                    background: "#111113",
                    border: isMineable
                      ? "1px solid rgba(245,245,247,0.25)"
                      : "1px solid rgba(255,255,255,0.07)",
                    borderLeft: isMineable
                      ? "2px solid rgba(245,245,247,0.5)"
                      : undefined,
                  }}
                  onMouseEnter={(e) =>
                    !isMyOwnOrder &&
                    (e.currentTarget.style.borderColor =
                      "rgba(255,255,255,0.13)")
                  }
                  onMouseLeave={(e) =>
                    !isMyOwnOrder &&
                    (e.currentTarget.style.borderColor = isMineable
                      ? "rgba(245,245,247,0.25)"
                      : "rgba(255,255,255,0.07)")
                  }
                >
                  {(() => {
                    // ── Resolve all display data up-front ──────────────────
                    const { seller, buyer } = getPartyNames(order.dbOrder);
                    const soloName = seller || buyer || order.user || null;
                    // Counterparty for the profile sheet (shared helper, also
                    // used by the mobile cards + the order-info popup). For a
                    // U2M order the counterparty is the user who placed it; for
                    // M2M it's the OTHER merchant slot — resolved role-aware so a
                    // claimed order viewed from the buyer slot opens the seller.
                    const _cp = deriveCounterparty(
                      order.dbOrder,
                      merchantInfo?.id,
                    );
                    const cpEntityType: ProfileEntityType =
                      _cp?.entityType ?? "user";
                    const cpEntityId: string | null = _cp?.id ?? null;
                    const username =
                      order.dbOrder?.user?.username || order.user;
                    // For open/market (M2M) orders the counterparty "username"
                    // is an internal placeholder like `open_order_…` that isn't
                    // a real name and overflows the tooltip. In that case show
                    // the friendly order ref (#BM-…) instead; keep the real
                    // username for normal user trades.
                    const _isPlaceholderCp =
                      typeof username === "string" &&
                      (username.startsWith("open_order_") ||
                        username.startsWith("m2m_"));
                    const _orderRef = order.dbOrder?.order_number
                      ? `#${order.dbOrder.order_number}`
                      : null;
                    const tooltipTitle = _isPlaceholderCp
                      ? _orderRef ?? "Open Order"
                      : username;
                    const avatarSrc =
                      (order.dbOrder?.user?.avatar_url as string | undefined) ||
                      (order as any).user_avatar ||
                      null;
                    const rating = order.dbOrder?.user?.rating;
                    const trades = order.dbOrder?.user?.total_trades ?? 0;
                    const tooltipItems: InfoTooltipItem[] = [
                      {
                        label: "Rating",
                        value:
                          rating != null
                            ? `★ ${Number(rating).toFixed(1)} / 5.0`
                            : "No rating yet",
                      },
                      { label: "Trades", value: `${trades} completed` },
                      {
                        label: "Trust",
                        value:
                          trades >= 50
                            ? "Verified trader"
                            : trades >= 10
                            ? "Regular trader"
                            : "New trader",
                      },
                    ];
                    const pmLabel: Record<string, string> = {
                      bank: "Bank",
                      cash: "Cash",
                      upi: "UPI",
                    };
                    // Payment-rail badge. On a broadcast BUY order the single
                    // `payment_method` column defaults to 'bank' at creation
                    // and does NOT reflect the buyer's choice — their actual
                    // selected rails live in `buyer_payment_types` (an array).
                    // Reading `payment_method` made every pending card show
                    // "Bank" regardless of what the buyer picked, so prefer the
                    // buyer's rails here. Fall back to a locked method / legacy
                    // single method for sell / offer / legacy orders.
                    const buyerPayTypes: string[] = Array.isArray(
                      (order.dbOrder as { buyer_payment_types?: string[] })
                        ?.buyer_payment_types,
                    )
                      ? (order.dbOrder as { buyer_payment_types?: string[] })
                          .buyer_payment_types!
                      : [];
                    const pmDisplay: string | null = order.lockedPaymentMethod
                      ?.type
                      ? pmLabel[order.lockedPaymentMethod.type] ||
                        order.lockedPaymentMethod.type
                      : buyerPayTypes.length > 0
                      ? buyerPayTypes.map((t) => pmLabel[t] || t).join(", ")
                      : order.dbOrder?.payment_method
                      ? pmLabel[order.dbOrder.payment_method] ||
                        order.dbOrder.payment_method
                      : order.userBankDetails
                      ? "Bank"
                      : null;
                    const effStatus: string =
                      order.status || order.dbOrder?.status || "pending";
                    const isActivelyPending =
                      effStatus === "pending" && order.expiresIn > 0;
                    const viewerSide = getViewerSide(
                      order.dbOrder,
                      merchantInfo?.id,
                    );
                    const cryptoAmt = Math.round(order.amount).toLocaleString();
                    const fiatAmt = Math.round(order.total).toLocaleString();
                    const primaryAmt = cryptoAmt;
                    const primaryCcy = order.fromCurrency;
                    const secondaryAmt = fiatAmt;
                    const secondaryCcy = order.toCurrency;
                    const payLabel =
                      viewerSide === "seller" ? "you pay" : "you receive";
                    const extraPct =
                      order.protocolFeePercent != null
                        ? order.protocolFeePercent -
                          (order.spreadPreference === "fastest"
                            ? 2.5
                            : order.spreadPreference === "best"
                            ? 2.0
                            : 1.5)
                        : 0;

                    // Order-details rows for the ⓘ tooltip. Values mirror what the
                    // card itself shows (same rounding/formatting) so the tooltip
                    // never disagrees with the card.
                    const createdRaw =
                      order.dbOrder?.created_at || order.timestamp;
                    const createdDate = createdRaw
                      ? createdRaw instanceof Date
                        ? createdRaw
                        : new Date(createdRaw)
                      : null;
                    const expiresLabel =
                      order.expiresIn > 0
                        ? order.expiresIn >= 3600
                          ? `${Math.floor(
                              order.expiresIn / 3600,
                            )}h ${Math.floor((order.expiresIn % 3600) / 60)}m`
                          : order.expiresIn >= 60
                          ? `${Math.floor(order.expiresIn / 60)}m ${
                              order.expiresIn % 60
                            }s`
                          : `${order.expiresIn}s`
                        : "Expired";
                    const orderDetailItems: InfoTooltipItem[] = [
                      {
                        label: "Order ID",
                        value: order.dbOrder?.order_number
                          ? `#${order.dbOrder.order_number}`
                          : username || "—",
                      },
                      {
                        label: "Order Type",
                        value: order.type?.toUpperCase() || "—",
                      },
                      { label: "Amount", value: `${cryptoAmt} ${primaryCcy}` },
                      {
                        label: "Price",
                        value: `${order.rate.toFixed(2)} ${secondaryCcy}`,
                      },
                      { label: "Total", value: `${fiatAmt} ${secondaryCcy}` },
                      {
                        label: "Payment Method",
                        value: pmDisplay || "—",
                      },
                      ...(createdDate
                        ? [
                            {
                              label: "Created",
                              value: createdDate.toLocaleString("en-US", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }),
                            },
                          ]
                        : []),
                      { label: "Expires in", value: expiresLabel },
                    ];

                    return (
                      <>
                        {/* ── Row 1: Avatar / Name / Handle · Action top-right ── */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div
                            className={`flex items-center gap-2.5 min-w-0 ${
                              cpEntityId ? "cursor-pointer" : ""
                            }`}
                            onClick={(e) => {
                              if (!cpEntityId) return;
                              e.stopPropagation();
                              setProfileTarget({
                                entityType: cpEntityType,
                                id: cpEntityId,
                              });
                            }}
                          >
                            <div className="relative shrink-0">
                              <UserAvatar
                                src={avatarSrc}
                                seed={soloName || "U"}
                                size={36}
                                className="rounded-full border border-white/[0.08]"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-white/90 leading-tight truncate">
                                  {soloName || "—"}
                                </span>
                                <InfoTooltip
                                  side="bottom"
                                  title={tooltipTitle}
                                  // Own broadcasts have no counterparty yet, so
                                  // the Rating/Trades/Trust rows would be empty
                                  // placeholder data — drop that section and keep
                                  // only the order details for my own orders.
                                  description={
                                    isMyOwnOrder
                                      ? "Your order — waiting for a counterparty."
                                      : "Counterparty stats."
                                  }
                                  sections={
                                    isMyOwnOrder
                                      ? [
                                          {
                                            heading: "Order details",
                                            items: orderDetailItems,
                                          },
                                        ]
                                      : [
                                          { items: tooltipItems },
                                          {
                                            heading: "Order details",
                                            items: orderDetailItems,
                                          },
                                        ]
                                  }
                                />
                              </div>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span
                                  className={`text-[10px] font-mono font-semibold ${
                                    order.type === "buy"
                                      ? "text-[#f5f5f7]"
                                      : "text-foreground/50"
                                  }`}
                                >
                                  {order.type?.toUpperCase() || "TRADE"}
                                </span>
                                {pmDisplay && (
                                  <span className="text-[10px] text-white/20 font-mono">
                                    · {pmDisplay}
                                  </span>
                                )}
                                {isMyOwnOrder && (
                                  <span className="text-[10px] text-white/40 font-mono">
                                    · yours
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Top-right: status pill or accept button */}
                          {isActivelyPending && !isMyOwnOrder ? (
                            <button
                              data-testid="order-primary-action"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAcceptOrder(order);
                              }}
                              disabled={acceptingOrderId === order.id}
                              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all press-effect ${
                                acceptingOrderId === order.id
                                  ? "bg-white/[0.06] text-white/40 cursor-wait"
                                  : "bg-[#f5f5f7] text-[#0b0b0c] font-bold hover:bg-white/90"
                              }`}
                            >
                              {acceptingOrderId === order.id ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />{" "}
                                  Accepting…
                                </>
                              ) : (
                                <>
                                  {order.dbOrder?.primaryAction?.label ||
                                    (isMineable ? "Mine" : "Accept")}{" "}
                                  →
                                </>
                              )}
                            </button>
                          ) : isActivelyPending && isMyOwnOrder ? (
                            <span className="flex items-center gap-1 text-[10px] font-mono text-white/40 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
                              waiting
                            </span>
                          ) : (
                            (() => {
                              const badge =
                                MY_STATUS_BADGE[effStatus] ||
                                MY_STATUS_BADGE.pending;
                              const StatusIcon = badge.Icon;
                              return (
                                <span
                                  className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-semibold border shrink-0 ${badge.cls}`}
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                                  {badge.label}
                                </span>
                              );
                            })()
                          )}
                        </div>

                        {/* ── Primary amount — big and left-aligned ── */}
                        <div className="mb-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-[26px] font-bold tabular-nums leading-none text-white/90 tracking-tight">
                              {primaryAmt}
                            </span>
                            <span className="text-[13px] font-medium text-white/35">
                              {primaryCcy}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className="text-[11px] text-white/30">→</span>
                            <span className="text-[12px] font-mono tabular-nums text-white/40">
                              {secondaryAmt}{" "}
                              <span className="text-white/25">
                                {secondaryCcy}
                              </span>
                            </span>
                          </div>
                        </div>

                        {/* ── Timer + rate footer ── */}
                        <div className="flex items-center justify-between gap-2 mt-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-white/15 font-mono tabular-nums">
                              @ {order.rate.toFixed(2)}
                            </span>
                            {extraPct > 0 && (
                              <span className="text-[10px] font-mono text-[#f5f5f7]/70">
                                +{extraPct.toFixed(1)}%
                              </span>
                            )}
                            {isMyOwnOrder && onCancelOrder && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCancelOrder(order);
                                }}
                                className="text-[10px] text-foreground/30 hover:text-foreground/70 transition-colors font-mono"
                              >
                                cancel
                              </button>
                            )}
                          </div>
                          {isActivelyPending ? (
                            <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums text-foreground/50">
                              <Clock className="w-3 h-3" />
                              {order.expiresIn >= 3600
                                ? `${Math.floor(
                                    order.expiresIn / 3600,
                                  )}h ${Math.floor(
                                    (order.expiresIn % 3600) / 60,
                                  )}m`
                                : order.expiresIn >= 60
                                ? `${Math.floor(order.expiresIn / 60)}m ${
                                    order.expiresIn % 60
                                  }s`
                                : `${order.expiresIn}s`}
                            </div>
                          ) : (
                            (() => {
                              const ts =
                                order.dbOrder?.completed_at ||
                                order.dbOrder?.cancelled_at ||
                                order.dbOrder?.created_at ||
                                order.timestamp;
                              const tsDate =
                                ts instanceof Date
                                  ? ts
                                  : ts
                                  ? new Date(ts)
                                  : null;
                              return tsDate ? (
                                <span className="text-[10px] text-white/20 font-mono tabular-nums">
                                  {tsDate.toLocaleString([], {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              ) : null;
                            })()
                          )}
                        </div>
                      </>
                    );
                  })()}
                  {/* Countdown timer bar (bottom) — only for actively-pending orders */}
                  {(() => {
                    const effStatus: string =
                      order.status || order.dbOrder?.status || "pending";
                    if (effStatus !== "pending" || order.expiresIn <= 0)
                      return null;
                    const total = 900;
                    const pct = Math.max(
                      0,
                      Math.min(100, (order.expiresIn / total) * 100),
                    );
                    return (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground/[0.04]">
                        <div
                          className={`h-full transition-[width] duration-1000 ease-linear ${
                            order.expiresIn <= 120
                              ? "bg-[#f5f5f7]"
                              : "bg-[#f5f5f7]"
                          }`}
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

      {/* Counterparty profile — opened by tapping a card's avatar/name above. */}
      <ProfileSheet
        open={!!profileTarget}
        entityType={profileTarget?.entityType ?? null}
        id={profileTarget?.id ?? null}
        variant="merchant"
        onClose={() => setProfileTarget(null)}
      />
    </>
  );
});

export const PendingOrdersPanel = memo(function PendingOrdersPanel({
  orders,
  mempoolOrders,
  merchantInfo,
  onSelectOrder,
  onSelectMempoolOrder,
  onAcceptOrder,
  onCancelOrder,
  acceptingOrderId,
  fetchOrders,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  collapsed = false,
  onCollapseChange,
}: PendingOrdersPanelProps) {
  // Live per-corridor reference prices for the "Premium" filter predicate.
  // Shares the same module-level singleton as OrderList's hook call —
  // only one polling loop runs.
  const corridorPrices = useCorridorPrices();

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
  const [searchVisible, setSearchVisible] = useState(false);
  // Header overflow ("⋯") menu — holds the utility controls when the panel
  // is too narrow to lay them out inline without overlapping.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

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
    // myOrders only feeds the "Mine" tab list, so there's no need to fetch (let
    // alone poll the heavy multi-status history endpoint every 15s) while the
    // merchant is on another tab. Fetch on demand when the Mine tab is shown.
    if (view !== "mine") return;
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
    const interval = setInterval(() => {
      // Skip background ticks on a hidden tab — the load() above re-runs when the
      // Mine tab is re-opened, so there's no staleness gap.
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, 15000);
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
      if (
        moreMenuRef.current &&
        !moreMenuRef.current.contains(e.target as Node)
      ) {
        setMoreMenuOpen(false);
      }
      setFilterDropdownOpen(false);
    };
    if (sortDropdownOpen || filterDropdownOpen || moreMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [sortDropdownOpen, filterDropdownOpen, moreMenuOpen]);

  // Wrap my orders from the dedicated fetch into the same shape as UI orders
  const wrappedMyOrders = myOrders.map((dbRow: any) => {
    const userName =
      dbRow.user?.name ||
      dbRow.user?.username ||
      dbRow.merchant?.display_name ||
      "Trader";

    // Compute live expiresIn from expires_at (or fallback to created_at + 15min
    // for rows missing expires_at). Matches mapDbOrderToUI so the timer and
    // pulse dot render correctly for my own pending orders.
    const nowMs = Date.now();
    let expiresIn = 0;
    if (dbRow.expires_at) {
      expiresIn = Math.max(
        0,
        Math.floor((new Date(dbRow.expires_at).getTime() - nowMs) / 1000),
      );
    } else if (dbRow.created_at) {
      expiresIn = Math.max(
        0,
        Math.floor(
          (new Date(dbRow.created_at).getTime() + 15 * 60 * 1000 - nowMs) /
            1000,
        ),
      );
    }

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
      expiresIn,
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
    // Parent (merchant/page.tsx pendingOrders) already routes self-unaccepted
    // and unclaimed-escrow rows here; only accept escrowed when accepted_at
    // is null so claimed orders never double up in In Progress.
    const isPendingLike = (o: any): boolean => {
      const s = o.status || o.dbOrder?.status;
      if (s === "pending") return true;
      if ((s === "escrowed" || s === "escrow") && !o.dbOrder?.accepted_at) {
        return true;
      }
      return false;
    };
    const marketOrders = [...orders].filter(isPendingLike);
    const myPending = wrappedMyOrders.filter(
      (o: any) => isCreatedByMe(o) && isPendingLike(o),
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
    // ─── ALL: LIVE / active orders only — pending + in-progress
    // (accepted/escrowed/payment_sent) + disputed. TERMINAL orders
    // (completed / cancelled / expired) are excluded; they belong in History /
    // the "Mine" tab, not the New feed. Mirrors MobileOrdersView's "All".
    const TERMINAL = ["completed", "cancelled", "expired"];
    const isLive = (o: any): boolean => {
      if (o?.isMempoolOrder) return true; // live broadcast
      const ui = String(o?.status || "").toLowerCase();
      const raw = String(o?.dbOrder?.status || "").toLowerCase();
      const min = String(
        o?.minimalStatus || o?.dbOrder?.minimal_status || "",
      ).toLowerCase();
      if (TERMINAL.includes(ui) || TERMINAL.includes(raw) || TERMINAL.includes(min)) {
        return false;
      }
      // A never-accepted order whose matching window lapsed is effectively
      // expired even if its status hasn't flipped yet.
      const expMs = o?.dbOrder?.expires_at
        ? new Date(o.dbOrder.expires_at).getTime()
        : NaN;
      const lapsed =
        (Number.isFinite(expMs) && expMs <= Date.now()) ||
        (typeof o?.expiresIn === "number" && o.expiresIn <= 0);
      const everAccepted =
        !!o?.dbOrder?.accepted_at ||
        ["accepted", "escrow", "escrowed", "payment_sent", "disputed"].includes(ui) ||
        ["accepted", "escrow", "escrowed", "payment_sent", "disputed"].includes(raw) ||
        ["accepted", "escrow", "escrowed", "payment_sent", "disputed"].includes(min);
      return !(lapsed && !everAccepted);
    };
    const marketOrders = [...orders].filter(isLive);

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

    const allIds = new Set(allOrders.map((o: any) => o.id));
    const uniqueMyOrders = wrappedMyOrders.filter(
      (o: any) => !allIds.has(o.id) && isCreatedByMe(o) && isLive(o),
    );
    displayOrders = [...allOrders, ...uniqueMyOrders];
  }

  if (pendingFilter !== "all") {
    displayOrders = displayOrders.filter((order) => {
      if ((order as any).isMempoolOrder) return true;
      if (pendingFilter === "mineable") return !!order.escrowTxHash;
      else if (pendingFilter === "premium") {
        const liveRef = resolveCorridorRef(
          corridorPrices,
          order.dbOrder?.corridor_id,
          order.toCurrency || order.dbOrder?.fiat_currency,
        );
        const storedRef = Number(order.dbOrder?.ref_price_at_create);
        const refPrice =
          liveRef && liveRef > 0
            ? liveRef
            : Number.isFinite(storedRef) && storedRef > 0
            ? storedRef
            : null;
        if (!refPrice || !order.rate) return false;
        const premium = ((order.rate - refPrice) / refPrice) * 100;
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
      const aTime = new Date(
        a.dbOrder?.created_at || a.createdAt || 0,
      ).getTime();
      const bTime = new Date(
        b.dbOrder?.created_at || b.createdAt || 0,
      ).getTime();
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
    if (orderFilters.type !== "all") {
      // Type filter matches the merchant's VIEWER perspective (what the card
      // shows as YOU PAY / YOU RECEIVE), NOT the creator-perspective raw
      // dbOrder.type. viewerSide "buyer" = merchant receives crypto = a BUY to
      // them; "seller" = merchant pays crypto = a SELL. Uses the exact same
      // getViewerSide() call as the Row 2 card label so the filter and the
      // displayed direction never diverge (e.g. an order shown as a buy no
      // longer leaks into the SELL filter).
      const viewerType =
        getViewerSide(order.dbOrder, merchantInfo?.id) === "buyer"
          ? "buy"
          : "sell";
      if (viewerType !== orderFilters.type) return false;
    }
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
    <div className={`flex flex-col ${collapsed ? "" : "h-full"}`}>
      {/* Header — single row */}
      <div className="px-3 py-2 border-b border-section-divider">
        {/* Header row 1: title + utilities (mirrors Active Trades two-row header) */}
        <div
          className={`flex items-center justify-between gap-1 min-w-0 ${
            collapsed ? "" : "mb-1.5"
          }`}
        >
          {/* Title + live dot — clicking toggles collapse (mirrors Active Trades) */}
          <div
            className={`flex items-center gap-1 min-w-0 ${
              onCollapseChange ? "cursor-pointer select-none" : ""
            }`}
            onClick={
              onCollapseChange ? () => onCollapseChange(!collapsed) : undefined
            }
          >
            <ChevronDown
              className={`w-3 h-3 text-foreground/30 shrink-0 transition-transform duration-200 ${
                collapsed ? "-rotate-90" : ""
              }`}
            />
            <span className="text-[11px] font-semibold text-white/70 tracking-tight shrink-0">
              New Orders
            </span>
            <span
              className="relative flex shrink-0 h-2 w-2 ml-0.5"
              title="Live feed"
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/50 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white/50 shadow-[0_0_6px_rgba(251,146,60,0.9)]" />
            </span>
          </div>

          {/* Count (utilities moved to the tabs row below) */}
          <span className="shrink-0 text-[10px] border border-foreground/[0.08] text-foreground/50 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
            {filteredOrders.length}
          </span>
        </div>

        {!collapsed && (
          <>
            {/* Header row 2: tabs + filter/sort. `@container` so the utility
                cluster can collapse into a ⋯ menu by the row's own width. */}
            <div className="@container flex items-center gap-1 min-w-0">
              {/* Tabs */}
              <div className="inline-flex items-center gap-0.5 h-7 xl:h-8 [@media(min-height:900px)]:h-8 p-0.5 rounded-lg bg-foreground/[0.04] border border-foreground/[0.06] shrink-0">
                {(["all", "pending", "mine"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setView(tab)}
                    className={`h-full px-3 inline-flex items-center rounded-md text-[11px] font-bold transition-all ${
                      view === tab
                        ? "bg-white/[0.08] text-white/90 border border-white/[0.12]"
                        : "text-foreground/35 hover:text-foreground/60 border border-transparent"
                    }`}
                  >
                    {tab === "all"
                      ? "All"
                      : tab === "pending"
                      ? "Pending"
                      : "Mine"}
                  </button>
                ))}
              </div>

              <div className="flex-1" />

              {/* Inline utility cluster — hidden once the row is too narrow;
                  its controls move into the ⋯ overflow menu below. */}
              <div className="flex items-center gap-1 @max-[380px]:hidden">
              {/* Sound */}
              <button
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  if (next) setTimeout(() => playSound?.("notification"), 0);
                }}
                className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  soundEnabled
                    ? "bg-white/[0.06] border-white/[0.12] text-[#f5f5f7]"
                    : "bg-foreground/[0.02] border-foreground/[0.06] text-foreground/25 hover:bg-foreground/[0.05]"
                }`}
                title={soundEnabled ? "Sound on" : "Sound off"}
              >
                {soundEnabled ? (
                  <Volume2 className="w-3 h-3" />
                ) : (
                  <VolumeX className="w-3 h-3" />
                )}
              </button>

              {/* Refresh */}
              <button
                onClick={fetchOrders}
                className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border border-foreground/[0.06] bg-foreground/[0.02] hover:bg-foreground/[0.05] transition-colors"
              >
                <RotateCcw className="w-3 h-3 text-foreground/25" />
              </button>

              {/* Search toggle */}
              <button
                onClick={() =>
                  setSearchVisible((v) => {
                    if (v) setSearchQuery("");
                    return !v;
                  })
                }
                className={`shrink-0 inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                  searchVisible || searchQuery
                    ? "bg-white/[0.06] text-[#f5f5f7] border-white/[0.12]"
                    : "bg-foreground/[0.02] border-foreground/[0.06] text-foreground/25 hover:bg-foreground/[0.05]"
                }`}
                title="Search"
              >
                <Search className="w-3 h-3" />
              </button>

              {/* Filter dropdown */}
              <div className="relative shrink-0">
                <button
                  onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                  className={`inline-flex items-center gap-1 h-7 px-1.5 text-[9px] font-mono border rounded transition-colors ${
                    pendingFilter !== "all"
                      ? "bg-white/[0.06] text-[#f5f5f7] border-white/[0.12]"
                      : "bg-foreground/[0.02] text-white/30 border-foreground/[0.06] hover:border-border-strong"
                  }`}
                >
                  {
                    {
                      all: "Filter",
                      mineable: "Mine",
                      premium: "Prem",
                      large: "Large",
                      expiring: "Exp",
                    }[pendingFilter]
                  }
                  <ChevronDown
                    className={`w-2.5 h-2.5 transition-transform ${
                      filterDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <AnimatePresence>
                  {filterDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-1 z-30 bg-card-solid border border-foreground/[0.08] rounded-lg shadow-xl py-1 min-w-[110px]"
                    >
                      {(
                        [
                          "all",
                          "mineable",
                          "premium",
                          "large",
                          "expiring",
                        ] as const
                      ).map((f) => (
                        <button
                          key={f}
                          onClick={() => {
                            setPendingFilter(f);
                            setFilterDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-1.5 text-left text-[10px] font-medium transition-colors ${
                            pendingFilter === f
                              ? "bg-white/[0.06] text-[#f5f5f7]"
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
              <div className="relative shrink-0" ref={sortDropdownRef}>
                <button
                  onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
                  className="inline-flex items-center gap-1 h-7 px-1.5 text-[9px] font-mono text-white/30 bg-foreground/[0.02] border border-foreground/[0.06] rounded hover:border-border-strong transition-colors"
                >
                  {
                    {
                      time: "Time",
                      premium: "Prem",
                      amount: "Size",
                      rating: "★",
                    }[pendingSortBy]
                  }
                  <ChevronDown
                    className={`w-2.5 h-2.5 transition-transform ${
                      sortDropdownOpen ? "rotate-180" : ""
                    }`}
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
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setPendingSortBy(opt.value);
                            setSortDropdownOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] font-mono transition-colors ${
                            pendingSortBy === opt.value
                              ? "text-foreground/70 bg-foreground/[0.06]"
                              : "text-white/35 hover:text-foreground/50 hover:bg-foreground/[0.04]"
                          }`}
                        >
                          {opt.label}
                          {pendingSortBy === opt.value && (
                            <Check className="w-2.5 h-2.5 text-foreground/50" />
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              </div>

              {/* Overflow ⋯ menu — only rendered (visible) when the inline
                  cluster is hidden at narrow widths. Same actions, stacked. */}
              <div
                className="relative shrink-0 hidden @max-[380px]:block"
                ref={moreMenuRef}
              >
                <button
                  onClick={() => setMoreMenuOpen((o) => !o)}
                  className={`inline-flex items-center justify-center w-7 h-7 rounded border transition-all ${
                    moreMenuOpen || pendingFilter !== "all"
                      ? "bg-white/[0.06] text-[#f5f5f7] border-white/[0.12]"
                      : "bg-foreground/[0.02] border-foreground/[0.06] text-foreground/25 hover:bg-foreground/[0.05]"
                  }`}
                  title="More"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
                <AnimatePresence>
                  {moreMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 top-full mt-1 z-50 min-w-[160px] bg-[#1a1a1a] border border-foreground/[0.08] rounded-lg shadow-xl p-1"
                    >
                      {/* Actions */}
                      <button
                        onClick={() => {
                          const next = !soundEnabled;
                          setSoundEnabled(next);
                          if (next)
                            setTimeout(() => playSound?.("notification"), 0);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] text-foreground/70 hover:bg-foreground/[0.06] transition-colors"
                      >
                        {soundEnabled ? (
                          <Volume2 className="w-3 h-3" />
                        ) : (
                          <VolumeX className="w-3 h-3" />
                        )}
                        {soundEnabled ? "Sound on" : "Sound off"}
                      </button>
                      <button
                        onClick={() => {
                          fetchOrders();
                          setMoreMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] text-foreground/70 hover:bg-foreground/[0.06] transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Refresh
                      </button>
                      <button
                        onClick={() => {
                          setSearchVisible((v) => {
                            if (v) setSearchQuery("");
                            return !v;
                          });
                          setMoreMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] text-foreground/70 hover:bg-foreground/[0.06] transition-colors"
                      >
                        <Search className="w-3 h-3" />
                        Search
                      </button>

                      <div className="h-px bg-foreground/[0.06] my-1" />
                      {/* Filter */}
                      <div className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-foreground/30 font-mono">
                        Filter
                      </div>
                      {(
                        [
                          { key: "all", label: "All" },
                          { key: "mineable", label: "Mineable" },
                          { key: "premium", label: "High Premium" },
                          { key: "large", label: "Large" },
                          { key: "expiring", label: "Expiring" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => setPendingFilter(opt.key)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[11px] transition-colors ${
                            pendingFilter === opt.key
                              ? "bg-white/[0.06] text-[#f5f5f7]"
                              : "text-foreground/60 hover:bg-foreground/[0.04]"
                          }`}
                        >
                          {opt.label}
                          {pendingFilter === opt.key && (
                            <Check className="w-2.5 h-2.5 text-foreground/50" />
                          )}
                        </button>
                      ))}

                      <div className="h-px bg-foreground/[0.06] my-1" />
                      {/* Sort */}
                      <div className="px-2.5 py-1 text-[9px] uppercase tracking-wider text-foreground/30 font-mono">
                        Sort
                      </div>
                      {(
                        [
                          { value: "time", label: "Time" },
                          { value: "premium", label: "Premium" },
                          { value: "amount", label: "Size" },
                          { value: "rating", label: "Rating" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setPendingSortBy(opt.value)}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[11px] transition-colors ${
                            pendingSortBy === opt.value
                              ? "bg-white/[0.06] text-[#f5f5f7]"
                              : "text-foreground/60 hover:bg-foreground/[0.04]"
                          }`}
                        >
                          {opt.label}
                          {pendingSortBy === opt.value && (
                            <Check className="w-2.5 h-2.5 text-foreground/50" />
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Search input (shown when toggled) */}
            {searchVisible && (
              <div className="flex items-center gap-1.5 mt-1.5 bg-foreground/[0.02] border border-foreground/[0.06] rounded-lg px-2.5 py-1.5 focus-within:border-white/[0.12] transition-colors">
                <Search className="w-3 h-3 text-foreground/20 shrink-0" />
                <input
                  type="search"
                  role="searchbox"
                  name="orders-search"
                  autoComplete="off"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  maxLength={100}
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search orders..."
                  className="flex-1 bg-transparent text-[11px] text-white placeholder:text-foreground/15 outline-none focus-visible:outline-none font-mono"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-foreground/30 hover:text-foreground/60"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {/* My Orders sub-filter */}
            {view === "mine" && (
              <div className="flex items-center gap-1 mt-1.5">
                {(
                  [
                    "all",
                    "active",
                    "completed",
                    "cancelled",
                    "expired",
                  ] as const
                ).map((f) => (
                  <button
                    key={f}
                    onClick={() => setMyFilter(f)}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-all capitalize ${
                      myFilter === f
                        ? "bg-white/[0.06] text-white/80 border border-white/[0.10]"
                        : "text-foreground/25 hover:text-foreground/50 border border-transparent"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}

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
                        { key: "all", label: "All" },
                        { key: "yes", label: "Secured" },
                        { key: "no", label: "Open" },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() =>
                            setOrderFilters((f: any) => ({
                              ...f,
                              secured: key,
                            }))
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
          </>
        )}
      </div>

      {/* Orders List */}
      {!collapsed && (
        <>
          {view === "mine" ? (
            <MyOrdersList
              orders={filteredOrders}
              isLoading={myOrdersLoading}
              onSelectOrder={onSelectOrder}
              merchantInfo={merchantInfo}
            />
          ) : (
            <OrderList
              filteredOrders={filteredOrders}
              merchantInfo={merchantInfo}
              onSelectOrder={onSelectOrder}
              onSelectMempoolOrder={onSelectMempoolOrder}
              onAcceptOrder={onAcceptOrder}
              onCancelOrder={onCancelOrder}
              acceptingOrderId={acceptingOrderId}
              fetchOrders={fetchOrders}
            />
          )}

          {/* Load More button — only shows on the All / Pending feeds (not the
          "My Orders" tab, which has its own paginator), and only when there
          are already rows visible. Without the empty-list guard the button
          renders under the "No pending orders" empty state — confusing
          because there's nothing to "load more" of from the user's POV. */}
          {view !== "mine" &&
            filteredOrders.length > 0 &&
            hasMore &&
            onLoadMore && (
              <div className="px-3 py-2 border-t border-section-divider">
                <button
                  onClick={onLoadMore}
                  disabled={isLoadingMore}
                  className="w-full py-2 rounded-lg text-[11px] font-bold text-foreground/40 hover:text-foreground/60 bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.06] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {isLoadingMore ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    "Load More"
                  )}
                </button>
              </div>
            )}
        </>
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
    cls: "bg-white/[0.06] text-white/60 border-white/[0.09]",
    Icon: CircleDot,
  },
  accepted: {
    label: "Accepted",
    cls: "bg-white/[0.06] text-[#f5f5f7] border-white/[0.09]",
    Icon: CheckCircle2,
  },
  payment_pending: {
    label: "Payment Pending",
    cls: "bg-white/[0.06] text-white/60 border-white/[0.09]",
    Icon: CircleDot,
  },
  payment_sent: {
    label: "Payment Sent",
    cls: "bg-white/[0.06] text-white/60 border-white/[0.09]",
    Icon: CircleDot,
  },
  payment_confirmed: {
    label: "Confirmed",
    cls: "bg-white/[0.06] text-[#f5f5f7] border-white/[0.09]",
    Icon: CheckCircle2,
  },
  completed: {
    label: "Completed",
    cls: "bg-white/[0.06] text-[#f5f5f7] border-white/[0.09]",
    Icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-white/[0.06] text-foreground/50 border-white/[0.12]",
    Icon: XCircle,
  },
  expired: {
    label: "Expired",
    cls: "bg-foreground/[0.06] text-foreground/40 border-foreground/[0.10]",
    Icon: AlertCircle,
  },
  disputed: {
    label: "Disputed",
    cls: "bg-white/[0.06] text-foreground/50 border-white/[0.12]",
    Icon: AlertCircle,
  },
};

const MyOrdersList = memo(function MyOrdersList({
  orders,
  isLoading,
  onSelectOrder,
  merchantInfo,
}: {
  orders: any[];
  isLoading: boolean;
  onSelectOrder: (order: any) => void;
  merchantInfo?: any;
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
        const fromCurrency = order.fromCurrency || "USDT";
        const toCurrency = order.toCurrency || db.fiat_currency || "AED";
        const createdAt = order.timestamp ?? new Date(db.created_at);
        const isCancelled = status === "cancelled";
        const isAccepted = !!db.accepted_at;

        const { seller, buyer } = getPartyNames(db);

        // Me-centric: one side is always me, the other is the counterparty.
        const myId = merchantInfo?.id;
        const myName =
          merchantInfo?.display_name || merchantInfo?.username || "You";
        const iAmSeller = !!myId && db.merchant_id === myId;
        const iAmBuyer = !!myId && db.buyer_merchant_id === myId;
        const mySide: "seller" | "buyer" = iAmSeller
          ? "seller"
          : iAmBuyer
          ? "buyer"
          : seller === myName
          ? "seller"
          : buyer === myName
          ? "buyer"
          : "seller";
        const counterpartyName: string | null =
          mySide === "seller" ? buyer : seller;
        const leftName = mySide === "seller" ? myName : counterpartyName;
        const rightName = mySide === "seller" ? counterpartyName : myName;
        const avatarChar = myName.charAt(0).toUpperCase();

        const cancelReason: string | null = isCancelled
          ? humanizeCancelReason(
              db.cancellation_reason || db.cancel_request_reason || null,
              { db, myId, counterpartyName },
            )
          : null;

        const crypto = {
          amount: Math.round(amount).toLocaleString(),
          currency: fromCurrency,
        };
        const fiat = {
          amount: Math.round(total).toLocaleString(),
          currency: toCurrency,
        };
        const viewerSide = getViewerSide(db, merchantInfo?.id);
        const left =
          viewerSide === "seller"
            ? { label: "YOU PAY", ...crypto, isReceive: false }
            : { label: "YOU RECEIVE", ...crypto, isReceive: true };
        const right =
          viewerSide === "seller"
            ? { label: "YOU RECEIVE", ...fiat, isReceive: true }
            : { label: "YOU PAY", ...fiat, isReceive: false };

        return (
          <button
            key={order.id}
            onClick={() => onSelectOrder(order)}
            className="group relative w-full text-left p-3 rounded-xl border transition-all cursor-pointer overflow-hidden bg-gradient-to-br from-foreground/[0.02] to-transparent border-foreground/[0.06] hover:border-foreground/[0.12] hover:shadow-md hover:shadow-black/20"
          >
            {/* Row 1: emoji + name + status badge | timestamp */}
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <div className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 text-sm border border-foreground/[0.08] shadow-sm">
                  {avatarChar}
                </div>
                <span className="flex items-center gap-1 text-[12px] font-semibold text-white min-w-0">
                  {leftName && rightName ? (
                    <>
                      <span
                        className="whitespace-nowrap"
                        title={`Seller: ${leftName}`}
                      >
                        {leftName}
                      </span>
                      <ArrowRight className="w-3 h-3 text-foreground/40 shrink-0" />
                      <span
                        className="whitespace-nowrap"
                        title={`Buyer: ${rightName}`}
                      >
                        {rightName}
                      </span>
                    </>
                  ) : (
                    <span
                      className={`whitespace-nowrap ${
                        leftName || rightName ? "" : "text-foreground/40"
                      }`}
                      title={
                        leftName || rightName
                          ? `Placed by ${leftName || rightName}`
                          : "No counterparty yet"
                      }
                    >
                      {leftName || rightName || "—"}
                    </span>
                  )}
                </span>
                <span
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold font-mono uppercase tracking-wider border ${badge.cls}`}
                >
                  <StatusIcon className="w-2.5 h-2.5" />
                  {badge.label}
                </span>
              </div>
              <span className="text-[9px] text-foreground/30 font-mono shrink-0 ml-auto">
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

            {/* Row 2: You Pay ⇄ You Receive — premium trading card */}
            <div className="relative mb-2 rounded-xl overflow-hidden backdrop-blur-sm">
              <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.05] via-foreground/[0.02] to-transparent" />
              <div
                className={`absolute inset-y-0 ${
                  right.isReceive ? "right-0" : "left-0"
                } w-1/2 bg-gradient-to-${
                  right.isReceive ? "l" : "r"
                } from-white/[0.04] via-white/[0.02] to-transparent`}
              />
              <div className="absolute inset-0 rounded-xl border border-foreground/[0.08]" />

              <div className="relative flex items-stretch">
                <div className="flex-1 px-3.5 py-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        left.isReceive ? "bg-white/[0.30]" : "bg-foreground/30"
                      }`}
                    />
                    <span
                      className={`text-[9px] font-bold font-mono tracking-[0.15em] ${
                        left.isReceive ? "text-[#f5f5f7]" : "text-foreground/50"
                      }`}
                    >
                      {left.label}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={`text-[17px] font-extrabold tabular-nums leading-none tracking-tight ${
                        left.isReceive ? "text-[#f5f5f7]" : "text-white"
                      }`}
                    >
                      {left.amount}
                    </span>
                    <span className="text-[10px] font-bold text-foreground/50 tracking-wide">
                      {left.currency}
                    </span>
                  </div>
                </div>

                <div className="flex items-center shrink-0">
                  <div className="w-px h-10 bg-gradient-to-b from-transparent via-foreground/[0.12] to-transparent" />
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-foreground/[0.08] to-background border border-foreground/[0.12] flex items-center justify-center -mx-4 shadow-black/20 z-10 backdrop-blur-sm">
                    <ArrowRightLeft
                      className="w-3 h-3 text-foreground/60"
                      strokeWidth={2.5}
                    />
                  </div>
                  <div className="w-px h-10 bg-gradient-to-b from-transparent via-foreground/[0.12] to-transparent" />
                </div>

                <div className="flex-1 px-3.5 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1.5 mb-1.5">
                    <span
                      className={`text-[9px] font-bold font-mono tracking-[0.15em] ${
                        right.isReceive
                          ? "text-[#f5f5f7]"
                          : "text-foreground/50"
                      }`}
                    >
                      {right.label}
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        right.isReceive ? "bg-white/[0.30]" : "bg-foreground/30"
                      }`}
                    />
                  </div>
                  <div className="flex items-baseline justify-end gap-1.5">
                    <span
                      className={`text-[17px] font-extrabold tabular-nums leading-none tracking-tight ${
                        right.isReceive ? "text-[#f5f5f7]" : "text-white"
                      }`}
                    >
                      {right.amount}
                    </span>
                    <span className="text-[10px] font-bold text-foreground/50 tracking-wide">
                      {right.currency}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 3: Rate + type */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-foreground/40 font-mono">
                @ {rate?.toFixed?.(2) ?? rate}
              </span>
              <span className="text-foreground/15 text-[10px]">·</span>
              <span className="text-[10px] text-foreground/40 font-mono uppercase">
                {db.type}
              </span>
            </div>

            {cancelReason && (
              <div className="mt-1.5 px-2 py-1 rounded bg-white/[0.06] border border-white/[0.1] text-[10px] text-foreground/50 font-mono">
                Reason: {cancelReason}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
});
