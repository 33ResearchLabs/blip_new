"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type InstallState = "unavailable" | "ready" | "installing" | "installed";

const E = [0.22, 1, 0.36, 1] as const;

export function AppLaunchPage() {
  const [state, setState] = useState<InstallState>("unavailable");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) { setState("installed"); return; }
    const h = (e: Event) => { e.preventDefault(); setPrompt(e as BeforeInstallPromptEvent); setState("ready"); };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => { setState("installed"); setPrompt(null); });
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  async function install() {
    if (!prompt) return;
    setState("installing");
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setState(outcome === "accepted" ? "installed" : "ready");
    setPrompt(null);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0a0a0b",
      overflowY: "auto", overflowX: "hidden",
      fontFamily: "'Manrope', -apple-system, BlinkMacSystemFont, sans-serif",
      WebkitFontSmoothing: "antialiased",
    }}>

      {/* Ambient glow */}
      <div aria-hidden style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(255,176,46,0.12), transparent)",
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 480, margin: "0 auto", padding: "0 0 40px" }}>

        {/* ── Nav ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: E }}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "20px 24px 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: "rgba(255,176,46,0.15)", border: "1px solid rgba(255,176,46,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg viewBox="0 0 70 60" width={14} height={12} fill="none">
                <path d="M4 36 L16 36 L25 8 L38 52 L47 28 L66 28" stroke="#ffb02e" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>Blip Money</span>
          </div>
          <a href="/?welcome=skip" style={{
            fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.55)",
            textDecoration: "none", padding: "6px 14px",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999,
          }}>Sign in</a>
        </motion.div>

        {/* ── Hero ── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: E, delay: 0.1 }}
          style={{ padding: "48px 24px 0", textAlign: "center" }}
        >
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "rgba(255,176,46,0.12)", border: "1px solid rgba(255,176,46,0.25)",
            borderRadius: 999, padding: "5px 14px", marginBottom: 20,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#ffb02e", display: "inline-block" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#ffb02e", letterSpacing: "0.06em", textTransform: "uppercase" }}>Live · India & UAE</span>
          </div>

          <h1 style={{
            fontSize: "clamp(36px, 9vw, 52px)", fontWeight: 800,
            letterSpacing: "-0.045em", lineHeight: 1.05,
            color: "#f5f5f7", margin: "0 0 16px",
          }}>
            Two apps.<br />
            <span style={{ color: "rgba(255,255,255,0.22)" }}>One network.</span>
          </h1>

          <p style={{
            fontSize: 15, color: "rgba(255,255,255,0.42)", lineHeight: 1.65,
            letterSpacing: "-0.01em", maxWidth: 320, margin: "0 auto 40px",
          }}>
            Send money or run a merchant desk — same on-chain settlement layer beneath both.
          </p>
        </motion.div>

        {/* ── User App Card ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: E, delay: 0.2 }}
          style={{ margin: "0 16px 16px" }}
        >
          <div style={{
            background: "#111113", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 28, overflow: "hidden",
            boxShadow: "0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}>
            {/* Mockup area */}
            <div style={{
              background: "linear-gradient(160deg, #161618, #0d0d0f)",
              padding: "32px 24px 0",
              display: "flex", justifyContent: "center", alignItems: "flex-end",
              minHeight: 200, position: "relative", overflow: "hidden",
            }}>
              {/* Glow */}
              <div aria-hidden style={{
                position: "absolute", bottom: -40, left: "50%", transform: "translateX(-50%)",
                width: 280, height: 160,
                background: "radial-gradient(ellipse, rgba(255,176,46,0.18), transparent 70%)",
              }} />
              <PhoneMockup />
            </div>

            {/* Content */}
            <div style={{ padding: "24px 24px 28px" }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.16em",
                textTransform: "uppercase", color: "rgba(255,255,255,0.28)", marginBottom: 8,
              }}>For users · 01</div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "#f5f5f7", marginBottom: 8, lineHeight: 1.2 }}>
                Send money to anyone
              </div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.42)", lineHeight: 1.6, marginBottom: 24, letterSpacing: "-0.005em" }}>
                Real merchants compete on rate. Escrow on-chain. Settled in seconds.
              </p>

              {/* Download buttons */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <a href="/?welcome=skip" style={{ textDecoration: "none" }}>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 10, padding: "15px 24px", borderRadius: 16,
                    background: "#fff", color: "#0a0a0b",
                    fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em",
                    cursor: "pointer",
                  }}>
                    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>
                    </svg>
                    Open Web App
                  </div>
                </a>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 8, padding: "12px", borderRadius: 14,
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
                    color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>
                    </svg>
                    iPhone
                  </div>
                  <div style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 8, padding: "12px", borderRadius: 14,
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)",
                    color: "rgba(255,255,255,0.55)", fontSize: 12, fontWeight: 700, cursor: "pointer",
                  }}>
                    <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <path d="M5 17l7-12 7 12H5z"/><path d="M5 17h14"/><path d="M8 21h8"/>
                    </svg>
                    Android
                  </div>
                </div>
                <div style={{
                  textAlign: "center", fontSize: 11, color: "rgba(255,255,255,0.2)", fontWeight: 600,
                }}>Native apps coming soon</div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Merchant Card ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: E, delay: 0.3 }}
          style={{ margin: "0 16px 16px" }}
        >
          <div style={{
            background: "#f5f5f7", border: "1px solid rgba(0,0,0,0.06)",
            borderRadius: 28, overflow: "hidden",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.8)",
          }}>
            {/* Mockup area */}
            <div style={{
              background: "linear-gradient(160deg, #e8e8ea, #d4d4d6)",
              padding: "28px 20px 0",
              minHeight: 180, display: "flex", justifyContent: "center", alignItems: "flex-end",
              position: "relative", overflow: "hidden",
            }}>
              <div aria-hidden style={{
                position: "absolute", bottom: -30, left: "50%", transform: "translateX(-50%)",
                width: 260, height: 120,
                background: "radial-gradient(ellipse, rgba(0,0,0,0.08), transparent 70%)",
              }} />
              <LaptopMockup />
            </div>

            {/* Content */}
            <div style={{ padding: "24px 24px 28px" }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.16em",
                textTransform: "uppercase", color: "rgba(0,0,0,0.28)", marginBottom: 8,
              }}>For merchants · 02</div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em", color: "#0a0a0b", marginBottom: 8, lineHeight: 1.2 }}>
                Run a desk.<br/>Earn every fill.
              </div>
              <p style={{ fontSize: 13, color: "rgba(0,0,0,0.48)", lineHeight: 1.6, marginBottom: 24, letterSpacing: "-0.005em" }}>
                Set your rate, take the order, lock escrow. Live order book, one screen.
              </p>

              <a href="/merchant/login" style={{ textDecoration: "none" }}>
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 10, padding: "15px 24px", borderRadius: 16,
                  background: "#0a0a0b", color: "#fff",
                  fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em",
                  cursor: "pointer",
                }}>
                  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
                  </svg>
                  Open Merchant Dashboard
                </div>
              </a>
            </div>
          </div>
        </motion.div>

        {/* ── Features strip ── */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.45 }}
          style={{ margin: "0 16px 0", display: "flex", flexDirection: "column", gap: 10 }}
        >
          {[
            { icon: "🔒", title: "On-chain escrow", desc: "Funds locked before payment. Released on confirmation." },
            { icon: "⚡", title: "Instant settlement", desc: "Average trade settles in under 4 minutes." },
            { icon: "🌍", title: "Global corridors", desc: "INR, AED, USD — borderless settlement." },
          ].map((f) => (
            <div key={f.title} style={{
              display: "flex", alignItems: "flex-start", gap: 14,
              padding: "16px 18px", borderRadius: 18,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)",
            }}>
              <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1 }}>{f.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#f5f5f7", marginBottom: 3, letterSpacing: "-0.01em" }}>{f.title}</div>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.38)", lineHeight: 1.5 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </motion.div>

        {/* ── Footer ── */}
        <div style={{
          textAlign: "center", padding: "32px 24px 0",
          fontSize: 11, color: "rgba(255,255,255,0.15)", letterSpacing: "0.04em",
        }}>
          © 2026 Blip Money · app.blip.money
        </div>
      </div>
    </div>
  );
}

