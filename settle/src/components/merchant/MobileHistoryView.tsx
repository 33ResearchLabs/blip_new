"use client";

import { useMemo } from "react";
import {
  Check,
  X,
  Shield,
  Activity,
  TrendingUp,
  ExternalLink,
  LogOut,
  Wallet,
  Star,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { UserBadge } from "@/components/merchant/UserBadge";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { formatCrypto, formatFiat } from "@/lib/format";
import type { Order } from "@/types/merchant";

/* ── Design tokens ── */
const T = {
  bg: "#08080a",
  text: "#f5f5f7",
  muted: "#86868b",
  muted2: "#aeaeb2",
  faint: "#5a5a60",
  hair: "rgba(255,255,255,0.09)",
  glass: "rgba(255,255,255,0.055)",
  mint: "#b8e9d4",
};

/* ── Inline SVGs matching design reference ── */
const HI = {
  check: (s = 15) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  ),
  x: (s = 15) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  activity: (s = 15) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l2.5 7 5-15L17 12h4" />
    </svg>
  ),
  up: (s = 11) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 15l7-7 7 7" />
    </svg>
  ),
  buy: (s = 18) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7h10v10M17 7 7 17" />
    </svg>
  ),
  sell: (s = 18) => (
    <svg viewBox="0 0 24 24" width={s} height={s} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 17H7V7M7 17 17 7" />
    </svg>
  ),
};

