"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Receipt,
  Check,
  X,
  Clock,
} from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { formatFiat, formatCrypto } from "@/lib/format";
import { BottomNav } from "./BottomNav";
import { FilterDropdown, type FilterOption } from "./ui";
import type { Screen, Order } from "./types";

const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-secondary-strong uppercase";
const CARD_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-secondary uppercase";

// ── Filters ──────────────────────────────────────────────────────────────
type TimeFilter = "all" | "30d" | "7d" | "today";
type DirectionFilter = "all" | "in" | "out";
type StatusFilter = "all" | "complete" | "pending" | "cancelled" | "disputed";

const TIME_FILTER_OPTIONS: ReadonlyArray<FilterOption<TimeFilter>> = [
  { key: "all",   label: "All Time" },
  { key: "30d",   label: "30 Days" },
  { key: "7d",    label: "7 Days" },
  { key: "today", label: "Today" },
];

const DIRECTION_FILTER_OPTIONS: ReadonlyArray<FilterOption<DirectionFilter>> = [
  { key: "all", label: "All" },
  { key: "in",  label: "Money In" },
  { key: "out", label: "Money Out" },
];

const STATUS_FILTER_OPTIONS: ReadonlyArray<FilterOption<StatusFilter>> = [
  { key: "all",       label: "Any Status" },
  { key: "complete",  label: "Completed" },
  { key: "pending",   label: "In Progress" },
  { key: "cancelled", label: "Cancelled" },
  { key: "disputed",  label: "Disputed" },
];

// The Statement is a FIAT ledger. Direction is the mirror of the crypto side:
//   • SELL order → user sold USDT and RECEIVED fiat  → money IN  (+)
//   • BUY  order → user paid fiat to buy USDT        → money OUT (−)
const isMoneyIn = (o: Order) => o.type === "sell";

// The date a fiat movement effectively settled — completion time for finished
// orders, else creation time (best available for in-flight/cancelled ones).
const effectiveDate = (o: Order): Date => o.completedAt ?? o.createdAt;

// Collapse the DB status union into the coarse buckets the status filter uses.
const statusBucket = (o: Order): Exclude<StatusFilter, "all"> => {
  if (o.status === "complete") return "complete";
  if (o.status === "disputed") return "disputed";
  if (o.status === "cancelled" || o.status === "expired") return "cancelled";
  return "pending";
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  complete:  { label: "Completed",   className: "bg-surface-active text-text-secondary" },
  pending:   { label: "In Progress", className: "bg-surface-active text-text-tertiary" },
  cancelled: { label: "Cancelled",   className: "bg-surface-card text-text-tertiary border border-border-subtle" },
  disputed:  { label: "Disputed",    className: "bg-surface-card text-text-tertiary border border-border-subtle" },
};

interface CurrencyTotals {
  currency: string;
  received: number;
  sent: number;
  net: number;
  count: number;
}

export interface StatementScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  setActiveOrderId: (id: string) => void;
  orders: Order[];
  maxW: string;
  hideBottomNav?: boolean;
}

