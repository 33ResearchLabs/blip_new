"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Clock, Check, TrendingUp, TrendingDown, X, Bell } from "lucide-react";
import { BottomNav } from "./BottomNav";
import { FilterDropdown, type FilterOption } from "./ui";
import type { Screen, Order } from "./types";

const CARD = "bg-surface-card border border-border-subtle";

// Status filter — matches OrderStatus union from types.ts plus "all" / "active".
// "active" = anything not in a terminal state (pending/payment/waiting).
type StatusFilter = "all" | "active" | "pending" | "payment" | "waiting" | "complete" | "cancelled" | "expired" | "disputed";

const STATUS_FILTER_OPTIONS: ReadonlyArray<FilterOption<StatusFilter>> = [
  { key: "all",       label: "All" },
  { key: "active",    label: "Active" },
  { key: "pending",   label: "Pending" },
  { key: "waiting",   label: "Escrow" },
  { key: "payment",   label: "Payment Sent" },
  { key: "complete",  label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "expired",   label: "Expired" },
  { key: "disputed",  label: "Disputed" },
];

type TimeFilter = "today" | "7d" | "30d" | "all";

const TIME_FILTER_OPTIONS: ReadonlyArray<FilterOption<TimeFilter>> = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "7 Days" },
  { key: "30d",   label: "30 Days" },
  { key: "all",   label: "All Time" },
];

export interface OrdersListScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  setActiveOrderId: (id: string) => void;
  activityTab: "active" | "completed" | "cancelled";
  setActivityTab: (t: "active" | "completed" | "cancelled") => void;
  pendingOrders: Order[];
  completedOrders: Order[];
  cancelledOrders: Order[];
  maxW: string;
  notificationCount?: number;
  hideBottomNav?: boolean;
}