/* ── Phone Mockup ─────────────────────────────────────────────────────── */
function PhoneMockup() {
  return (
    <svg width="120" height="200" viewBox="0 0 120 200" fill="none">
      <rect x="1" y="1" width="118" height="198" rx="24" fill="#0d0d0f" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5"/>
      <rect x="6" y="6" width="108" height="188" rx="20" fill="#111113"/>
      <rect x="42" y="10" width="36" height="6" rx="3" fill="rgba(255,255,255,0.12)"/>
      {/* Status */}
      <text x="14" y="24" fill="rgba(255,255,255,0.4)" fontSize="7" fontWeight="700">9:41</text>
      {/* Header */}
      <rect x="10" y="32" width="100" height="32" rx="10" fill="rgba(255,255,255,0.04)"/>
      <circle cx="24" cy="48" r="8" fill="#ffb02e" opacity="0.2"/>
      <rect x="36" y="43" width="40" height="4" rx="2" fill="rgba(255,255,255,0.5)"/>
      <rect x="36" y="50" width="28" height="3" rx="1.5" fill="rgba(255,255,255,0.2)"/>
      {/* Balance */}
      <text x="14" y="82" fill="rgba(255,255,255,0.35)" fontSize="6" fontWeight="700" letterSpacing="0.08em">BALANCE</text>
      <text x="14" y="97" fill="#f5f5f7" fontSize="22" fontWeight="800" letterSpacing="-0.04em">$2,400</text>
      <text x="14" y="108" fill="rgba(255,255,255,0.3)" fontSize="7">≈ ₹1,99,920</text>
      {/* Action buttons */}
      {[["Buy",14],["Sell",44],["Send",74],["Scan",104]].map(([l,x])=>(
        <g key={l as string}>
          <rect x={x as number} y="118" width="22" height="22" rx="7" fill={l==="Buy"?"#fff":"rgba(255,255,255,0.07)"} stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"/>
          <text x={(x as number)+11} y="132" textAnchor="middle" fill={l==="Buy"?"#000":"rgba(255,255,255,0.6)"} fontSize="5.5" fontWeight="700">{l as string}</text>
        </g>
      ))}
      {/* Divider */}
      <line x1="14" y1="148" x2="106" y2="148" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8"/>
      <text x="14" y="158" fill="rgba(255,255,255,0.3)" fontSize="5.5" fontWeight="700" letterSpacing="0.1em">RECENT</text>
      {/* Transactions */}
      {[{n:"Meera K.",a:"+₹2,400",t:"2m ago",c:"#4ade80"},{n:"Arjun V.",a:"−$80.00",t:"1h ago",c:"rgba(255,255,255,0.6)"}].map((tx,i)=>(
        <g key={tx.n}>
          <circle cx="20" cy={170+i*18} r="5" fill="rgba(255,255,255,0.06)"/>
          <text x="20" y={172+i*18} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="4">{tx.n[0]}</text>
          <text x="30" y={168+i*18} fill="rgba(255,255,255,0.7)" fontSize="5.5" fontWeight="600">{tx.n}</text>
          <text x="30" y={174+i*18} fill="rgba(255,255,255,0.25)" fontSize="4">{tx.t}</text>
          <text x="106" y={168+i*18} textAnchor="end" fill={tx.c} fontSize="5.5" fontWeight="700">{tx.a}</text>
        </g>
      ))}
      {/* Home bar */}
      <rect x="44" y="191" width="32" height="3" rx="1.5" fill="rgba(255,255,255,0.2)"/>
    </svg>
  );
}

