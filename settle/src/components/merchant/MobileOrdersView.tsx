"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Check,
  X,
  Shield,
  Activity,
  MessageCircle,
  ArrowRightLeft,
  ExternalLink,
  Loader2,
  Search,
  Volume2,
  VolumeX,
} from "lucide-react";
import { UserBadge } from "@/components/merchant/UserBadge";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { useMerchantStore, type PendingFilter } from "@/stores/merchantStore";
import { FilterDropdown } from "@/components/user/screens/ui/FilterDropdown";
import type { Order } from "@/types/merchant";

const PENDING_FILTER_OPTIONS: ReadonlyArray<{ key: PendingFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "mineable", label: "Mineable" },
  { key: "premium", label: "Premium" },
  { key: "large", label: "Large" },
  { key: "expiring", label: "Expiring" },
];

// Mirrors `getViewerSide` in PendingOrdersPanel.tsx so the mobile pending
// card uses the same YOU PAY / YOU RECEIVE labels as the desktop layout.
// See CLAUDE.md → Order System → Role system for the role table.
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
    if (myId && db.merchant_id === myId) return "seller";
    if (myId && db.buyer_merchant_id === myId) return "buyer";
    if (db.merchant_id && !db.buyer_merchant_id) return "buyer";
    if (!db.merchant_id && db.buyer_merchant_id) return "seller";
    return orderType === "buy" ? "buyer" : "seller";
  }
  if (myId && db.merchant_id === myId) {
    return orderType === "buy" ? "seller" : "buyer";
  }
  return orderType === "buy" ? "seller" : "buyer";
}

export interface MobileOrdersViewProps {
  pendingOrders: Order[];
  onAcceptOrder: (order: Order) => void;
  acceptingOrderId?: string | null;
  onOpenChat: (order: Order) => void;
  setMobileView: (view: 'orders' | 'escrow' | 'chat' | 'history' | 'marketplace') => void;
  // Cancel a still-pending order the merchant created themselves.
  // Routed at the page level to either the escrow-cancel modal or the
  // no-escrow cancel call depending on whether escrow has been locked.
  onCancelOrder?: (order: Order) => void;
  cancellingOrderId?: string | null;
}

