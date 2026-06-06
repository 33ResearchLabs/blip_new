import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ArrowDownLeft, ArrowUpRight, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface TradeFormProps {
  userId: string;
  onBack: () => void;
  onOrderCreated: (orderId: string) => void;
}

type TradeType = "buy" | "sell";
type PairKey = "usdt_inr" | "usdt_aed";

const PAIRS: { key: PairKey; label: string; symbol: string }[] = [
  { key: "usdt_inr", label: "USDT / INR", symbol: "₹" },
  { key: "usdt_aed", label: "USDT / AED", symbol: "د.إ" },
];

const QUICK = ["50", "100", "500", "1000"];

export function TradeForm({ userId, onBack, onOrderCreated }: TradeFormProps) {
  const [tradeType, setTradeType] = useState<TradeType>("buy");
  const [pair, setPair] = useState<PairKey>("usdt_inr");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState<number | null>(null);
  const [feeBps, setFeeBps] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [rateLoading, setRateLoading] = useState(true);
  const [error, setError] = useState("");

  const currentPair = PAIRS.find(p => p.key === pair)!;
  const fiatAmt = amount && rate ? (parseFloat(amount) * rate) : null;
  const feeAmt = fiatAmt && feeBps ? fiatAmt * feeBps / 10000 : null;

  useEffect(() => {
    setRateLoading(true);
    setRate(null);
    fetchWithAuth(`/api/prices/current?pair=${pair}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (typeof d?.data?.price === "number") {
          setRate(d.data.price);
          setFeeBps(d.data.feeBps ?? 0);
        }
      })
      .catch(() => null)
      .finally(() => setRateLoading(false));
  }, [pair]);

  const submit = async () => {
    const n = parseFloat(amount);
    if (!amount || isNaN(n) || n <= 0) { setError("Enter an amount"); return; }
    if (!rate) { setError("Rate unavailable — try again"); return; }
    setError("");
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/orders", {
        method: "POST",
        body: JSON.stringify({ user_id: userId, type: tradeType, crypto_amount: amount, payment_method: "bank", pair, expected_rate: rate, expected_fee_bps: feeBps }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(data?.error || "Failed to create order"); return; }
      const id = data?.data?.id;
      if (id) onOrderCreated(id);
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={page}>
      <header style={hdrStyle}>
        <motion.button whileTap={{ scale: 0.92 }} onClick={onBack} style={backBtn}>
          <ChevronLeft size={18} />
        </motion.button>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>New Trade</span>
        <div style={{ width: 32 }} />
      </header>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {/* Buy / Sell */}
        <div style={segCtrl}>
          {(["buy", "sell"] as TradeType[]).map(t => (
            <button key={t} onClick={() => setTradeType(t)} style={{
              flex: 1, padding: "10px", borderRadius: 10, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: 700, fontFamily: "inherit",
              background: tradeType === t ? (t === "buy" ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)") : "transparent",
              color: tradeType === t ? (t === "buy" ? "#10b981" : "#ef4444") : "var(--text-tertiary)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            }}>
              {t === "buy" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
              {t === "buy" ? "Buy USDT" : "Sell USDT"}
            </button>
          ))}
        </div>

        {/* Pair */}
        <div style={{ ...segCtrl, marginTop: 10 }}>
          {PAIRS.map(p => (
            <button key={p.key} onClick={() => setPair(p.key)} style={{
              flex: 1, padding: "8px", borderRadius: 9, border: "none", cursor: "pointer",
              fontSize: 12, fontWeight: 700, fontFamily: "inherit",
              background: pair === p.key ? "rgba(255,255,255,0.10)" : "transparent",
              color: pair === p.key ? "var(--text-primary)" : "var(--text-tertiary)",
            }}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Amount */}
        <div style={{ marginTop: 20 }}>
          <label style={fieldLbl}>Amount (USDT)</label>
          <div style={{ position: "relative", marginTop: 8 }}>
            <input
              type="number" value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00" min="0" max="100000" maxLength={14}
              style={inputStyle}
            />
            <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-tertiary)", fontWeight: 600 }}>
              USDT
            </span>
          </div>
        </div>

        {/* Quick amounts */}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {QUICK.map(q => (
            <button key={q} onClick={() => setAmount(q)} style={quickBtn}>{q}</button>
          ))}
        </div>

        {/* Rate card */}
        <div style={{ marginTop: 16, padding: "14px 16px", background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)" }}>
          {rateLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-tertiary)", fontSize: 12 }}>
              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Fetching rate…
            </div>
          ) : rate ? (
            <>
              <div style={rateRow}>
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Rate</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>
                  1 USDT = {currentPair.symbol}{rate.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                </span>
              </div>
              {fiatAmt && (
                <>
                  <div style={{ ...rateRow, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>You {tradeType === "buy" ? "pay" : "receive"}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: "var(--text-primary)" }}>
                      {currentPair.symbol}{fiatAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {feeAmt != null && feeAmt > 0 && (
                    <div style={{ ...rateRow, marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Service fee</span>
                      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                        {currentPair.symbol}{feeAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--danger)" }}>Rate unavailable</div>
          )}
        </div>

        {error && <div style={errorBox}>{error}</div>}
      </div>

      {/* CTA */}
      <div style={{ padding: "10px 16px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
        <motion.button
          whileTap={{ scale: 0.98 }}
          disabled={loading || !amount || !rate}
          onClick={submit}
          style={{
            width: "100%", padding: "14px", borderRadius: 14, border: "none",
            background: (!amount || !rate) ? "rgba(255,255,255,0.08)" : "#fff",
            color: (!amount || !rate) ? "var(--text-tertiary)" : "#0B0F14",
            fontSize: 15, fontWeight: 800,
            cursor: !amount || !rate || loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            fontFamily: "inherit",
          }}
        >
          {loading ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : `${tradeType === "buy" ? "Buy" : "Sell"} USDT`}
        </motion.button>
      </div>
    </div>
  );
}

const page: React.CSSProperties = { height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" };
const hdrStyle: React.CSSProperties = { padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", flexShrink: 0 };
const backBtn: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text-secondary)", cursor: "pointer", padding: "6px", display: "flex", alignItems: "center" };
const segCtrl: React.CSSProperties = { display: "flex", gap: 4, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 4 };
const fieldLbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.5px", textTransform: "uppercase" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "14px 50px 14px 14px", borderRadius: 12, border: "1px solid var(--border-medium)", background: "var(--bg-card)", color: "var(--text-primary)", outline: "none", fontFamily: "inherit", fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" };
const quickBtn: React.CSSProperties = { flex: 1, padding: "8px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const rateRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center" };
const errorBox: React.CSSProperties = { marginTop: 12, fontSize: 12, color: "#f87171", padding: "10px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 10, border: "1px solid rgba(239,68,68,0.18)" };
