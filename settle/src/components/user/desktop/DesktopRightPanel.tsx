"use client";

import { Send, MessageCircle, Clock, ArrowUpRight, ArrowDownLeft, ChevronRight } from "lucide-react";
import type { Screen, Order } from "@/components/user/screens/types";
import { formatCrypto, formatFiat } from "@/lib/format";

interface DesktopRightPanelProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  activeOrder: Order | null | undefined;
  pendingOrders: Order[];
  setActiveOrderId: (id: string) => void;
  selectedPair?: "usdt_aed" | "usdt_inr";
}

function statusDot(status: string) {
  if (["complete", "completed"].includes(status)) return "#22c55e";
  if (["cancelled", "expired"].includes(status)) return "#ef4444";
  if (status === "disputed") return "#f97316";
  if (status === "payment_sent") return "#3b82f6";
  if (status === "escrowed") return "#a855f7";
  return "#ffb02e";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    open: "Open", accepted: "Accepted", escrowed: "Escrowed",
    payment_sent: "Payment Sent", complete: "Complete", completed: "Complete",
    cancelled: "Cancelled", expired: "Expired", disputed: "Disputed",
  };
  return map[status] ?? status;
}

export function DesktopRightPanel({
  screen,
  setScreen,
  activeOrder,
  pendingOrders,
  setActiveOrderId,
  selectedPair = "usdt_inr",
}: DesktopRightPanelProps) {
  const fiatCurrency = selectedPair === "usdt_aed" ? "AED" : "INR";
  const hasActiveOrder = activeOrder && !["complete", "completed", "cancelled", "expired"].includes(activeOrder.status);

  return (
    <aside style={shell}>
      {/* New Trade — small pill, top of panel */}
      <button
        onClick={() => setScreen("trade")}
        style={newTradeBtn}
      >
        <Send size={12} strokeWidth={2.2} style={{ flexShrink: 0 }} />
        New Trade
      </button>

      {/* Active order card */}
      {hasActiveOrder && (
        <section style={{ marginBottom: 20 }}>
          <div style={sectionLabel}>Active Order</div>
          <button
            onClick={() => { setActiveOrderId(activeOrder.id); setScreen("order"); }}
            style={orderCard}
          >
            {/* Type icon + status */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7,
                background: activeOrder.type === "buy" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {activeOrder.type === "buy"
                  ? <ArrowDownLeft size={14} color="#22c55e" />
                  : <ArrowUpRight size={14} color="#ef4444" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
                  {activeOrder.type === "buy" ? "Buy" : "Sell"} USDT
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                  #{activeOrder.id?.slice(-6).toUpperCase()}
                </div>
              </div>
              <ChevronRight size={13} color="rgba(255,255,255,0.2)" />
            </div>

            {/* Amount row */}
            <div style={amountRow}>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.5px" }}>
                {formatCrypto(parseFloat(activeOrder.cryptoAmount ?? "0"))}
              </span>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, marginLeft: 4 }}>USDT</span>
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 2, marginBottom: 10 }}>
              {formatFiat(parseFloat(activeOrder.fiatAmount ?? "0"), fiatCurrency)}
            </div>

            {/* Status pill */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusDot(activeOrder.status), flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: statusDot(activeOrder.status) }}>
                  {statusLabel(activeOrder.status)}
                </span>
              </div>
              {/* Chat button */}
              <button
                onClick={(e) => { e.stopPropagation(); setActiveOrderId(activeOrder.id); setScreen("chat-view"); }}
                style={chatBtn}
              >
                <MessageCircle size={12} />
                Chat
              </button>
            </div>
          </button>
        </section>
      )}

      {/* Other pending orders */}
      {pendingOrders.filter(o => o.id !== activeOrder?.id).length > 0 && (
        <section>
          <div style={sectionLabel}>Orders</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {pendingOrders.filter(o => o.id !== activeOrder?.id).slice(0, 6).map((order) => (
              <button
                key={order.id}
                onClick={() => { setActiveOrderId(order.id); setScreen("order"); }}
                style={orderRow}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 5, flexShrink: 0,
                  background: order.type === "buy" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {order.type === "buy"
                    ? <ArrowDownLeft size={11} color="#22c55e" />
                    : <ArrowUpRight size={11} color="#ef4444" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.75)" }}>
                    {formatCrypto(parseFloat(order.cryptoAmount ?? "0"))} USDT
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: statusDot(order.status) }} />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>
                    {statusLabel(order.status)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!hasActiveOrder && pendingOrders.length === 0 && (
        <div style={{ paddingTop: 24, textAlign: "center" }}>
          <Clock size={22} color="rgba(255,255,255,0.1)" style={{ margin: "0 auto 8px" }} />
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", lineHeight: 1.5 }}>
            No active orders
          </div>
        </div>
      )}
    </aside>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const shell: React.CSSProperties = {
  width: 220,
  minWidth: 220,
  background: "#0a0d13",
  borderLeft: "1px solid rgba(255,255,255,0.05)",
  padding: "20px 14px",
  height: "100vh",
  position: "sticky",
  top: 0,
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 0,
};

const newTradeBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,176,46,0.25)",
  background: "rgba(255,176,46,0.08)",
  color: "#ffb02e",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  letterSpacing: "-0.1px",
  width: "100%",
  justifyContent: "center",
  marginBottom: 20,
  transition: "background 0.15s",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.5px",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.25)",
  marginBottom: 8,
};

const orderCard: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 12,
  padding: "12px",
  cursor: "pointer",
  textAlign: "left",
  color: "#fff",
  transition: "background 0.15s",
};

const amountRow: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
};

const chatBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "transparent",
  color: "rgba(255,255,255,0.45)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const orderRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 8px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  width: "100%",
  transition: "background 0.12s",
};
