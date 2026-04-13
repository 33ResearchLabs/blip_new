"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

interface LedgerEntry {
  id: string;
  entry_type: string;
  amount: number;
  asset: string;
  related_order_id: string | null;
  related_tx_hash: string | null;
  description: string | null;
  order_number: string | null;
  order_type: "buy" | "sell" | null;
  order_status: string | null;
  counterparty_name: string | null;
  created_at: string;
}

interface TransactionsTabProps {
  merchantId: string;
  /** Bump this counter from the parent (e.g. when the user clicks the
   * Activity panel's refresh button) to trigger a refetch. */
  refreshKey?: number;
  /** Called when the user clicks on a transaction row to view order details. */
  onSelectOrder?: (orderId: string) => void;
}

// ─── Pure helpers (live outside the component) ────────────────────────

type DerivedStatus = "completed" | "pending" | "failed" | "cancelled";

/** Resolve the UI status badge for a ledger row.
 *
 * The badge MUST reflect the underlying ORDER's status, not the ledger
 * entry_type. A row like ESCROW_LOCK is a settled accounting event — by
 * itself it always "happened" — but the badge should still say "Completed"
 * if the order ultimately completed (or "Failed" if it was cancelled,
 * "Pending" if the order is still in flight). For non-trade ledger rows
 * with no linked order, fall back to the entry_type heuristic.
 */
function deriveStatus(entry: LedgerEntry): DerivedStatus {
  // Prefer the order's authoritative status when present
  const os = (entry.order_status || "").toLowerCase();
  if (os) {
    if (os === "completed") return "completed";
    if (os === "cancelled" || os === "expired") return "cancelled";
    if (os === "disputed") return "failed";
    // pending / escrowed / accepted / payment_sent / payment_pending / payment_confirmed / releasing
    return "pending";
  }
  // No linked order — fall back to entry_type heuristic for things like
  // standalone DEPOSIT / WITHDRAWAL / ADJUSTMENT rows.
  const t = (entry.entry_type || "").toUpperCase();
  if (t.includes("FAIL") || t.includes("REFUND") || t.includes("CANCEL") || t.includes("REVERSAL")) return "failed";
  if (t.includes("HOLD") || t.includes("PENDING")) return "pending";
  return "completed";
}

/** Day bucket label: "Today" / "Yesterday" / "Apr 7" / "Apr 7, 2025". */
function getDayLabel(date: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const dayStart = startOfDay(date);
  const dayMs = 24 * 60 * 60 * 1000;
  if (dayStart === today) return "Today";
  if (dayStart === today - dayMs) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}