/* ── Shared tab strip (3-tab sliding thumb) ── */
function HistTabs({ tab, setTab }: { tab: number; setTab: (t: number) => void }) {
  const tabs = [
    { icon: HI.check(14), label: "Complete" },
    { icon: HI.x(14), label: "Cancelled" },
  ];
  return (
    <div style={{ position: "relative", display: "flex", background: T.glass, border: `1px solid ${T.hair}`, borderRadius: 12, padding: 3, width: "100%" }}>
      <div style={{
        position: "absolute", top: 3, bottom: 3,
        borderRadius: 11,
        background: "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.14)",
        transition: "left 0.22s cubic-bezier(0.22,1,0.36,1), width 0.22s",
        left: `calc(${tab} * (100% - 6px) / 2 + 3px)`,
        width: "calc((100% - 6px) / 2)",
        pointerEvents: "none",
      }} />
      {tabs.map(({ icon, label }, i) => (
        <button
          key={label}
          onClick={() => setTab(i)}
          style={{
            flex: 1, position: "relative", zIndex: 1,
            padding: "7px 0", fontSize: 13, fontWeight: 700,
            color: tab === i ? T.text : T.muted,
            background: "none", border: "none", cursor: "pointer",
            borderRadius: 11, transition: "color 0.2s",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          {icon} {label}
        </button>
      ))}
    </div>
  );
}

/* ── Empty state ── */
function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div style={{ textAlign: "center", paddingTop: 80 }}>
      <div style={{ width: 64, height: 64, borderRadius: 22, background: T.glass, border: `1px solid ${T.hair}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: T.muted }}>
        {icon}
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>{title}</div>
      <div style={{ color: T.muted, fontSize: 13, fontWeight: 500, marginTop: 5, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

/* ── Single transaction row ── */
function TxnRow({ order, merchantId, onSelectOrder, showBorder }: {
  order: Order; merchantId: string | null;
  onSelectOrder?: (o: Order) => void;
  showBorder: boolean;
}) {
  const isM2M = order.isM2M || !!order.buyerMerchantId;
  const isSell = isM2M
    ? order.buyerMerchantId === merchantId   // M2M: seller = merchant_id slot
      ? false                                // they are buyer → they "sent"
      : true
    : order.dbOrder?.type === "sell";
  const fiatCur = (order as any).toCurrency || "INR";
  const fiatAmt = (order as any).total ?? order.amount;
  const fiatLabel = formatFiat(Math.round(fiatAmt), fiatCur).replace(/\.00$/, "");
  // Only compute earnings from the REAL fee % and rate; never fabricate them.
  const earningFiat = ((order as any).protocolFeePercent != null && ((order as any).rate || 0) > 0)
    ? order.amount * (order as any).protocolFeePercent / 100 * (order as any).rate
    : 0;
  const earnLabel = earningFiat > 0
    ? `+${formatFiat(earningFiat, fiatCur).replace(/\.?0+$/, "")}`
    : null;
  const pmType = (order as any).lockedPaymentMethod?.type || order.dbOrder?.payment_method;
  const pmLabel = (order as any).lockedPaymentMethod?.label ||
    (pmType === "upi" ? "UPI" : pmType === "bank" ? "Bank Transfer" : pmType === "cash" ? "Cash" : pmType ?? null);
  const timeStr = order.timestamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <div
      onClick={() => onSelectOrder?.(order)}
      role={onSelectOrder ? "button" : undefined}
      tabIndex={onSelectOrder ? 0 : undefined}
      onKeyDown={
        onSelectOrder
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectOrder(order);
              }
            }
          : undefined
      }
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "11px 12px",
        cursor: onSelectOrder ? "pointer" : "default",
        borderTop: showBorder ? `1px solid ${T.hair}` : undefined,
      }}
    >
      {/* Icon disc */}
      <span style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.05)", border: `1px solid ${T.hair}`, color: T.muted2 }}>
        {isSell ? HI.sell() : HI.buy()}
      </span>

      {/* Text columns */}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {/* Row 1: action + fiat amount */}
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, color: T.text, whiteSpace: "nowrap" }}>
            {isSell ? "Sold" : "Bought"} {order.amount} USDT
          </span>
          <span style={{ fontWeight: 800, fontSize: 14.5, color: T.text, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {isSell ? "+" : "−"}{fiatLabel}
          </span>
        </span>
        {/* Row 2: counterparty info + earnings */}
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ color: T.muted, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {order.user}{pmLabel ? ` · ${pmLabel}` : ""} · {timeStr}
          </span>
          {earnLabel && (
            <span style={{ color: T.mint, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
              {earnLabel}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

/* ── Cancelled order row ── */
function CancelledRow({ order, onSelectOrder, showBorder }: {
  order: Order; onSelectOrder?: (o: Order) => void; showBorder: boolean;
}) {
  const fiatCur = (order as any).toCurrency || "INR";
  const fiatAmt = (order as any).total ?? order.amount;
  const fiatLabel = formatFiat(Math.round(fiatAmt), fiatCur).replace(/\.00$/, "");
  const timeStr = order.timestamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const isDisputed = order.status === "disputed";

  return (
    <div
      onClick={() => onSelectOrder?.(order)}
      role={onSelectOrder ? "button" : undefined}
      tabIndex={onSelectOrder ? 0 : undefined}
      onKeyDown={
        onSelectOrder
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelectOrder(order);
              }
            }
          : undefined
      }
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "11px 12px",
        cursor: onSelectOrder ? "pointer" : "default",
        borderTop: showBorder ? `1px solid ${T.hair}` : undefined,
      }}
    >
      <span style={{ width: 40, height: 40, borderRadius: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,77,79,0.07)", border: "1px solid rgba(255,77,79,0.2)", color: "#ff4d4f" }}>
        {HI.x(18)}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 14.5, color: T.text, whiteSpace: "nowrap" }}>
            {order.amount} USDT
          </span>
          <span style={{ fontWeight: 800, fontSize: 14.5, color: "rgba(255,255,255,0.35)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {fiatLabel}
          </span>
        </span>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ color: T.muted, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {order.user} · {timeStr}
          </span>
          <span style={{ color: isDisputed ? "#ffb020" : "#ff4d4f", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>
            {isDisputed ? "Disputed" : "Cancelled"}
          </span>
        </span>
      </span>
    </div>
  );
}

/* ── Stats tab ── */
function StatTab({ completedOrders, totalTradedVolume, todayEarnings, pendingEarnings, effectiveBalance, merchantInfo, merchantId, onShowAnalytics, onShowWalletModal, onLogout }: {
  completedOrders: Order[];
  totalTradedVolume: number;
  todayEarnings: number;
  pendingEarnings: number;
  effectiveBalance: number | null;
  merchantInfo: any;
  merchantId: string | null;
  onShowAnalytics: () => void;
  onShowWalletModal: () => void;
  onLogout: () => void;
}) {
  // Build a simple 7-bar weekly chart from last 7 days of completed orders
  const bars = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d.toDateString();
    });
    const counts = days.map(day =>
      completedOrders.filter(o => o.timestamp.toDateString() === day).length
    );
    const max = Math.max(...counts, 1);
    return counts.map(c => Math.round((c / max) * 100));
  }, [completedOrders]);

  const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
  // Map today's weekday (0=Sun→6) to bar index
  const todayIdx = (new Date().getDay() + 6) % 7; // Mon=0

  const statCards = [
    { label: "Trades", value: String(completedOrders.length) },
    { label: "Earned", value: todayEarnings > 0 ? `+${formatCrypto(todayEarnings)}` : "—" },
    { label: "Pending", value: pendingEarnings > 0 ? `+${formatCrypto(pendingEarnings)}` : "—" },
    { label: "Volume", value: formatCrypto(totalTradedVolume) },
  ];

  return (
    <div>
      {/* Volume hero */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: T.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Volume · all time</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginTop: 5 }}>
          <span style={{ fontSize: 38, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", color: T.text }}>
            {formatCrypto(totalTradedVolume)}
          </span>
          <span style={{ color: T.muted, fontSize: 14, fontWeight: 600, marginBottom: 7 }}>USDT</span>
        </div>
      </div>

      {/* Weekly bar chart */}
      <div style={{ background: T.glass, border: `1px solid ${T.hair}`, borderRadius: 18, padding: "16px 16px 12px", marginBottom: 14, backdropFilter: "blur(20px)" }}>
        <div style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>This week</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80 }}>
          {bars.map((h, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{
                width: "100%",
                height: `${Math.max(h * 0.68, 4)}px`,
                borderRadius: 5,
                background: i === todayIdx ? T.mint : "rgba(255,255,255,0.14)",
                transition: "height 0.4s cubic-bezier(0.22,1,0.36,1)",
              }} />
              <span style={{ color: i === todayIdx ? T.mint : T.faint, fontSize: 9.5, fontWeight: 700 }}>
                {DAY_LABELS[i]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 2×2 stat grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {statCards.map(({ label, value }) => (
          <div key={label} style={{ background: T.glass, border: `1px solid ${T.hair}`, borderRadius: 18, padding: "13px 15px", backdropFilter: "blur(20px)" }}>
            <div style={{ color: T.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6, fontVariantNumeric: "tabular-nums", color: T.text }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Wallet balance */}
      <button
        onClick={onShowWalletModal}
        style={{ width: "100%", textAlign: "left", padding: "14px 16px", borderRadius: 18, background: "rgba(184,233,212,0.06)", border: "1px solid rgba(184,233,212,0.18)", cursor: "pointer", marginBottom: 10, boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: T.muted, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Wallet Balance</span>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke={T.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6"/></svg>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", color: T.text }}>
            {effectiveBalance !== null ? formatCrypto(effectiveBalance) : "—"}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.muted }}>USDT</span>
        </div>
      </button>

      {/* Account section */}
      <div style={{ marginTop: 8 }}>
        <div style={{ color: T.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Account</div>
        <div style={{ background: T.glass, border: `1px solid ${T.hair}`, borderRadius: 18, overflow: "hidden", backdropFilter: "blur(20px)" }}>
          {/* Profile row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: `1px solid ${T.hair}` }}>
            <UserBadge
              name={merchantInfo?.username || merchantInfo?.display_name || "Merchant"}
              avatarUrl={merchantInfo?.avatar_url}
              merchantId={merchantId || undefined}
              size="lg"
              showName={false}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {merchantInfo?.username || merchantInfo?.display_name || "Merchant"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, color: T.muted, fontSize: 12 }}>
                <Star style={{ width: 12, height: 12, fill: "#ffb020", color: "#ffb020" }} />
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{merchantInfo?.rating?.toFixed(2) || "5.00"}</span>
                <span style={{ color: T.faint }}>·</span>
                <span>{merchantInfo?.total_trades || 0} trades</span>
              </div>
            </div>
          </div>

          {/* Settings link */}
          <Link
            href="/market/settings"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", textDecoration: "none", borderBottom: `1px solid ${T.hair}` }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: T.muted2 }}>Settings & Profile</span>
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke={T.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6"/></svg>
          </Link>

          {/* Public profile */}
          {merchantId && (
            <Link
              href={`/market/profile/${merchantId}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", textDecoration: "none", borderBottom: `1px solid ${T.hair}` }}
            >
              <span style={{ fontWeight: 600, fontSize: 14, color: T.muted2 }}>View Public Profile</span>
              <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke={T.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6"/></svg>
            </Link>
          )}

          {/* Full analytics */}
          <button
            onClick={onShowAnalytics}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "none", border: "none", cursor: "pointer", borderBottom: `1px solid ${T.hair}` }}
          >
            <span style={{ fontWeight: 600, fontSize: 14, color: T.muted2 }}>Full Analytics</span>
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke={T.faint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6"/></svg>
          </button>

          {/* Logout */}
          <button
            onClick={onLogout}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 14px", background: "none", border: "none", cursor: "pointer", color: "#ff4d4f" }}
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Disconnect & Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Props ── */
export interface MobileHistoryViewProps {
  completedOrders: Order[];
  cancelledOrders: Order[];
  merchantId: string | null;
  merchantInfo: any;
  historyTab: "completed" | "cancelled" | "stats";
  setHistoryTab: (tab: "completed" | "cancelled" | "stats") => void;
  effectiveBalance: number | null;
  totalTradedVolume: number;
  todayEarnings: number;
  pendingEarnings: number;
  onShowAnalytics: () => void;
  onShowWalletModal: () => void;
  onLogout: () => void;
  onSelectOrder?: (order: Order) => void;
}

export function MobileHistoryView({
  completedOrders,
  cancelledOrders,
  merchantId,
  merchantInfo,
  historyTab,
  setHistoryTab,
  effectiveBalance,
  totalTradedVolume,
  todayEarnings,
  pendingEarnings,
  onShowAnalytics,
  onShowWalletModal,
  onLogout,
  onSelectOrder,
}: MobileHistoryViewProps) {
  const tabIndex = historyTab === "completed" ? 0 : historyTab === "cancelled" ? 1 : 2;

  // Group completed orders by date label
  const groupedCompleted = useMemo(() => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const map = new Map<string, Order[]>();
    for (const o of completedOrders) {
      const ds = o.timestamp.toDateString();
      const label = ds === today ? "Today" : ds === yesterday ? "Yesterday"
        : o.timestamp.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(o);
    }
    return map;
  }, [completedOrders]);

  // Group cancelled orders by date label
  const groupedCancelled = useMemo(() => {
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const map = new Map<string, Order[]>();
    for (const o of cancelledOrders) {
      const ds = o.timestamp.toDateString();
      const label = ds === today ? "Today" : ds === yesterday ? "Yesterday"
        : o.timestamp.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(o);
    }
    return map;
  }, [cancelledOrders]);

  return (
    <div className="space-y-4">
      {/* Tab strip */}
      <HistTabs
        tab={tabIndex}
        setTab={(i) => setHistoryTab(i === 0 ? "completed" : "cancelled")}
      />

      {/* Completed tab */}
      {historyTab === "completed" && (
        groupedCompleted.size === 0 ? (
          <EmptyState
            icon={HI.check(26)}
            title="No completed trades yet"
            sub="Your completed transactions will appear here."
          />
        ) : (
          <div>
            {Array.from(groupedCompleted.entries()).map(([day, orders]) => (
              <div key={day} style={{ marginBottom: 6 }}>
                {/* Date header */}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 4px 6px" }}>
                  <span style={{ color: T.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{day}</span>
                  <span style={{ color: T.faint, fontSize: 11, fontWeight: 600 }}>{orders.length} trade{orders.length !== 1 ? "s" : ""}</span>
                </div>
                {/* Glass group card */}
                <div style={{ background: T.glass, border: `1px solid ${T.hair}`, borderRadius: 18, overflow: "hidden", backdropFilter: "blur(20px)" }}>
                  {orders.map((order, i) => (
                    <div key={order.id}>
                      <TxnRow
                        order={order}
                        merchantId={merchantId}
                        onSelectOrder={onSelectOrder}
                        showBorder={i > 0}
                      />
                      {/* TX explorer links */}
                      {order.escrowTxHash && (
                        <div style={{ display: "flex", gap: 12, padding: "0 12px 10px", borderTop: `1px solid ${T.hair}` }}>
                          <a
                            href={getSolscanTxUrl(order.escrowTxHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: T.faint, textDecoration: "none" }}
                          >
                            <ExternalLink style={{ width: 10, height: 10 }} /> Solscan
                          </a>
                          {order.escrowPda && (
                            <a
                              href={getBlipscanTradeUrl(order.escrowPda)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: T.mint, textDecoration: "none" }}
                            >
                              <ExternalLink style={{ width: 10, height: 10 }} /> BlipScan
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Cancelled tab */}
      {historyTab === "cancelled" && (
        groupedCancelled.size === 0 ? (
          <EmptyState
            icon={HI.x(26)}
            title="No cancelled trades"
            sub="Declined or expired orders show up here."
          />
        ) : (
          <div>
            {Array.from(groupedCancelled.entries()).map(([day, orders]) => (
              <div key={day} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 4px 6px" }}>
                  <span style={{ color: T.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>{day}</span>
                  <span style={{ color: T.faint, fontSize: 11, fontWeight: 600 }}>{orders.length} order{orders.length !== 1 ? "s" : ""}</span>
                </div>
                <div style={{ background: T.glass, border: `1px solid ${T.hair}`, borderRadius: 18, overflow: "hidden", backdropFilter: "blur(20px)" }}>
                  {orders.map((order, i) => (
                    <CancelledRow key={order.id} order={order} onSelectOrder={onSelectOrder} showBorder={i > 0} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}

    </div>
  );
}
