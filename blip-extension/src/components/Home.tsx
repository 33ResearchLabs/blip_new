import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpRight, ArrowDownLeft, Activity, RefreshCw,
  Loader2, ChevronRight, User, Bell,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { clearAuth, clearRefreshToken, type StoredAuth } from "@/lib/auth";

interface Order {
  id: string;
  type: "buy" | "sell";
  amount: string;
  fiat_amount: number;
  fiat_currency: string;
  status: string;
  created_at: string;
  merchant?: { display_name?: string; username?: string };
}

interface HomeProps {
  auth: StoredAuth;
  onLogout: () => void;
  onTrade: () => void;
  onOrder: (id: string) => void;
}

function statusColor(s: string) {
  if (["complete","completed"].includes(s)) return "var(--success)";
  if (["cancelled","expired"].includes(s)) return "var(--danger)";
  if (s === "disputed") return "#f97316";
  if (s === "payment_sent") return "#3b82f6";
  if (s === "escrowed") return "#a855f7";
  return "var(--amber)";
}

function statusLabel(s: string) {
  const m: Record<string,string> = {
    open:"Open", accepted:"Accepted", escrowed:"Escrowed",
    payment_sent:"Sent", complete:"Done", completed:"Done",
    cancelled:"Cancelled", expired:"Expired", disputed:"Disputed",
  };
  return m[s] ?? s;
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function greeting(name: string) {
  const h = new Date().getHours();
  const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name.split(/[\s@]/)[0];
  return `${g}, ${first} 👋`;
}

type Tab = "home" | "orders" | "profile";

export function Home({ auth, onLogout, onTrade, onOrder }: HomeProps) {
  const [tab, setTab] = useState<Tab>("home");
  const [balance, setBalance] = useState<number | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const [meRes, ordersRes, rateRes] = await Promise.all([
        fetchWithAuth("/api/auth/me"),
        fetchWithAuth(`/api/orders?user_id=${auth.userId}&limit=30`),
        fetchWithAuth("/api/prices/current?pair=usdt_inr"),
      ]);
      if (meRes.ok) {
        const d = await meRes.json().catch(() => null);
        const bal = d?.data?.user?.balance;
        if (typeof bal === "number") setBalance(bal);
        else if (typeof bal === "string") setBalance(parseFloat(bal));
      }
      if (ordersRes.ok) {
        const d = await ordersRes.json().catch(() => null);
        if (Array.isArray(d?.data)) setOrders(d.data);
      }
      if (rateRes.ok) {
        const d = await rateRes.json().catch(() => null);
        const p = d?.data?.price ?? d?.price;
        if (typeof p === "number") setRate(p);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleLogout = async () => {
    await clearAuth();
    await clearRefreshToken();
    onLogout();
  };

  const activeOrders = orders.filter(o => !["complete","completed","cancelled","expired"].includes(o.status));
  const pastOrders = orders.filter(o => ["complete","completed","cancelled","expired"].includes(o.status));

  if (loading) return (
    <div style={{ ...page, alignItems: "center", justifyContent: "center", gap: 10 }}>
      <Loader2 size={22} color="var(--amber)" style={{ animation: "spin 1s linear infinite" }} />
      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Loading…</span>
    </div>
  );

  return (
    <div style={page}>
      {/* Header */}
      <header style={hdr}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,176,46,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "var(--amber)", letterSpacing: "-1px" }}>b</span>
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>blip</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => load(true)} style={iconBtn}>
            <RefreshCw size={14} color="var(--text-secondary)" style={refreshing ? { animation: "spin 1s linear infinite" } : {}} />
          </motion.button>
          <motion.button whileTap={{ scale: 0.9 }} style={iconBtn}>
            <Bell size={14} color="var(--text-secondary)" />
          </motion.button>
        </div>
      </header>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 0 8px" }}>
        <AnimatePresence mode="wait">

          {tab === "home" && (
            <motion.div key="home" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              {/* Greeting */}
              <div style={{ padding: "16px 16px 0" }}>
                <div style={{ fontSize: 13, color: "var(--text-tertiary)", marginBottom: 2 }}>{greeting(auth.userName)}</div>
              </div>

              {/* Balance card */}
              <div style={{ padding: "12px 16px 0" }}>
                <div style={balCard}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.4)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 8 }}>Total Balance</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 36, fontWeight: 800, color: "#fff", letterSpacing: "-2px", lineHeight: 1 }}>
                      {balance !== null ? fmt(balance) : "0.00"}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.45)" }}>USDT</span>
                  </div>
                  {rate !== null && balance !== null && (
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>≈ ₹{fmt(balance * rate)}</div>
                  )}
                  {/* Buy / Sell row inside card */}
                  <div style={{ display: "flex", gap: 8 }}>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => onTrade()} style={cardBtn("#10b981")}>
                      <ArrowDownLeft size={14} /> Buy
                    </motion.button>
                    <motion.button whileTap={{ scale: 0.97 }} onClick={() => onTrade()} style={cardBtn("#ef4444")}>
                      <ArrowUpRight size={14} /> Sell
                    </motion.button>
                  </div>
                </div>
              </div>

              {/* Active orders */}
              {activeOrders.length > 0 && (
                <section style={{ padding: "16px 16px 0" }}>
                  <SectionLabel>Active · {activeOrders.length}</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {activeOrders.map(o => <OrderRow key={o.id} order={o} onClick={() => onOrder(o.id)} />)}
                  </div>
                </section>
              )}

              {/* Recent */}
              {pastOrders.length > 0 && (
                <section style={{ padding: "14px 16px 0" }}>
                  <SectionLabel>Recent</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {pastOrders.slice(0, 5).map(o => <OrderRow key={o.id} order={o} onClick={() => onOrder(o.id)} muted />)}
                  </div>
                </section>
              )}

              {orders.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🌟</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>No trades yet</div>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>Tap Trade to get started</div>
                </div>
              )}
            </motion.div>
          )}

          {tab === "orders" && (
            <motion.div key="orders" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <div style={{ padding: "16px 16px 0" }}>
                <SectionLabel>All Orders</SectionLabel>
                {orders.length === 0
                  ? <EmptyState label="No orders yet" sub="Your trades will appear here" />
                  : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {orders.map(o => <OrderRow key={o.id} order={o} onClick={() => onOrder(o.id)} />)}
                    </div>
                }
              </div>
            </motion.div>
          )}

          {tab === "profile" && (
            <motion.div key="profile" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <div style={{ padding: "16px 16px 0" }}>
                {/* Avatar */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0 22px" }}>
                  <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(255,176,46,0.12)", border: "1px solid rgba(255,176,46,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {auth.userAvatar
                      ? <img src={auth.userAvatar} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} />
                      : <User size={22} color="var(--amber)" />
                    }
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{auth.userName}</div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>Blip user</div>
                  </div>
                </div>

                {/* Stats */}
                <SectionLabel>Stats</SectionLabel>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 22 }}>
                  <StatTile label="Total Trades" value={String(orders.length)} />
                  <StatTile label="Completed" value={String(orders.filter(o => ["complete","completed"].includes(o.status)).length)} />
                </div>

                {/* Links */}
                <SectionLabel>Account</SectionLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <ProfileRow label="Open full app" href="https://app.blip.money/user" />
                  <ProfileRow label="Sign out" onClick={handleLogout} danger />
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <nav style={nav}>
        <NavBtn icon={<Activity size={19} />} label="Home" active={tab === "home"} onClick={() => setTab("home")} />
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={onTrade}
          style={{
            width: 50, height: 50, borderRadius: "50%",
            background: "#fff", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 20px rgba(255,255,255,0.15)", marginTop: -16, flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B0F14" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </motion.button>
        <NavBtn icon={<User size={19} />} label="Profile" active={tab === "profile"} onClick={() => setTab("profile")} />
      </nav>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OrderRow({ order, onClick, muted = false }: { order: Order; onClick: () => void; muted?: boolean }) {
  const isBuy = order.type === "buy";
  const sc = statusColor(order.status);
  const sym = order.fiat_currency === "AED" ? "د.إ" : "₹";
  return (
    <motion.button whileTap={{ scale: 0.98 }} onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "11px 12px", borderRadius: 14,
      border: "1px solid var(--border)",
      background: "var(--bg-card)",
      cursor: "pointer", width: "100%", textAlign: "left",
      opacity: muted ? 0.5 : 1, fontFamily: "inherit",
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10, flexShrink: 0,
        background: isBuy ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {isBuy ? <ArrowDownLeft size={16} color="var(--success)" /> : <ArrowUpRight size={16} color="var(--danger)" />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
          {isBuy ? "Buy" : "Sell"} {parseFloat(order.amount || "0").toFixed(2)} USDT
        </div>
        {order.fiat_amount > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 1 }}>
            {sym}{order.fiat_amount?.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: sc }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: sc }}>{statusLabel(order.status)}</span>
        </div>
        <ChevronRight size={11} color="var(--text-tertiary)" />
      </div>
    </motion.button>
  );
}

function ActionBtn({ icon, label, color, onClick }: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      padding: "12px", borderRadius: 14,
      border: `1px solid ${color}22`,
      background: `${color}0e`,
      color, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    }}>
      {icon}{label}
    </motion.button>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function ProfileRow({ label, href, onClick, danger }: { label: string; href?: string; onClick?: () => void; danger?: boolean }) {
  const s: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "13px 14px", borderRadius: 12,
    border: "1px solid var(--border)", background: "var(--bg-card)",
    color: danger ? "var(--danger)" : "var(--text-primary)",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
    textDecoration: "none", width: "100%", fontFamily: "inherit", marginBottom: 4,
  };
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" style={s}>{label}<ChevronRight size={14} color="var(--text-tertiary)" /></a>;
  return <button onClick={onClick} style={s}>{label}<ChevronRight size={14} color={danger ? "var(--danger)" : "var(--text-tertiary)"} /></button>;
}

function NavBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
      background: "none", border: "none", cursor: "pointer",
      color: active ? "#fff" : "var(--text-tertiary)",
      fontSize: 10, fontWeight: 700, padding: "4px 16px", fontFamily: "inherit",
      letterSpacing: "0.2px", transition: "color 0.15s",
    }}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 10 }}>{children}</div>;
}

function EmptyState({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)" }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const page: React.CSSProperties = { height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" };

const hdr: React.CSSProperties = {
  padding: "14px 16px 10px",
  display: "flex", alignItems: "center", justifyContent: "space-between",
  borderBottom: "1px solid var(--border)", flexShrink: 0,
};

const iconBtn: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 8, cursor: "pointer", padding: "6px",
  display: "flex", alignItems: "center",
};

const balCard: React.CSSProperties = {
  background: "linear-gradient(135deg, #161d2b 0%, #111827 100%)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 20,
  padding: "18px 18px 16px",
};

function cardBtn(color: string): React.CSSProperties {
  return {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "9px", borderRadius: 12,
    border: `1px solid ${color}22`,
    background: `${color}12`,
    color, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  };
}

const nav: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-around",
  padding: "8px 20px 12px",
  borderTop: "1px solid var(--border)",
  background: "var(--bg)",
  flexShrink: 0,
};