export const StatementScreen = ({
  screen,
  setScreen,
  setActiveOrderId,
  orders,
  maxW,
  hideBottomNav = false,
}: StatementScreenProps) => {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [currencyFilter, setCurrencyFilter] = useState<string>("all");

  // Distinct currencies the user has traded — drives the currency dropdown
  // (shown only when there's more than one) and the per-currency summary.
  const currencies = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => set.add(o.fiatCode || "—"));
    return [...set].sort();
  }, [orders]);

  const currencyOptions = useMemo<ReadonlyArray<FilterOption<string>>>(
    () => [{ key: "all", label: "All Coins" }, ...currencies.map((c) => ({ key: c, label: c }))],
    [currencies],
  );

  // ── Filtered, date-sorted list ──
  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff =
      timeFilter === "today" ? now - 86400000 :
      timeFilter === "7d"    ? now - 7 * 86400000 :
      timeFilter === "30d"   ? now - 30 * 86400000 :
      0;

    return orders
      .filter((o) => {
        if (cutoff > 0 && effectiveDate(o).getTime() < cutoff) return false;
        if (directionFilter === "in" && !isMoneyIn(o)) return false;
        if (directionFilter === "out" && isMoneyIn(o)) return false;
        if (statusFilter !== "all" && statusBucket(o) !== statusFilter) return false;
        if (currencyFilter !== "all" && (o.fiatCode || "—") !== currencyFilter) return false;
        return true;
      })
      .sort((a, b) => effectiveDate(b).getTime() - effectiveDate(a).getTime());
  }, [orders, timeFilter, directionFilter, statusFilter, currencyFilter]);

  // ── Per-currency summary — settled (completed) orders only, since pending
  // and cancelled orders never actually moved fiat. Respects every filter
  // except status (totals are inherently about completed money). ──
  const summary = useMemo<CurrencyTotals[]>(() => {
    const byCurrency = new Map<string, CurrencyTotals>();
    for (const o of filtered) {
      if (o.status !== "complete") continue;
      const currency = o.fiatCode || "—";
      const amount = parseFloat(o.fiatAmount) || 0;
      const t = byCurrency.get(currency) ?? { currency, received: 0, sent: 0, net: 0, count: 0 };
      if (isMoneyIn(o)) t.received += amount;
      else t.sent += amount;
      t.net = t.received - t.sent;
      t.count += 1;
      byCurrency.set(currency, t);
    }
    return [...byCurrency.values()].sort((a, b) => b.count - a.count);
  }, [filtered]);

  // ── Group the list by month for the ledger headings ──
  const groups = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of filtered) {
      const label = effectiveDate(o).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const bucket = map.get(label) ?? [];
      bucket.push(o);
      map.set(label, bucket);
    }
    return [...map.entries()];
  }, [filtered]);

  // ── CSV export — flat, spreadsheet-friendly ledger of the filtered rows. ──
  const handleExportCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["Date", "Order", "Type", "Direction", "Merchant", "Amount", "Currency", "Crypto", "Status"];
    const rows = filtered.map((o) => {
      const amount = parseFloat(o.fiatAmount) || 0;
      const signed = (isMoneyIn(o) ? amount : -amount).toFixed(2);
      return [
        effectiveDate(o).toISOString().slice(0, 10),
        o.order_number || o.id,
        o.type.toUpperCase(),
        isMoneyIn(o) ? "Received" : "Sent",
        o.merchant?.name || "—",
        signed,
        o.fiatCode || "",
        `${formatCrypto(o.cryptoAmount)} ${o.cryptoCode || "USDT"}`,
        STATUS_META[statusBucket(o)]?.label || o.status,
      ].map(esc).join(",");
    });
    const csv = [header.map(esc).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blip-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── */}
      <header className="px-5 pt-4 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={() => setScreen("profile")}
              aria-label="Back to profile"
              className="p-2 -ml-2 rounded-[12px] text-text-secondary hover:bg-surface-hover transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
            <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
              Statement
            </p>
          </div>
          <button
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            aria-label="Export statement as CSV"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[12px] bg-surface-card border border-border-subtle text-text-secondary text-[11px] font-bold tracking-[0.04em] uppercase disabled:opacity-40 hover:bg-surface-hover transition-colors"
          >
            <Download size={13} />
            Export
          </button>
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="flex-1 px-5 pt-1 pb-28 overflow-y-auto scrollbar-hide">

        {/* ── Per-currency summary ── */}
        {summary.length > 0 && (
          <div className="mb-4">
            <p className={`${SECTION_LABEL} mb-2`}>Summary</p>
            <div className="flex flex-col gap-2.5">
              {summary.map((t) => (
                <div key={t.currency} className={`rounded-[20px] overflow-hidden ${CARD}`}>
                  <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
                    <span className="text-[13px] font-bold tracking-[-0.01em] text-text-primary">{t.currency}</span>
                    <span className="text-[10px] font-semibold text-text-tertiary tabular-nums">
                      {t.count} settled trade{t.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 border-t border-border-subtle divide-x divide-border-subtle">
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <ArrowDownLeft size={12} className="text-success" />
                        <span className={CARD_LABEL}>Received</span>
                      </div>
                      <p className="text-[17px] font-bold tracking-[-0.02em] text-success tabular-nums leading-none">
                        {formatFiat(t.received, t.currency)}
                      </p>
                    </div>
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <ArrowUpRight size={12} className="text-text-tertiary" />
                        <span className={CARD_LABEL}>Sent</span>
                      </div>
                      <p className="text-[17px] font-bold tracking-[-0.02em] text-text-primary tabular-nums leading-none">
                        {formatFiat(t.sent, t.currency)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-subtle bg-surface-base">
                    <span className={CARD_LABEL}>Net</span>
                    <span className={`text-[14px] font-extrabold tracking-[-0.01em] tabular-nums ${t.net >= 0 ? "text-success" : "text-text-primary"}`}>
                      {t.net >= 0 ? "+" : "−"}{formatFiat(Math.abs(t.net), t.currency)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Filter toolbar ── */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <FilterDropdown ariaLabel="Time range" align="left" value={timeFilter} onChange={setTimeFilter} options={TIME_FILTER_OPTIONS} />
          <FilterDropdown ariaLabel="Direction" align="left" value={directionFilter} onChange={setDirectionFilter} options={DIRECTION_FILTER_OPTIONS} />
          <FilterDropdown ariaLabel="Status" align="left" value={statusFilter} onChange={setStatusFilter} options={STATUS_FILTER_OPTIONS} />
          {currencies.length > 1 && (
            <FilterDropdown ariaLabel="Currency" align="left" value={currencyFilter} onChange={setCurrencyFilter} options={currencyOptions} />
          )}
        </div>

        {/* ── Ledger ── */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className={`w-14 h-14 rounded-[18px] flex items-center justify-center mb-4 ${CARD}`}>
              <Receipt size={22} className="text-text-quaternary" />
            </div>
            <p className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary mb-1.5">No transactions</p>
            <p className="text-[13px] font-medium text-text-tertiary">Nothing matches these filters yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(([label, groupOrders]) => (
              <div key={label}>
                <p className={`${SECTION_LABEL} mb-2`}>{label}</p>
                <div className="flex flex-col gap-2">
                  {groupOrders.map((o, i) => {
                    const moneyIn = isMoneyIn(o);
                    const bucket = statusBucket(o);
                    const meta = STATUS_META[bucket];
                    const amount = parseFloat(o.fiatAmount) || 0;
                    const isTerminalCancel = bucket === "cancelled" || bucket === "disputed";
                    const BadgeIcon = o.status === "complete" ? Check : isTerminalCancel ? X : Clock;
                    const badgeBg =
                      isTerminalCancel ? "rgba(100,116,139,0.6)" :
                      o.status !== "complete" ? "rgba(100,116,139,0.85)" :
                      moneyIn ? "rgba(16,185,129,0.9)" : "rgba(100,116,139,0.85)";

                    return (
                      <motion.button
                        key={o.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.03, 0.2) }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => { setActiveOrderId(o.id); setScreen("order"); }}
                        className={`w-full flex items-center gap-3 rounded-[18px] p-3.5 text-left ${CARD}`}
                      >
                        <div className="relative shrink-0 w-11 h-11">
                          <UserAvatar
                            src={o.merchant?.avatarUrl}
                            seed={o.merchant?.name || o.merchant?.username}
                            size={44}
                            alt={(o.merchant?.name || "?")[0].toUpperCase()}
                            style={{ borderRadius: 14 }}
                          />
                          <span
                            className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                            style={{ background: badgeBg, backdropFilter: "blur(4px)" }}
                          >
                            <BadgeIcon size={10} strokeWidth={2.8} color="#fff" />
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5 gap-2">
                            <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em] truncate">
                              {o.merchant?.name || "Merchant"}
                            </p>
                            <p className={`text-[14px] font-extrabold tracking-[-0.01em] tabular-nums shrink-0 ${
                              isTerminalCancel ? "text-text-tertiary" : moneyIn ? "text-success" : "text-text-primary"
                            }`}>
                              {isTerminalCancel ? "" : moneyIn ? "+" : "−"}{formatFiat(amount, o.fiatCode)}
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`text-[8px] font-extrabold tracking-[0.1em] uppercase px-[7px] py-0.5 rounded-full shrink-0 ${meta?.className}`}>
                                {meta?.label}
                              </span>
                              <span className="text-[10px] font-medium text-text-tertiary truncate">
                                {formatCrypto(o.cryptoAmount)} {o.cryptoCode || "USDT"}
                              </span>
                            </div>
                            <span className="text-[10px] font-medium text-text-tertiary shrink-0 tabular-nums">
                              {effectiveDate(o).toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                            </span>
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!hideBottomNav && <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />}
    </div>
  );
};