/* ── Laptop Mockup ────────────────────────────────────────────────────── */
function LaptopMockup() {
  return (
    <svg width="280" height="160" viewBox="0 0 280 160" fill="none">
      {/* Base */}
      <rect x="20" y="148" width="240" height="10" rx="3" fill="#b0b0b2" stroke="rgba(0,0,0,0.12)" strokeWidth="0.8"/>
      <rect x="75" y="143" width="130" height="6" rx="2" fill="#c8c8ca"/>
      {/* Bezel */}
      <rect x="4" y="2" width="272" height="143" rx="10" fill="#c8c8ca" stroke="rgba(0,0,0,0.12)" strokeWidth="0.8"/>
      {/* Screen */}
      <rect x="12" y="10" width="256" height="127" rx="7" fill="#0d0d0f"/>
      {/* Camera */}
      <circle cx="140" cy="6" r="2.5" fill="rgba(0,0,0,0.2)"/>
      {/* Top bar */}
      <rect x="12" y="10" width="256" height="18" rx="7" fill="rgba(255,255,255,0.03)"/>
      <text x="22" y="21" fill="rgba(255,255,255,0.7)" fontSize="6" fontWeight="800" letterSpacing="0.06em">BLIP MARKET</text>
      {["Orders","Analytics","History"].map((t,i)=>(
        <text key={t} x={110+i*40} y="21" fill="rgba(255,255,255,0.3)" fontSize="5.5">{t}</text>
      ))}
      <rect x="218" y="13" width="46" height="12" rx="4" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5"/>
      <text x="241" y="21" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="5" fontWeight="700">$45,280</text>
      {/* Left panel */}
      <line x1="80" y1="28" x2="80" y2="137" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8"/>
      <text x="20" y="40" fill="rgba(255,255,255,0.3)" fontSize="5" letterSpacing="0.1em">BALANCE</text>
      <text x="20" y="56" fill="#f5f5f7" fontSize="18" fontWeight="800" letterSpacing="-0.04em">$45k</text>
      <text x="20" y="65" fill="#ffb02e" fontSize="5" fontWeight="700">↑ +$1,247</text>
      {[0.4,0.6,0.45,0.8,0.55,0.7,0.9].map((h,i)=>(
        <rect key={i} x={20+i*6} y={100-h*22} width="4" height={h*22} rx="1.5"
          fill={i===6?"#ffb02e":"rgba(255,255,255,0.12)"}/>
      ))}
      {/* Orders */}
      <text x="90" y="38" fill="rgba(255,255,255,0.3)" fontSize="5" letterSpacing="0.08em">PENDING ORDERS</text>
      {[
        {n:"parth.sol",a:"200 USDT",r:"₹103.70",s:"BUY",hot:true},
        {n:"maya.eth",a:"100 USDT",r:"₹100.30",s:"SELL",hot:false},
        {n:"sana.dxb",a:"820 USDT",r:"AED 3.67",s:"BUY",hot:false},
      ].map((o,i)=>(
        <g key={i}>
          <rect x="88" y={43+i*26} width="148" height="22" rx="5"
            fill={o.hot?"rgba(255,255,255,0.05)":"transparent"}
            stroke={o.hot?"rgba(255,255,255,0.08)":"transparent"} strokeWidth="0.6"/>
          <circle cx="97" cy={54+i*26} r="5" fill="rgba(255,255,255,0.06)"/>
          <text x="97" y={56+i*26} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="4">{o.n[0].toUpperCase()}</text>
          <text x="106" y={52+i*26} fill="rgba(255,255,255,0.7)" fontSize="5.5" fontWeight="600">{o.n}</text>
          <text x="106" y={58+i*26} fill="rgba(255,255,255,0.3)" fontSize="4">{o.a} · {o.r}</text>
          <rect x="180" y={46+i*26} width="18" height="10" rx="3"
            fill={o.s==="BUY"?"rgba(34,197,94,0.12)":"rgba(239,68,68,0.12)"}
            stroke={o.s==="BUY"?"rgba(34,197,94,0.25)":"rgba(239,68,68,0.25)"} strokeWidth="0.5"/>
          <text x="189" y={53+i*26} textAnchor="middle"
            fill={o.s==="BUY"?"#4ade80":"#f87171"} fontSize="4.5" fontWeight="700">{o.s}</text>
        </g>
      ))}
      {/* Status bar */}
      <circle cx="18" cy="133" r="2.5" fill="#22c55e"/>
      <text x="24" y="135" fill="rgba(255,255,255,0.25)" fontSize="4">3 orders in progress · INR corridor active</text>
    </svg>
  );
}
