import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, Loader2, CheckCircle2, Clock, AlertTriangle, ExternalLink, ArrowDownLeft, ArrowUpRight, MessageCircle } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface OrderDetailProps {
  orderId: string;
  userId: string;
  onBack: () => void;
  onChat?: () => void;
}

interface Order {
  id: string;
  type: "buy" | "sell";
  amount: string;
  fiat_amount: number;
  fiat_currency: string;
  status: string;
  created_at: string;
  rate: number;
  merchant?: { display_name?: string; username?: string };
}

function statusColor(s: string) {
  if (["complete","completed"].includes(s)) return "#22c55e";
  if (["cancelled","expired"].includes(s)) return "#ef4444";
  if (s === "disputed") return "#f97316";
  if (s === "payment_sent") return "#3b82f6";
  if (s === "escrowed") return "#a855f7";
  return "#ffb02e";
}

const STEPS = {
  buy: [
    { label: "Order placed",    done: ["open","accepted","escrowed","payment_sent","complete","completed"] },
    { label: "Merchant matched", done: ["escrowed","payment_sent","complete","completed"] },
    { label: "Send payment",    done: ["payment_sent","complete","completed"] },
    { label: "Trade complete",  done: ["complete","completed"] },
  ],
  sell: [
    { label: "Order placed",    done: ["accepted","escrowed","payment_sent","complete","completed"] },
    { label: "Lock escrow",     done: ["escrowed","payment_sent","complete","completed"] },
    { label: "Merchant pays",   done: ["payment_sent","complete","completed"] },
    { label: "Confirm & release", done: ["complete","completed"] },
  ],
};

const SYM: Record<string,string> = { INR: "₹", AED: "د.إ", USD: "$" };