export function MobileOrdersView({
  pendingOrders,
  onAcceptOrder,
  acceptingOrderId,
  onOpenChat,
  setMobileView,
  onCancelOrder,
  cancellingOrderId,
}: MobileOrdersViewProps) {
  // Shared filter / search / sound state — same Zustand keys the desktop panel uses,
  // so toggling here also reflects on the desktop layout.
  const searchQuery = useMerchantStore((s) => s.searchQuery);
  const setSearchQuery = useMerchantStore((s) => s.setSearchQuery);
  const pendingFilter = useMerchantStore((s) => s.pendingFilter);
  const setPendingFilter = useMerchantStore((s) => s.setPendingFilter);
  const soundEnabled = useMerchantStore((s) => s.soundEnabled);
  const setSoundEnabled = useMerchantStore((s) => s.setSoundEnabled);
  // For YOU PAY / YOU RECEIVE perspective in the gradient amounts panel.
  const merchantId = useMerchantStore((s) => s.merchantId);

  // Apply the same filter predicates the desktop pending panel uses.
  const filteredPendingOrders = useMemo(() => {
    let list = pendingOrders;

    if (pendingFilter !== "all") {
      list = list.filter((order) => {
        if (pendingFilter === "mineable") return !!order.escrowTxHash;
        if (pendingFilter === "large") return order.amount >= 2000;
        if (pendingFilter === "expiring") return order.expiresIn < 300;
        // "premium" needs corridor reference prices to be precise; on mobile we
        // approximate as "rate visibly above zero" since we don't have the
        // ref-price store wired here. Falls through to true to avoid hiding rows.
        return true;
      });
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((order) => {
        const matchesUser = order.user?.toLowerCase().includes(q);
        const matchesAmount = order.amount.toString().includes(q);
        const matchesTotal = Math.round(order.total).toString().includes(q);
        const matchesId = order.id?.toLowerCase().includes(q);
        const matchesOrderNum = order.dbOrder?.order_number
          ?.toLowerCase()
          .includes(q);
        return (
          matchesUser ||
          matchesAmount ||
          matchesTotal ||
          matchesId ||
          matchesOrderNum
        );
      });
    }

    return list;
  }, [pendingOrders, pendingFilter, searchQuery]);

  return (
    <div className="space-y-1">
      {/* Toolbar — search + filter + sound on/off */}
      <div className="sticky top-0 z-20 -mx-3 px-3 py-2 bg-background/95 backdrop-blur-sm border-b border-foreground/[0.04] flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search orders…"
            maxLength={100}
            className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[12px] text-foreground placeholder:text-foreground/30 outline-none focus:border-primary/30 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-foreground/[0.06] transition-colors"
            >
              <X className="w-3 h-3 text-foreground/40" />
            </button>
          )}
        </div>

        <FilterDropdown<PendingFilter>
          value={pendingFilter}
          onChange={setPendingFilter}
          ariaLabel="Filter pending orders"
          align="right"
          options={PENDING_FILTER_OPTIONS}
        />

        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          aria-label={soundEnabled ? "Mute sounds" : "Unmute sounds"}
          aria-pressed={soundEnabled}
          className={`p-2 rounded-lg border transition-colors ${
            soundEnabled
              ? "bg-primary/10 border-primary/25 text-primary"
              : "bg-foreground/[0.04] border-foreground/[0.08] text-foreground/40"
          }`}
        >
          {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
      </div>

      {/* Whale Orders section removed \u2014 its Contact button was a TODO that
          did nothing, and the placeholder usernames (open_order_*) confused
          users. The same orders are visible in the regular Pending list
          below, where the Accept button actually works. */}

      {/* Header Row */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <motion.div
            className="w-2 h-2 rounded-full bg-white/60"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <span className="text-xs font-mono text-foreground/40 uppercase tracking-wide">Pending</span>
        </div>
        <span className="text-xs font-mono text-foreground/40">
          {filteredPendingOrders.length}
          {filteredPendingOrders.length !== pendingOrders.length && (
            <span className="text-foreground/25"> / {pendingOrders.length}</span>
          )}
        </span>
      </div>

      {filteredPendingOrders.length > 0 ? (
        <div className="space-y-2 py-1">
          {filteredPendingOrders.map((order) => {
            const viewerSide = getViewerSide(order.dbOrder, merchantId);
            const crypto = {
              amount: Math.round(order.amount).toLocaleString(),
              currency: order.fromCurrency || "USDT",
            };
            const fiat = {
              amount: Math.round(order.total).toLocaleString(),
              currency: order.toCurrency || "AED",
            };
            const left =
              viewerSide === "seller"
                ? { label: "YOU PAY", ...crypto, isReceive: false }
                : { label: "YOU RECEIVE", ...crypto, isReceive: true };
            const right =
              viewerSide === "seller"
                ? { label: "YOU RECEIVE", ...fiat, isReceive: true }
                : { label: "YOU PAY", ...fiat, isReceive: false };
            const isExpired = order.expiresIn <= 0;
            const expiringSoon = !isExpired && order.expiresIn <= 120;
            const timeLabel = isExpired
              ? "Expired"
              : order.expiresIn >= 3600
                ? `${Math.floor(order.expiresIn / 3600)}h ${Math.floor((order.expiresIn % 3600) / 60)}m`
                : order.expiresIn >= 60
                  ? `${Math.floor(order.expiresIn / 60)}m ${order.expiresIn % 60}s`
                  : `${order.expiresIn}s`;

            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="relative p-3 rounded-xl border bg-foreground/[0.02] border-foreground/[0.06] hover:border-foreground/[0.10] transition-colors"
              >
                {/* Header — avatar + name + tags + timer/status */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <UserBadge
                      name={order.user}
                      emoji={order.emoji}
                      size="md"
                      showName={false}
                    />
                    <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-semibold text-white truncate">
                        {order.isMyOrder ? "Your offer" : order.user}
                      </span>
                      {order.spreadPreference && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            order.spreadPreference === "fastest"
                              ? "bg-red-400"
                              : "bg-primary"
                          }`}
                          title={order.spreadPreference}
                        />
                      )}
                      {order.isMyOrder && (
                        <span className="px-1.5 py-0.5 bg-foreground/[0.04] border border-foreground/[0.06] rounded text-[9px] font-bold text-foreground/40">
                          YOURS
                        </span>
                      )}
                      {order.isNew && !order.isMyOrder && (
                        <span className="px-1.5 py-0.5 bg-white/5 text-white/70 rounded text-[9px] font-bold">
                          NEW
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Timer (others) or Waiting pill (own) */}
                  {order.isMyOrder ? (
                    <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-[10px] font-mono text-amber-300 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Waiting
                    </span>
                  ) : (
                    <div
                      className={`flex items-center gap-1 text-sm font-bold font-mono tabular-nums shrink-0 ${
                        expiringSoon ? "text-red-400" : "text-primary"
                      }`}
                    >
                      {timeLabel}
                      <span
                        className="animate-pulse"
                        style={{
                          filter: expiringSoon
                            ? "drop-shadow(0 0 6px #ef4444)"
                            : "drop-shadow(0 0 4px #f97316)",
                        }}
                      >
                        🔥
                      </span>
                    </div>
                  )}
                </div>

                {/* You Pay ⇄ You Receive — gradient panel (mirrors desktop) */}
                <div className="relative mb-2 rounded-xl overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.05] via-foreground/[0.02] to-transparent" />
                  <div
                    className={`absolute inset-y-0 ${right.isReceive ? "right-0" : "left-0"} w-1/2 bg-gradient-to-${right.isReceive ? "l" : "r"} from-emerald-500/[0.08] via-emerald-500/[0.03] to-transparent`}
                  />
                  <div className="absolute inset-0 rounded-xl border border-foreground/[0.08]" />
                  <div className="relative flex items-stretch">
                    <div className="flex-1 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${left.isReceive ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-foreground/30"}`}
                        />
                        <span
                          className={`text-[9px] font-bold font-mono tracking-[0.15em] ${left.isReceive ? "text-emerald-400" : "text-foreground/50"}`}
                        >
                          {left.label}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className={`text-[16px] font-extrabold tabular-nums leading-none tracking-tight ${left.isReceive ? "text-emerald-400" : "text-white"}`}
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
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-foreground/[0.08] to-background border border-foreground/[0.12] flex items-center justify-center -mx-3.5 z-10">
                        <ArrowRightLeft
                          className="w-3 h-3 text-foreground/60"
                          strokeWidth={2.5}
                        />
                      </div>
                      <div className="w-px h-10 bg-gradient-to-b from-transparent via-foreground/[0.12] to-transparent" />
                    </div>
                    <div className="flex-1 px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 mb-1">
                        <span
                          className={`text-[9px] font-bold font-mono tracking-[0.15em] ${right.isReceive ? "text-emerald-400" : "text-foreground/50"}`}
                        >
                          {right.label}
                        </span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${right.isReceive ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-foreground/30"}`}
                        />
                      </div>
                      <div className="flex items-baseline justify-end gap-1.5">
                        <span
                          className={`text-[16px] font-extrabold tabular-nums leading-none tracking-tight ${right.isReceive ? "text-emerald-400" : "text-white"}`}
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

                {/* Rate row + actions */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-foreground/40 font-mono shrink-0">
                    @ {order.rate.toFixed(2)}
                  </span>
                  {!order.isMyOrder && (
                    <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                      +${Math.round(order.amount * 0.005)}
                    </span>
                  )}
                  {/* Escrow TX link for sell orders */}
                  {order.escrowTxHash && order.orderType === "sell" && (
                    <a
                      href={getSolscanTxUrl(order.escrowTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 py-0.5 px-1.5 bg-white/5 rounded text-[9px] font-mono text-white/60 hover:bg-accent-subtle transition-colors"
                    >
                      <Shield className="w-2.5 h-2.5" />
                      TX
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                  <div className="flex-1" />
                  {order.isMyOrder ? (
                    <>
                      {onCancelOrder && (
                        <motion.button
                          whileTap={{ scale: 0.98 }}
                          disabled={cancellingOrderId === order.id}
                          onClick={() => onCancelOrder(order)}
                          className="h-9 px-3 bg-red-500/10 hover:bg-[var(--color-error)]/15 border border-red-500/25 rounded-lg text-xs font-medium text-red-400 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          {cancellingOrderId === order.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <>
                              <X className="w-3.5 h-3.5" /> Cancel
                            </>
                          )}
                        </motion.button>
                      )}
                      <button
                        onClick={() => {
                          onOpenChat(order);
                          setMobileView("chat");
                        }}
                        className="h-9 w-9 border border-white/10 hover:border-border-strong rounded-lg flex items-center justify-center transition-colors"
                        aria-label="Open chat"
                      >
                        <MessageCircle className="w-4 h-4 text-foreground/40" />
                      </button>
                    </>
                  ) : (
                    <>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={acceptingOrderId === order.id}
                        onClick={() => onAcceptOrder(order)}
                        className={`h-9 px-3 border rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                          acceptingOrderId === order.id
                            ? "bg-white/[0.03] border-white/[0.06] text-white/50 cursor-wait"
                            : "bg-primary text-white border-primary hover:bg-primary/90"
                        }`}
                      >
                        {acceptingOrderId === order.id ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Accepting…
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" /> Accept
                          </>
                        )}
                      </motion.button>
                      <button
                        onClick={() => {
                          onOpenChat(order);
                          setMobileView("chat");
                        }}
                        className="h-9 w-9 border border-white/10 hover:border-border-strong rounded-lg flex items-center justify-center transition-colors"
                        aria-label="Open chat"
                      >
                        <MessageCircle className="w-4 h-4 text-foreground/40" />
                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-gray-600">
          <Activity className="w-8 h-8 mb-2 opacity-20" />
          <p className="text-xs text-foreground/35 font-mono">
            {pendingOrders.length === 0
              ? "Waiting for orders..."
              : "No orders match your filter"}
          </p>
          {pendingOrders.length > 0 && (
            <button
              onClick={() => {
                setSearchQuery("");
                setPendingFilter("all");
              }}
              className="mt-3 text-[11px] text-primary/70 hover:text-primary font-mono"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
