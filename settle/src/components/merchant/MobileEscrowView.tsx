"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Order } from "@/types/merchant";
import { useMerchantStore } from "@/stores/merchantStore";
import { formatCrypto, formatRate } from "@/lib/format";

// ── Design tokens (Zoop 2026) ────────────────────────────────────────────────
const T = {
  bg: "#08080a",
  text: "#f5f5f7",
  muted: "#86868b",
  muted2: "#aeaeb2",
  faint: "#5a5a60",
  hair: "rgba(255,255,255,0.09)",
  hair2: "rgba(255,255,255,0.16)",
  glass: "rgba(255,255,255,0.055)",
  mint: "#b8e9d4",
  mintBg: "rgba(184,233,212,0.12)",
  mintBorder: "rgba(184,233,212,0.3)",
  red: "#ff5a5f",
};

// ── Viewer side (YOU PAY / YOU RECEIVE) ─────────────────────────────────────
function getViewerSide(db: any, order: any, myId: string | null | undefined): "seller" | "buyer" {
  const myRole = order?.myRole || order?.my_role || db?.my_role;
  if (myRole === "seller") return "seller";
  if (myRole === "buyer") return "buyer";
  if (!db) return "seller";
  if (myId && db.merchant_id === myId) return "seller";
  if (myId && db.buyer_merchant_id === myId) return "buyer";
  if (db.merchant_id && !db.buyer_merchant_id) return "buyer";
  if (!db.merchant_id && db.buyer_merchant_id) return "seller";
  const orderType = String(db.type || "").toLowerCase();
  return orderType === "buy" ? "seller" : "buyer";
}

// ── Stage index ───────────────────────────────────────────────────────────────
const STAGES = ["Accepted", "Escrowed", "Paid", "Released"];
function stageIndex(status: string | undefined): number {
  switch (status) {
    case "accepted": return 0;
    case "escrowed":
    case "escrow": return 1;
    case "payment_sent": return 2;
    case "completed":
    case "payment_confirmed": return 3;
    default: return 0;
  }
}