export const OrdersListScreen = ({
  screen,
  setScreen,
  setActiveOrderId,
  pendingOrders,
  completedOrders,
  cancelledOrders,
  maxW,
  notificationCount = 0,
  hideBottomNav = false,
}: OrdersListScreenProps) => {
  // ── Filters ──
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("7d");

  // Combine all orders into one list — the dropdowns drive what's shown.
  const allOrders = useMemo(
    () => [...pendingOrders, ...completedOrders, ...cancelledOrders]
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
    [pendingOrders, completedOrders, cancelledOrders],
  );

  const filteredOrders = useMemo(() => {
    const now = Date.now();
    const cutoff =
      timeFilter === "today" ? now - 86400000 :
      timeFilter === "7d"    ? now - 7 * 86400000 :
      timeFilter === "30d"   ? now - 30 * 86400000 :
      0;

    return allOrders.filter(o => {
      // Time filter
      if (cutoff > 0) {
        const ts = o.createdAt?.getTime() ?? 0;
        if (ts < cutoff) return false;
      }
      // Status filter
      if (statusFilter === "all") return true;
      if (statusFilter === "active") {
        return o.status === "pending" || o.status === "payment" || o.status === "waiting";
      }
      return o.status === statusFilter;
    });
  }, [allOrders, statusFilter, timeFilter]);

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── */}
      <header className="px-5 pt-4 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">Activity</p>
          <button
            onClick={() => setScreen("notifications")}
            className="relative p-2.5 rounded-[14px] bg-surface-card border border-border-subtle"
          >
            <Bell size={18} className="text-text-tertiary" />
            {notificationCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4.5 h-4.5 rounded-full flex items-center justify-center bg-text-primary text-surface-base text-[9px] font-extrabold px-1">
                {notificationCount > 9 ? '9+' : notificationCount}
              </span>
            )}
          </button>
        </div>

        {/* Status + Time filter dropdowns */}
        <div className="flex items-center gap-2">
          <FilterDropdown
            ariaLabel="Status filter"
            align="left"
            value={statusFilter}
            onChange={setStatusFilter}
            options={STATUS_FILTER_OPTIONS}
          />
          <FilterDropdown
            className="ml-auto"
            ariaLabel="Time range filter"
            value={timeFilter}
            onChange={setTimeFilter}
            options={TIME_FILTER_OPTIONS}
          />
        </div>
      </header>

      {/* ── Unified List ── */}
      <div className="flex-1 px-5 pt-2 pb-28 overflow-y-auto scrollbar-hide">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className={`w-14 h-14 rounded-[18px] flex items-center justify-center mb-4 ${CARD}`}>
              <Clock size={22} className="text-text-quaternary" />
            </div>
            <p className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary mb-1.5">No orders found</p>
            <p className="text-[13px] font-medium text-text-tertiary">Try a different filter or time range</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredOrders.map((order, i) => {
              const isBuy = order.type === "buy";
              const isCompleted = order.status === "complete";
              const isCancelled = order.status === "cancelled" || order.status === "expired";
              const isDisputed = order.status === "disputed";
              const isActive = !isCompleted && !isCancelled && !isDisputed;

              const secs = isActive && order.expiresAt
                ? Math.max(0, Math.floor((order.expiresAt.getTime() - Date.now()) / 1000))
                : null;
              const timeStr = secs !== null
                ? `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, "0")}`
                : null;

              const iconWrap =
                isCompleted ? "bg-surface-active border border-border-subtle" :
                isCancelled || isDisputed ? "bg-surface-card border border-border-subtle" :
                "bg-surface-active border border-border-medium";

              const Icon =
                isCompleted ? Check :
                isCancelled || isDisputed ? X :
                isBuy ? TrendingUp : TrendingDown;
              const iconColor =
                isCompleted ? "text-text-tertiary" :
                isCancelled || isDisputed ? "text-text-quaternary" :
                "text-text-primary";

              const titleVerb =
                isCompleted ? (isBuy ? "Received" : "Sent") :
                isCancelled || isDisputed ? (isBuy ? "Buy" : "Sell") :
                isBuy ? "Receiving" : "Sending";

              const amountColor =
                isCancelled || isDisputed ? "text-text-tertiary" :
                "text-text-primary";

              const amountSign = isCompleted ? (isBuy ? "+" : "-") : isCancelled || isDisputed ? "" : (isBuy ? "+" : "-");

              const statusLabel =
                order.status === "complete"  ? "Done" :
                order.status === "cancelled" ? "Cancelled" :
                order.status === "expired"   ? "Expired" :
                order.status === "disputed"  ? "Disputed" :
                order.status === "pending"   ? "Pending" :
                order.status === "waiting"   ? "Escrow" :
                order.status === "payment"   ? "Payment Sent" :
                "Active";

              const statusBadgeClass =
                isCompleted ? "bg-surface-active text-text-tertiary" :
                isCancelled ? "bg-surface-card text-text-tertiary border border-border-subtle" :
                isDisputed  ? "bg-surface-card text-text-tertiary border border-border-subtle" :
                "bg-surface-active text-text-secondary";

              return (
                <motion.button key={order.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { setActiveOrderId(order.id); setScreen("order"); }}
                  className={`w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left ${CARD}`}>
                  <div className={`w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 ${iconWrap}`}>
                    <Icon size={17} className={iconColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em]">
                        {titleVerb} {parseFloat(order.cryptoAmount).toFixed(2)} USDT
                      </p>
                      <p className={`text-[14px] font-extrabold tracking-[-0.01em] ${amountColor}`}>
                        {amountSign}{order.fiatCode === "INR" ? "\u20B9" : order.fiatCode === "AED" ? "\u062F.\u0625" : order.fiatCode === "USD" ? "$" : order.fiatCode}{parseFloat(order.fiatAmount).toLocaleString("en-US")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[8px] font-extrabold tracking-[0.1em] uppercase px-[7px] py-0.5 rounded-full ${statusBadgeClass}`}>
                        {statusLabel}
                      </span>
                      {isActive && timeStr && (
                        <span className={`font-mono ${
                          secs !== null && secs < 60
                            ? 'text-[9px] font-extrabold text-text-primary'
                            : 'text-[9px] font-bold text-text-tertiary'
                        }`}>
                          {timeStr}
                        </span>
                      )}
                      {!isActive && order.createdAt && (
                        <span className="text-[10px] font-medium text-text-tertiary">
                          {order.createdAt.toLocaleDateString('en-GB')}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {!hideBottomNav && <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />}
    </div>
  );
};