/** "now" / "5m ago" / "3h ago" / "Apr 9, 02:30 PM". */
function formatTimestamp(iso: string, now: Date): string {
  const d = new Date(iso);
  const diffMs = now.getTime() - d.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_BADGE: Record<DerivedStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", Icon: CheckCircle2 },
  pending:   { label: "Pending",   cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",       Icon: Clock },
  failed:    { label: "Failed",    cls: "bg-[var(--color-error)]/10 text-[var(--color-error)] border-[var(--color-error)]/20", Icon: XCircle },
  cancelled: { label: "Cancelled", cls: "bg-foreground/5 text-foreground/40 border-foreground/10", Icon: XCircle },
};

export function TransactionsTab({ merchantId, refreshKey = 0, onSelectOrder }: TransactionsTabProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Re-render every 60s so relative timestamps stay fresh without refetching.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const nextCursorRef = useRef<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const fetchLedger = async () => {
    try {
      setIsLoading(true);
      const res = await fetchWithAuth(
        `/api/ledger?merchant_id=${merchantId}&limit=10`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setEntries(data.data.entries || []);
          if (data.data.pagination) {
            nextCursorRef.current = data.data.pagination.next_cursor;
            setHasMore(data.data.pagination.has_more);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch ledger:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursorRef.current || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await fetchWithAuth(
        `/api/ledger?merchant_id=${merchantId}&limit=10&cursor=${encodeURIComponent(nextCursorRef.current)}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data.entries?.length > 0) {
          setEntries(prev => [...prev, ...data.data.entries]);
          if (data.data.pagination) {
            nextCursorRef.current = data.data.pagination.next_cursor;
            setHasMore(data.data.pagination.has_more);
          }
        } else {
          setHasMore(false);
        }
      }
    } catch {}
    finally { setIsLoadingMore(false); }
  };

  // Initial fetch + parent-triggered refetch
  useEffect(() => {
    fetchLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, refreshKey]);

  const visibleEntries = useMemo(
    () => entries.filter((e) => e.entry_type !== "FEE" && e.entry_type !== "FEE_EARNING"),
    [entries],
  );

  // Group entries by day-bucket label, preserving sort order.
  const grouped = useMemo(() => {
    const now = new Date();
    const groups: { label: string; items: LedgerEntry[] }[] = [];
    let currentLabel = "";
    for (const e of visibleEntries) {
      const label = getDayLabel(new Date(e.created_at), now);
      if (label !== currentLabel) {
        groups.push({ label, items: [] });
        currentLabel = label;
      }
      groups[groups.length - 1].items.push(e);
    }
    return groups;
    // tick is intentionally a dep so day buckets re-evaluate around midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEntries, tick]);

  return (
    <div className="flex flex-col h-full">
      {/* Ledger List (mini-header removed — refresh lives in the parent
          ActivityPanel header next to the Txns dropdown) */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && entries.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-4 h-4 text-primary/40 animate-spin" />
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5 text-foreground/20" />
            </div>
            <div className="text-center">
              <p className="text-[11px] font-medium text-foreground/40 mb-0.5">
                No transactions yet
              </p>
              <p className="text-[9px] text-foreground/25 font-mono">
                Ledger entries appear after your first trade
              </p>
            </div>
          </div>
        ) : (
          <div className="px-1.5 py-1">
            {grouped.map((group) => (
              <div key={group.label} className="mb-1">
                {/* Sticky day header */}
                <div className="sticky top-0 z-[1] px-2 py-1 bg-background/95 backdrop-blur-sm">
                  <span className="text-[9px] font-bold font-mono text-foreground/40 uppercase tracking-wider">
                    {group.label}
                  </span>
                </div>

                <div className="space-y-1">
                  {group.items.map((entry) => {
                    const isCancelledEntry = entry.entry_type === "ORDER_CANCELLED";
                    const isIncoming = isCancelledEntry ? false : entry.amount >= 0;
                    const status = deriveStatus(entry);
                    const badge = STATUS_BADGE[status];
                    const StatusIcon = badge.Icon;
                    const asset = entry.asset || "USDT";
                    const orderType = entry.order_type;
                    const absAmount = Math.abs(Number(entry.amount)).toFixed(2);

                    // Cancelled orders
                    if (isCancelledEntry) {
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center gap-2.5 px-2 py-2.5 rounded-lg hover:bg-foreground/[0.04] transition-colors cursor-pointer"
                          onClick={() => entry.related_order_id && onSelectOrder?.(entry.related_order_id)}
                        >
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border bg-foreground/5 border-foreground/10">
                            <XCircle className="w-3.5 h-3.5 text-foreground/30" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-foreground/50">Order Cancelled</p>
                            <p className="text-[10px] text-foreground/30 font-mono truncate">
                              {entry.order_number ? `#${entry.order_number}` : ''}{entry.counterparty_name ? ` · ${entry.counterparty_name}` : ''}
                            </p>
                          </div>
                          <span className="text-[12px] font-mono text-foreground/35 tabular-nums shrink-0">
                            {absAmount} {asset}
                          </span>
                        </div>
                      );
                    }

                    // Trade entries: show You Got / You Paid
                    // Merchant perspective: buy order = merchant sold, sell order = merchant bought
                    const merchantSold = orderType === "buy";
                    const gotLabel = merchantSold ? "Got" : "Got";
                    const paidLabel = merchantSold ? "Paid" : "Paid";
                    const cryptoAmount = absAmount;

                    return (
                      <div
                        key={entry.id}
                        className="flex items-start gap-2.5 px-2 py-2.5 rounded-lg hover:bg-foreground/[0.04] transition-colors cursor-pointer"
                        onClick={() => entry.related_order_id && onSelectOrder?.(entry.related_order_id)}
                      >
                        {/* Direction icon */}
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
                            isIncoming
                              ? "bg-[var(--color-success)]/10 border-[var(--color-success)]/20"
                              : "bg-[var(--color-error)]/10 border-[var(--color-error)]/20"
                          }`}
                        >
                          {isIncoming ? (
                            <ArrowDownRight className="w-3.5 h-3.5 text-[var(--color-success)]" />
                          ) : (
                            <ArrowUpRight className="w-3.5 h-3.5 text-[var(--color-error)]" />
                          )}
                        </div>

                        {/* Body */}
                        <div className="flex-1 min-w-0">
                          {/* Row 1: Got/Paid label + amount on right */}
                          <div className="flex items-baseline justify-between gap-2 mb-0.5">
                            <span className="text-[12px] font-semibold text-foreground/85 truncate">
                              {isIncoming ? (
                                <><span className="text-[var(--color-success)]">{gotLabel}</span> {cryptoAmount} {asset}</>
                              ) : (
                                <><span className="text-[var(--color-error)]">{paidLabel}</span> {cryptoAmount} {asset}</>
                              )}
                            </span>
                            <span
                              className={`text-[12px] font-bold font-mono tabular-nums shrink-0 ${
                                isIncoming ? "text-[var(--color-success)]" : "text-[var(--color-error)]"
                              }`}
                            >
                              {isIncoming ? "+" : ""}{Number(entry.amount).toFixed(2)}
                            </span>
                          </div>

                          {/* Row 2: status dot · order # · counterparty · time */}
                          <div className="flex items-center gap-1 text-[10px] text-foreground/35 font-mono truncate">
                            <StatusIcon className={`w-2.5 h-2.5 shrink-0 ${
                              status === 'completed' ? 'text-[var(--color-success)]'
                              : status === 'failed' || status === 'cancelled' ? 'text-[var(--color-error)]'
                              : 'text-foreground/30'
                            }`} />
                            <span className={`shrink-0 ${
                              status === 'completed' ? 'text-[var(--color-success)]'
                              : status === 'failed' || status === 'cancelled' ? 'text-[var(--color-error)]'
                              : 'text-foreground/40'
                            }`}>{badge.label}</span>
                            {entry.order_number && <span>· #{entry.order_number}</span>}
                            {entry.counterparty_name && <span>· {entry.counterparty_name}</span>}
                            <span>· {formatTimestamp(entry.created_at, new Date())}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Load More */}
            {hasMore && (
              <button
                onClick={loadMore}
                disabled={isLoadingMore}
                className="w-full py-2.5 mt-1 rounded-lg text-[10px] font-bold text-foreground/40 hover:text-foreground/60 hover:bg-foreground/[0.04] transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isLoadingMore ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  'Load More'
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