export function OrderDetail({ orderId, userId, onBack, onChat }: OrderDetailProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetchWithAuth(`/api/orders/${orderId}`);
    if (res.ok) {
      const d = await res.json().catch(() => null);
      if (d?.data) setOrder(d.data);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [orderId]);

  const doAction = async (action: string) => {
    setActionLoading(true);
    setError("");
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/action`, {
        method: "POST",
        body: JSON.stringify({ action, userId }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setError(d?.error || "Action failed"); return; }
      await load();
    } catch {
      setError("Network error");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return (
    <div style={{ ...page, alignItems: "center", justifyContent: "center" }}>
      <Loader2 size={22} color="var(--accent)" style={{ animation: "spin 1s linear infinite" }} />
    </div>
  );

  if (!order) return (
    <div style={{ ...page, alignItems: "center", justifyContent: "center", gap: 12 }}>
      <AlertTriangle size={28} color="#f97316" />
      <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Order not found</div>
      <button onClick={onBack} style={linkBtn}>Go back</button>
    </div>
  );

  const isTerminal = ["complete","completed","cancelled","expired","disputed"].includes(order.status);
  const steps = STEPS[order.type] ?? STEPS.buy;
  const sym = SYM[order.fiat_currency] ?? order.fiat_currency;
  const isBuy = order.type === "buy";
  const sc = statusColor(order.status);

  return (
    <div style={page}>
      {/* Header */}
      <header style={headerStyle}>
        <motion.button whileTap={{ scale: 0.92 }} onClick={onBack} style={backBtn}>
          <ChevronLeft size={17} />
        </motion.button>
        <div style={{ flex: 1, marginLeft: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
            {isBuy ? "Buy" : "Sell"} {parseFloat(order.amount || "0").toFixed(2)} USDT
          </div>
          <div style={{ fontSize: 10, color: "var(--text-tertiary)", marginTop: 1 }}>
            #{orderId.slice(-6).toUpperCase()}
          </div>
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: sc,
          background: `${sc}18`, padding: "4px 10px", borderRadius: 7,
        }}>
          {order.status.replace("_"," ")}
        </div>
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        {/* Amount card */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: "14px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: isBuy ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {isBuy ? <ArrowDownLeft size={16} color="#22c55e" /> : <ArrowUpRight size={16} color="#ef4444" />}
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 600 }}>
                {isBuy ? "You buy" : "You sell"}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.5px", lineHeight: 1.1 }}>
                {parseFloat(order.amount || "0").toFixed(2)} <span style={{ fontSize: 13, color: "var(--text-tertiary)", fontWeight: 500 }}>USDT</span>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <StatItem label={isBuy ? "You pay" : "You receive"} value={`${sym}${order.fiat_amount?.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "—"}`} />
            <StatItem label="Rate" value={`${sym}${order.rate?.toLocaleString("en-US") ?? "—"}`} />
            {order.merchant && <StatItem label="Merchant" value={order.merchant.display_name || order.merchant.username || "—"} />}
          </div>
        </div>

        {/* Progress */}
        {!isTerminal && (
          <div style={{ marginBottom: 14 }}>
            <div style={sectionLbl}>Progress</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {steps.map((step, i) => {
                const done = step.done.includes(order.status);
                const active = !done && (i === 0 || steps[i-1].done.includes(order.status));
                return (
                  <div key={i} style={{ display: "flex", gap: 10, paddingBottom: i < steps.length-1 ? 10 : 0 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                        background: done ? "#22c55e" : active ? "var(--accent)" : "var(--surface)",
                        border: active ? "2px solid rgba(255,176,46,0.3)" : done ? "none" : "1px solid var(--border)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {done && <CheckCircle2 size={12} color="#fff" />}
                        {active && <Clock size={10} color="#0b0b0d" />}
                      </div>
                      {i < steps.length-1 && (
                        <div style={{ width: 1, flex: 1, minHeight: 10, background: done ? "rgba(34,197,94,0.25)" : "var(--border)", margin: "3px 0" }} />
                      )}
                    </div>
                    <div style={{ paddingTop: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: done ? "var(--text-tertiary)" : active ? "var(--text-primary)" : "var(--border)" }}>
                        {step.label}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Terminal */}
        {isTerminal && (
          <div style={{ padding: "12px 14px", borderRadius: 12, background: `${sc}0f`, border: `1px solid ${sc}25`, display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <CheckCircle2 size={18} color={sc} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: sc }}>
                {["complete","completed"].includes(order.status) ? "Trade complete 🎉" : order.status.replace("_"," ")}
              </div>
              {["complete","completed"].includes(order.status) && (
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
                  USDT {isBuy ? "received in your wallet" : "released to merchant"}
                </div>
              )}
            </div>
          </div>
        )}

        {error && <div style={errorBox}>{error}</div>}
      </div>

      {/* Actions */}
      <div style={{ padding: "10px 16px 14px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        {!isTerminal && order.status === "escrowed" && isBuy && (
          <ActionBtn label="Mark Payment Sent" loading={actionLoading} onClick={() => doAction("SEND_PAYMENT")} primary />
        )}
        {!isTerminal && order.status === "payment_sent" && !isBuy && (
          <ActionBtn label="Confirm Received" loading={actionLoading} onClick={() => doAction("CONFIRM_PAYMENT")} primary />
        )}
        {onChat && (
          <motion.button whileTap={{ scale: 0.97 }} onClick={onChat} style={{ ...viewFullBtn, color: "var(--text-secondary)" }}>
            <MessageCircle size={12} /> Chat
          </motion.button>
        )}
        <a href="https://app.blip.money/user" target="_blank" rel="noopener noreferrer" style={viewFullBtn}>
          <ExternalLink size={12} /> Full App
        </a>
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function ActionBtn({ label, loading, onClick, primary = false }: { label: string; loading: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} disabled={loading} style={{
      flex: 1, padding: "11px", borderRadius: 10, border: "none",
      background: primary ? "var(--accent)" : "var(--bg-card)",
      color: primary ? "#0b0b0d" : "var(--text-secondary)",
      fontSize: 12, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      opacity: loading ? 0.6 : 1, fontFamily: "inherit",
      border: primary ? "none" : "1px solid var(--border)",
    } as any}>
      {loading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : label}
    </motion.button>
  );
}

const page: React.CSSProperties = { height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" };
const headerStyle: React.CSSProperties = { padding: "12px 16px", display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", flexShrink: 0 };
const backBtn: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer", padding: "5px", display: "flex", alignItems: "center" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: "var(--accent)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const viewFullBtn: React.CSSProperties = { padding: "11px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-tertiary)", fontSize: 11, fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" };
const sectionLbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 10 };
const errorBox: React.CSSProperties = { marginTop: 10, fontSize: 12, color: "#f87171", padding: "9px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.18)" };