// ── Steps stepper ─────────────────────────────────────────────────────────────
function Steps({ stage }: { stage: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", margin: "14px 0 2px" }}>
      {STAGES.map((s, i) => {
        const done = i <= stage, cur = i === stage;
        return (
          <div key={s} style={{ display: "flex", alignItems: "center", flex: i < STAGES.length - 1 ? "1 1 0" : "0 0 auto" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, flex: "0 0 auto" }}>
              <span style={{
                width: cur ? 11 : 9, height: cur ? 11 : 9, borderRadius: 999,
                background: done ? T.mint : "rgba(255,255,255,0.14)",
                boxShadow: cur ? `0 0 0 3px ${T.mintBg}` : "none",
                display: "block",
              }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: done ? T.mint : T.faint, whiteSpace: "nowrap" }}>{s}</span>
            </div>
            {i < STAGES.length - 1 && (
              <span style={{ flex: 1, height: 2, marginBottom: 14, background: i < stage ? T.mint : "rgba(255,255,255,0.12)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────
function statusPillData(dbStatus: string | undefined, canConfirmPayment: boolean, canMarkPaid: boolean): { label: string; mint: boolean } {
  if (canConfirmPayment) return { label: "Paid · release now", mint: true };
  if (dbStatus === "payment_sent") return { label: "Paid · awaiting confirm", mint: false };
  if (dbStatus === "escrowed" || dbStatus === "escrow") return { label: canMarkPaid ? "Escrowed · pay now" : "Escrowed · awaiting payment", mint: canMarkPaid };
  if (dbStatus === "accepted") return { label: "Accepted · locking escrow", mint: false };
  if (dbStatus === "disputed") return { label: "Disputed", mint: false };
  return { label: (dbStatus || "—").replace(/_/g, " "), mint: false };
}

// ── Active trade card ─────────────────────────────────────────────────────────
interface ActiveCardProps {
  order: Order;
  merchantId: string | null | undefined;
  markingDone: boolean;
  onOpenEscrowModal: (o: Order) => void;
  onMarkFiatPaymentSent: (o: Order) => void;
  onConfirmPayment: (o: Order) => void;
  onOpenChat: (o: Order) => void;
  onOpenDisputeModal: (id: string) => void;
  onOpenCancelModal: (o: Order) => void;
  setMobileView: (v: any) => void;
  onSelectOrder?: (o: Order) => void;
}

function ActiveCard({ order, merchantId, markingDone, onOpenEscrowModal, onMarkFiatPaymentSent, onConfirmPayment, onOpenChat, setMobileView, onSelectOrder }: ActiveCardProps) {
  const dbStatus = order.dbOrder?.minimal_status || order.dbOrder?.status;
  const role = order.myRole || "observer";
  const hasBeenAccepted = !!order.dbOrder?.accepted_at;

  const needsLockEscrow = dbStatus === "accepted" && !order.escrowTxHash && role === "seller";
  const canMarkPaid = role === "buyer" && dbStatus === "escrowed" && hasBeenAccepted && !!order.escrowTxHash;
  const canConfirmPayment = dbStatus === "payment_sent" && role === "seller";
  const canComplete = dbStatus === "payment_confirmed";

  const { label: statusLabel, mint } = statusPillData(dbStatus, canConfirmPayment, canMarkPaid);
  const stage = stageIndex(dbStatus);

  const viewerSide = getViewerSide(order.dbOrder, order, merchantId);
  const cryptoAmt = formatCrypto(order.amount);
  const fiatAmt = formatCrypto(order.total);
  const cryptoCur = order.fromCurrency || "USDT";
  const fiatCur = order.toCurrency || "AED";

  // Determine CTA
  const ctaLabel = needsLockEscrow ? "Lock Escrow"
    : canMarkPaid ? "I've Paid"
    : (canConfirmPayment || canComplete) ? "Release"
    : null;

  const handleCta = () => {
    // Lock escrow now opens the rich order popup (the new UI), where the seller
    // picks the receiving account and locks inline — instead of the old
    // bottom-sheet modal. Falls back to the modal if the popup opener is absent.
    if (needsLockEscrow) {
      if (onSelectOrder) onSelectOrder(order);
      else onOpenEscrowModal(order);
    }
    else if (canMarkPaid) onMarkFiatPaymentSent(order);
    else if (canConfirmPayment || canComplete) onConfirmPayment(order);
  };

  const mins = Math.floor(order.expiresIn / 60);
  const secs = (order.expiresIn % 60).toString().padStart(2, "0");
  const countdownStr = `${mins}:${secs} left`;

  const displayName = order.user || "Counterparty";
  const initials = displayName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();

  const unread = order.unreadCount || 0;

  return (
    <div style={{
      background: T.glass, border: `1px solid ${T.hair}`, borderRadius: 22,
      backdropFilter: "blur(20px) saturate(150%)", padding: 15, marginBottom: 12,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 40px rgba(0,0,0,0.35)",
    }}>
      {/* Status pill + countdown */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
        <span style={{
          display: "flex", alignItems: "center", gap: 7, padding: "4px 10px", borderRadius: 999,
          background: mint ? T.mintBg : "rgba(255,255,255,0.05)",
          border: `1px solid ${mint ? T.mintBorder : T.hair}`,
          color: mint ? T.mint : T.muted2,
          fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap",
        }}>
          {mint
            ? <span style={{ width: 6, height: 6, borderRadius: 999, background: T.mint, boxShadow: `0 0 0 0 rgba(184,233,212,0.5)`, animation: "z2ep-pulse 2.6s infinite" }} />
            : <span style={{ width: 6, height: 6, borderRadius: 999, background: T.muted }} />
          }
          {statusLabel}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, color: mint ? T.mint : T.muted2, fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
          <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>
          {countdownStr}
        </span>
      </div>

      {/* Trust block — tap to open the full order detail (OrderQuickView). */}
      <div
        onClick={onSelectOrder ? () => onSelectOrder(order) : undefined}
        role={onSelectOrder ? "button" : undefined}
        style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, cursor: onSelectOrder ? "pointer" : undefined }}
      >
        <span style={{ width: 36, height: 36, borderRadius: 999, flexShrink: 0, background: "linear-gradient(150deg,#ff8a3d,#ff5d73)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>
          {initials}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <b style={{ fontSize: 13.5, whiteSpace: "nowrap", color: T.text }}>{displayName}</b>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, color: T.muted, fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "#ffb020" }}>
              <svg viewBox="0 0 24 24" width={11} height={11} fill="currentColor"><path d="m12 2.5 2.9 5.9 6.6.9-4.8 4.6 1.2 6.5L12 21.3 6.1 20.4l1.2-6.5L2.5 9.3l6.6-.9L12 2.5Z"/></svg>
              <b style={{ color: "#fff" }}>{order.dbOrder?.user?.rating ? Number(order.dbOrder.user.rating).toFixed(1) : "—"}</b>
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>{order.dbOrder?.user?.total_trades ?? 0} orders</span>
          </div>
          {(order.dbOrder?.user as any)?.completion_rate != null && (
            <div style={{ marginTop: 2, color: T.faint, fontSize: 10.5, fontWeight: 600, whiteSpace: "nowrap" }}>
              {(order.dbOrder?.user as any).completion_rate}% completion
            </div>
          )}
        </div>
        {/* Chat icon button */}
        <button
          onClick={() => { onOpenChat(order); setMobileView("chat"); }}
          style={{ position: "relative", width: 36, height: 36, borderRadius: 999, flexShrink: 0, background: T.glass, border: `1px solid ${T.hair}`, display: "flex", alignItems: "center", justifyContent: "center", color: T.muted2, cursor: "pointer" }}>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-6.1A8.4 8.4 0 1 1 21 11.5Z"/></svg>
          {unread > 0 && (
            <span style={{ position: "absolute", top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 99, background: T.mint, color: "#08221a", fontSize: 9, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px" }}>
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: T.hair, margin: "11px -15px" }} />

      {/* Payout hero */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 13 }}>
        <div>
          <div style={{ color: T.muted, fontWeight: 700, fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>
            {viewerSide === "seller" ? "You receive" : "You pay out"}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 7 }}>
            <span style={{ fontSize: 25, fontWeight: 800, lineHeight: 0.95, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em", color: T.text }}>
              {viewerSide === "seller" ? cryptoAmt : fiatAmt}
            </span>
            <span style={{ fontSize: 10, color: T.muted, fontWeight: 700, marginBottom: 2 }}>
              {viewerSide === "seller" ? cryptoCur : fiatCur}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: T.text }}>
            {viewerSide === "seller" ? fiatAmt : cryptoAmt}{" "}
            <span style={{ fontSize: 10.5, color: T.muted }}>{viewerSide === "seller" ? fiatCur : cryptoCur}</span>
          </div>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 600, marginTop: 1, whiteSpace: "nowrap" }}>
            @ <span style={{ color: T.text }}>{formatRate(order.rate)}</span>
          </div>
        </div>
      </div>

      {/* Payment details (when buyer needs to pay) */}
      {canMarkPaid && (() => {
        const lpm = order.lockedPaymentMethod;
        const bank = order.sellerBankDetails || order.userBankDetails;
        if (lpm) return (
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hair}`, fontSize: 11, fontWeight: 600, color: T.muted2 }}>
            → {lpm.label} ({lpm.type.toUpperCase()})
            {lpm.type === "upi" && lpm.details?.upi_id && <div style={{ color: T.faint, marginTop: 2 }}>{lpm.details.upi_id}</div>}
            {lpm.type === "bank" && lpm.details?.iban && <div style={{ color: T.faint, marginTop: 2 }}>{lpm.details.iban}</div>}
          </div>
        );
        if (bank) return (
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hair}`, fontSize: 11, fontWeight: 600, color: T.faint }}>
            → {bank.bank_name}<br />{bank.account_name}<br />{bank.iban}
          </div>
        );
        return null;
      })()}

      {/* Steps stepper */}
      <Steps stage={stage} />

      {/* Action row */}
      <div style={{ display: "flex", gap: 10, marginTop: 13 }}>
        <button
          onClick={() => { onOpenChat(order); setMobileView("chat"); }}
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "11px 16px", borderRadius: 13, background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hair}`, color: T.text, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
          <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-6.1A8.4 8.4 0 1 1 21 11.5Z"/></svg>
          Chat
        </button>
        {ctaLabel ? (
          <button
            onClick={handleCta}
            disabled={markingDone}
            style={{ flex: 1, padding: "11px", borderRadius: 13, border: "none", background: mint ? T.mint : "#f5f5f7", color: mint ? "#08221a" : "#0b0b0c", fontWeight: 800, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: markingDone ? 0.6 : 1 }}>
            {markingDone ? <Loader2 style={{ width: 16, height: 16, animation: "spin 1s linear infinite" }} /> : ctaLabel}
          </button>
        ) : (
          <button
            onClick={() => onSelectOrder?.(order)}
            style={{ flex: 1, padding: "11px", borderRadius: 13, border: `1px solid ${T.hair}`, background: "rgba(255,255,255,0.04)", color: T.muted2, fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>
            View
          </button>
        )}
      </div>
    </div>
  );
}

// ── Filter chips ──────────────────────────────────────────────────────────────
type EscrowStatusFilter = "all" | "accepted" | "escrowed" | "payment_sent" | "cancelled" | "disputed";
const FILTERS: { key: EscrowStatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "accepted", label: "Accepted" },
  { key: "escrowed", label: "Escrowed" },
  { key: "disputed", label: "Disputed" },
];

// ── Main view ─────────────────────────────────────────────────────────────────
export interface MobileEscrowViewProps {
  ongoingOrders: Order[];
  markingDone: boolean;
  onOpenEscrowModal: (order: Order) => void;
  onMarkFiatPaymentSent: (order: Order) => void;
  onConfirmPayment: (order: Order) => void;
  onOpenDisputeModal: (orderId: string) => void;
  onOpenCancelModal: (order: Order) => void;
  onOpenChat: (order: Order) => void;
  setMobileView: (view: "orders" | "escrow" | "chat" | "history" | "marketplace") => void;
  onSelectOrder?: (order: Order) => void;
}

export function MobileEscrowView({
  ongoingOrders, markingDone,
  onOpenEscrowModal, onMarkFiatPaymentSent, onConfirmPayment,
  onOpenDisputeModal, onOpenCancelModal, onOpenChat, setMobileView,
  onSelectOrder,
}: MobileEscrowViewProps) {
  const [filter, setFilter] = useState<EscrowStatusFilter>("all");
  const merchantId = useMerchantStore((s) => s.merchantId);

  // Sliding-thumb position is MEASURED from the active tab button rather than
  // assuming equal 1/N widths — the labels differ in length ("All" vs
  // "Disputed"), so an equal-quarters calc drifts off and overlaps neighbours.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [thumb, setThumb] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const i = FILTERS.findIndex((f) => f.key === filter);
    const el = tabRefs.current[i];
    if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
  }, [filter]);

  // Keep the thumb aligned if the strip reflows (rotation, font load, resize).
  useEffect(() => {
    const recalc = () => {
      const i = FILTERS.findIndex((f) => f.key === filter);
      const el = tabRefs.current[i];
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, [filter]);

  const filtered = useMemo(() => {
    if (filter === "all") return ongoingOrders;
    return ongoingOrders.filter((o) => {
      const s = o.dbOrder?.minimal_status || o.dbOrder?.status;
      return s === filter;
    });
  }, [ongoingOrders, filter]);

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Tab strip — same design as New Orders / Chat / History */}
      <div style={{ position: "relative", display: "flex", background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 3, marginBottom: 12, overflowX: "auto", scrollbarWidth: "none", width: "100%" }}>
        {/* sliding thumb — positioned from the measured active tab */}
        <div style={{
          position: "absolute", top: 3, bottom: 3, borderRadius: 11,
          background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
          transition: "left 0.22s cubic-bezier(0.22,1,0.36,1), width 0.22s",
          left: thumb.left,
          width: thumb.width,
          opacity: thumb.width ? 1 : 0,
          pointerEvents: "none",
          flexShrink: 0,
        }} />
        {FILTERS.map(({ key, label }, i) => {
          const isActive = filter === key;
          return (
            <button
              key={key}
              ref={(el) => { tabRefs.current[i] = el; }}
              type="button"
              onClick={() => setFilter(key)}
              style={{ flex: 1, minWidth: "max-content", position: "relative", zIndex: 1, padding: "7px 12px", fontSize: 13, fontWeight: 700, color: isActive ? "#f5f5f7" : "#86868b", background: "none", border: "none", cursor: "pointer", borderRadius: 11, transition: "color 0.2s", whiteSpace: "nowrap" }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Cards */}
      {filtered.length > 0 ? filtered.map((order) => (
        <ActiveCard
          key={order.id}
          order={order}
          merchantId={merchantId}
          markingDone={markingDone}
          onOpenEscrowModal={onOpenEscrowModal}
          onMarkFiatPaymentSent={onMarkFiatPaymentSent}
          onConfirmPayment={onConfirmPayment}
          onOpenChat={onOpenChat}
          onOpenDisputeModal={onOpenDisputeModal}
          onOpenCancelModal={onOpenCancelModal}
          setMobileView={setMobileView}
          onSelectOrder={onSelectOrder}
        />
      )) : (
        <div style={{ textAlign: "center", paddingTop: 100 }}>
          <div style={{ width: 64, height: 64, borderRadius: 22, background: T.glass, border: `1px solid ${T.hair}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: T.muted }}>
            <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5.5c0 4.3 3 7.3 7 8.5 4-1.2 7-4.2 7-8.5V6l-7-3Z"/></svg>
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>No active trades</div>
          <div style={{ color: T.muted, fontSize: 13, fontWeight: 500, marginTop: 5 }}>
            {ongoingOrders.length > 0 && filter !== "all"
              ? <button onClick={() => setFilter("all")} style={{ background: "none", border: "none", color: T.mint, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Show all trades</button>
              : "Accepted orders in escrow appear here."}
          </div>
        </div>
      )}
    </div>
  );
}
