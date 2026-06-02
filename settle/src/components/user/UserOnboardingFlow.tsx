"use client";

/**
 * UserOnboardingFlow — shown once to new users AFTER they sign in/up.
 * Flow: Welcome → Feature 1 → Feature 2 → Feature 3 → PIN → Done
 * White/light theme. After final step, onComplete() is called.
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Shield, Check } from "lucide-react";

/* ── Light theme tokens ───────────────────────────────────────────────── */
const ACC     = "#ffb02e";
const ACC_SOFT = "rgba(255,176,46,0.14)";
const ACC_BD   = "rgba(255,176,46,0.32)";
const BG      = "#ffffff";
const SURFACE = "#f4f3f1";
const HAIR    = "rgba(20,21,26,0.08)";
const HAIR2   = "rgba(20,21,26,0.14)";
const TEXT    = "#14151a";
const MUTED   = "#80828c";

/* ── Animation ────────────────────────────────────────────────────────── */
const EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];
const screenAnim = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0 },
  exit:    { opacity: 0, x: -24 },
  transition: { duration: 0.32, ease: EASE },
};

/* ── Hero SVG illustrations ───────────────────────────────────────────── */
function HeroGlobe() {
  return (
    <svg viewBox="0 0 320 220" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="g1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={ACC} stopOpacity="0.18" />
          <stop offset="100%" stopColor={ACC} stopOpacity="0" />
        </radialGradient>
        <clipPath id="c1"><ellipse cx="160" cy="110" rx="88" ry="88" /></clipPath>
      </defs>
      <ellipse cx="160" cy="110" rx="110" ry="110" fill="url(#g1)" />
      <ellipse cx="160" cy="110" rx="88" ry="88" fill="none" stroke={HAIR2} strokeWidth="1" />
      {[-40,-20,0,20,40].map((lat, i) => {
        const y = 110 + (lat/90)*88*0.55;
        const rx2 = Math.sqrt(Math.max(0, 88*88 - (y-110)*(y-110)/0.3025));
        return <ellipse key={i} cx="160" cy={y} rx={rx2*0.9} ry={Math.abs(rx2*0.3)}
          fill="none" stroke={lat===0 ? HAIR2 : HAIR} strokeWidth={lat===0?0.9:0.5} clipPath="url(#c1)" />;
      })}
      {[0,30,60,90,120,150].map((lon, i) => (
        <ellipse key={i} cx="160" cy="110"
          rx={Math.abs(88*Math.sin(lon*Math.PI/180))*0.9} ry={88}
          fill="none" stroke={HAIR} strokeWidth="0.5" clipPath="url(#c1)" />
      ))}
      {[{cx:200,cy:92},{cx:185,cy:80},{cx:130,cy:100},{cx:115,cy:115},{cx:220,cy:120}].map((d,i)=>(
        <g key={i}>
          <circle cx={d.cx} cy={d.cy} r={i<2?7:5} fill={ACC_SOFT} />
          <circle cx={d.cx} cy={d.cy} r={i<2?3.5:2.5} fill={i<2?ACC:"rgba(20,21,26,0.4)"} />
        </g>
      ))}
      <path d="M200 92 Q192 60 185 80" stroke={ACC} strokeWidth="1.4" strokeDasharray="5 5" fill="none" opacity="0.7" />
      <path d="M200 92 Q162 62 130 100" stroke={ACC} strokeWidth="0.9" strokeDasharray="4 7" fill="none" opacity="0.4" />
    </svg>
  );
}

function HeroInstant() {
  return (
    <svg viewBox="0 0 320 220" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="g2" cx="50%" cy="55%" r="40%">
          <stop offset="0%" stopColor={ACC} stopOpacity="0.22" />
          <stop offset="100%" stopColor={ACC} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="120" rx="100" ry="80" fill="url(#g2)" />
      <rect x="65" y="52" width="62" height="110" rx="12" fill="rgba(20,21,26,0.04)" stroke={HAIR2} strokeWidth="0.8" />
      <rect x="71" y="60" width="50" height="94" rx="8" fill="rgba(20,21,26,0.02)" />
      <rect x="87" y="56" width="18" height="4" rx="2" fill="rgba(20,21,26,0.12)" />
      <rect x="78" y="80" width="36" height="6" rx="3" fill="rgba(20,21,26,0.08)" />
      <rect x="78" y="108" width="36" height="10" rx="4" fill={ACC} opacity="0.9" />
      <text x="96" y="116" textAnchor="middle" fill="#fff" fontSize="6" fontWeight="800">Send</text>
      <g>
        <line x1="138" y1="107" x2="182" y2="107" stroke={ACC} strokeWidth="2" />
        <polygon points="182,103 190,107 182,111" fill={ACC} />
        <circle cx="164" cy="107" r="12" fill={ACC_SOFT} />
        <path d="M158 107 L164 101 L170 107" fill="none" stroke={ACC} strokeWidth="2" strokeLinecap="round" />
        <path d="M164 101 L164 113" stroke={ACC} strokeWidth="2" strokeLinecap="round" />
      </g>
      <rect x="193" y="52" width="62" height="110" rx="12" fill="rgba(20,21,26,0.04)" stroke={HAIR2} strokeWidth="0.8" />
      <rect x="199" y="60" width="50" height="94" rx="8" fill="rgba(20,21,26,0.02)" />
      <rect x="214" y="56" width="18" height="4" rx="2" fill="rgba(20,21,26,0.12)" />
      <circle cx="224" cy="95" r="18" fill="rgba(16,185,129,0.12)" stroke="rgba(16,185,129,0.35)" strokeWidth="1" />
      <path d="M216 95 L221 100 L232 88" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <text x="224" y="120" textAnchor="middle" fill={MUTED} fontSize="6" fontWeight="700">₹42,000</text>
      <text x="224" y="130" textAnchor="middle" fill="rgba(20,21,26,0.3)" fontSize="5">Received · 0.8s</text>
    </svg>
  );
}

function HeroBestRate() {
  const bars = [{label:"Blip",val:97,hi:true},{label:"WazirX",val:78,hi:false},{label:"Binance",val:65,hi:false}];
  return (
    <svg viewBox="0 0 320 220" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="g3" cx="50%" cy="60%" r="45%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="130" rx="110" ry="70" fill="url(#g3)" />
      {bars.map((b,i)=>{
        const x=72+i*66, maxH=110, h=(b.val/100)*maxH, y=155-h;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={44} height={h} rx="8"
              fill={b.hi?ACC:"rgba(20,21,26,0.07)"} stroke={b.hi?ACC_BD:HAIR} strokeWidth="0.8" opacity={b.hi?1:0.9} />
            {b.hi && <circle cx={x+22} cy={y-12} r="9" fill={ACC_SOFT} />}
            {b.hi && <path d={`M${x+17} ${y-12} L${x+21} ${y-8} L${x+27} ${y-16}`}
              stroke={ACC} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
            <text x={x+22} y="172" textAnchor="middle" fill={b.hi?TEXT:MUTED} fontSize="8" fontWeight={b.hi?"800":"600"}>{b.label}</text>
          </g>
        );
      })}
      <rect x="108" y="30" width="104" height="26" rx="13" fill={ACC_SOFT} stroke={ACC_BD} strokeWidth="0.8" />
      <text x="160" y="47" textAnchor="middle" fill={ACC} fontSize="12" fontWeight="800">₹102.50 / USDT</text>
    </svg>
  );
}

function HeroSecurity() {
  return (
    <svg viewBox="0 0 320 220" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="g4" cx="50%" cy="55%" r="40%">
          <stop offset="0%" stopColor="rgba(59,130,246,0.25)" />
          <stop offset="100%" stopColor="rgba(59,130,246,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="120" rx="110" ry="80" fill="url(#g4)" />
      <path d="M160 40 L200 56 L200 100 C200 128 182 148 160 158 C138 148 120 128 120 100 L120 56 Z"
        fill="rgba(59,130,246,0.08)" stroke="rgba(59,130,246,0.4)" strokeWidth="1.5" />
      <path d="M160 52 L192 64 L192 100 C192 122 178 139 160 148 C142 139 128 122 128 100 L128 64 Z"
        fill="rgba(59,130,246,0.06)" stroke="rgba(59,130,246,0.22)" strokeWidth="0.8" />
      <path d="M148 98 L156 106 L172 87" stroke="rgba(59,130,246,0.9)" strokeWidth="3"
        strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="144" y="118" width="32" height="24" rx="5" fill="rgba(20,21,26,0.05)" stroke="rgba(59,130,246,0.35)" strokeWidth="1" />
      <path d="M152 118 L152 112 A8 8 0 0 1 168 112 L168 118" fill="none" stroke="rgba(59,130,246,0.35)" strokeWidth="1.5" />
      <circle cx="160" cy="129" r="3" fill="rgba(59,130,246,0.7)" />
      <rect x="104" y="170" width="112" height="24" rx="12" fill={SURFACE} stroke={HAIR} strokeWidth="0.8" />
      <text x="160" y="186" textAnchor="middle" fill={MUTED} fontSize="9" fontWeight="700" letterSpacing="0.06em">ON-CHAIN ESCROW</text>
    </svg>
  );
}

/* ── Progress dots ────────────────────────────────────────────────────── */
function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{
          height: 6, width: i === step ? 20 : 6, borderRadius: 999,
          background: i === step ? TEXT : HAIR2,
          transition: "width 0.3s ease",
        }} />
      ))}
    </div>
  );
}

/* ── CTA button ───────────────────────────────────────────────────────── */
function CTA({ label, ghost, onClick, icon }: { label: string; ghost?: boolean; onClick?: () => void; icon?: React.ReactNode }) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} style={{
      width: "100%", padding: "19px", borderRadius: 18,
      border: ghost ? `1px solid ${HAIR2}` : "none",
      background: ghost ? "transparent" : TEXT,
      color: ghost ? MUTED : "#fff",
      fontFamily: "inherit", fontWeight: 800, fontSize: 16.5,
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
      boxShadow: ghost ? "none" : "0 10px 28px rgba(20,21,26,0.18)",
      letterSpacing: "-0.01em",
    }}>
      {label}{icon}
    </motion.button>
  );
}

/* ── Keypad ───────────────────────────────────────────────────────────── */
function Keypad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ["1","2","3","4","5","6","7","8","9","","0","del"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", rowGap: 4, width: "100%", maxWidth: 320 }}>
      {keys.map((k, i) => (
        <button key={i} disabled={k===""} onClick={() => k && onKey(k)} style={{
          height: 58, border: "none", background: "transparent", color: TEXT,
          fontFamily: "inherit", fontWeight: 600, fontSize: 26,
          cursor: k===""?"default":"pointer",
          display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12,
        }}>
          {k==="del" ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 5H8L2 12l6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="M17 9l-5 6M12 9l5 6"/>
            </svg>
          ) : k}
        </button>
      ))}
    </div>
  );
}

/* ── Hero image wrapper ───────────────────────────────────────────────── */
function HeroBox({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
      style={{
        position: "relative", height: 220, borderRadius: 26, overflow: "hidden",
        background: SURFACE, border: `1px solid ${HAIR}`,
        boxShadow: "0 8px 24px rgba(20,21,26,0.08)",
        marginTop: 12,
      }}>
      {children}
    </motion.div>
  );
}

/* ── Welcome screen ───────────────────────────────────────────────────── */
function ScreenWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "32px 22px 30px" }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}
        style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg viewBox="0 0 70 60" width={14} height={12} fill="none">
          <path d="M4 36 L16 36 L25 8 L38 52 L47 28 L66 28" stroke={ACC} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: ACC }}>Blip</span>
      </motion.div>

      <HeroBox><HeroGlobe /></HeroBox>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }} style={{ marginTop: 24 }}>
        <div style={{ fontFamily: "'Georgia','Cambria',serif", fontSize: 48, lineHeight: 1.02, letterSpacing: "-0.01em", color: TEXT }}>
          <span style={{ display: "block" }}>Money that</span>
          <span style={{ display: "block", fontStyle: "italic" }}>moves.</span>
        </div>
        <div style={{ color: MUTED, fontSize: 15, fontWeight: 600, marginTop: 14, lineHeight: 1.55, maxWidth: 300 }}>
          Pay anyone, get the best rate, settle instantly — one wallet for everything money.
        </div>
      </motion.div>

      <div style={{ flex: 1 }} />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.25 }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CTA label="Get started" onClick={onNext} icon={<ChevronRight size={18} strokeWidth={2.5} />} />
        <button onClick={onNext} style={{
          width: "100%", padding: "15px", borderRadius: 18, border: "none",
          background: "transparent", color: MUTED,
          fontFamily: "inherit", fontWeight: 700, fontSize: 15, cursor: "pointer",
        }}>
          Skip for now
        </button>
      </motion.div>
    </div>
  );
}

/* ── Feature screens ──────────────────────────────────────────────────── */
interface FeatureProps { step: number; num: string; badge: string; title: string; ital: string; body: string; hero: React.ReactNode; last?: boolean; onNext: () => void; onBack: () => void; }
function ScreenFeature({ step, num, badge, title, ital, body, hero, last, onNext, onBack }: FeatureProps) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 22px 0" }}>
        <button onClick={onBack} style={{ width: 40, height: 40, borderRadius: 999, border: `1px solid ${HAIR2}`, background: SURFACE, color: TEXT, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <Dots step={step - 1} total={4} />
        <span style={{ width: 40 }} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "0 22px 26px" }}>
        <HeroBox>
          {hero}
          <div style={{ position: "absolute", top: 14, left: 14, display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 999, background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)" }}>
            <span style={{ fontFamily: "'Georgia',serif", fontSize: 20, fontWeight: 700, lineHeight: 1, color: TEXT }}>{num}</span>
            <span style={{ width: 4, height: 4, borderRadius: 999, background: ACC }} />
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em", color: TEXT }}>{badge}</span>
          </div>
        </HeroBox>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} style={{ marginTop: 24 }}>
          <div style={{ fontFamily: "'Georgia','Cambria',serif", fontSize: 38, lineHeight: 1.1, letterSpacing: "-0.01em", color: TEXT }}>
            <span style={{ display: "block" }}>{title}</span>
            <span style={{ display: "block", fontStyle: "italic" }}>{ital}</span>
          </div>
          <div style={{ color: MUTED, fontSize: 15, fontWeight: 600, marginTop: 14, lineHeight: 1.55, maxWidth: 330 }}>{body}</div>
        </motion.div>

        <div style={{ flex: 1 }} />
        <CTA label={last ? "Set up my PIN" : "Next"} onClick={onNext} icon={<ChevronRight size={18} strokeWidth={2.5} />} />
      </div>
    </div>
  );
}

/* ── PIN screen ───────────────────────────────────────────────────────── */
function ScreenPin({ onNext }: { onNext: () => void }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [phase, setPhase] = useState<"enter"|"confirm">("enter");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const onKey = useCallback((k: string) => {
    if (phase === "enter") {
      if (k === "del") { setPin(p => p.slice(0,-1)); return; }
      if (pin.length >= 6) return;
      const next = pin + k;
      setPin(next);
      if (next.length === 6) setTimeout(() => setPhase("confirm"), 350);
    } else {
      if (k === "del") { setConfirmPin(p => p.slice(0,-1)); return; }
      if (confirmPin.length >= 6) return;
      const next = confirmPin + k;
      setConfirmPin(next);
      if (next.length === 6) {
        if (next === pin) {
          try { localStorage.setItem("blip_onb_pin", pin); } catch {}
          setTimeout(onNext, 350);
        } else {
          setShake(true); setError("PINs don't match — try again");
          setTimeout(() => { setShake(false); setConfirmPin(""); setError(""); }, 700);
        }
      }
    }
  }, [pin, confirmPin, phase, onNext]);

  const currentPin = phase === "enter" ? pin : confirmPin;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "center", padding: "20px 22px 0" }}>
        <Dots step={4} total={5} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 22px 14px", alignItems: "center" }}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ marginTop: 14, textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", background: SURFACE, border: `1px solid ${HAIR2}`, color: TEXT }}>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
            </svg>
          </div>
          <div style={{ fontFamily: "'Georgia','Cambria',serif", fontSize: 32, lineHeight: 1.14, letterSpacing: "-0.01em", color: TEXT }}>
            <span style={{ display: "block" }}>{phase === "enter" ? "Create a" : "Confirm your"}</span>
            <span style={{ display: "block", fontStyle: "italic" }}>passcode.</span>
          </div>
          <div style={{ color: MUTED, fontSize: 14, fontWeight: 600, marginTop: 14 }}>
            {phase === "enter" ? "6 digits to secure every payment." : "Enter the same 6 digits again."}
          </div>
        </motion.div>

        <motion.div animate={shake ? { x: [-6,6,-6,6,0] } : { x: 0 }} transition={{ duration: 0.35 }} style={{ display: "flex", gap: 16, marginTop: 28 }}>
          {Array.from({length:6}).map((_,i) => (
            <span key={i} style={{ width: 16, height: 16, borderRadius: 999, background: i < currentPin.length ? TEXT : "transparent", border: `2px solid ${i < currentPin.length ? TEXT : HAIR2}`, transition: "background 0.15s" }} />
          ))}
        </motion.div>

        {error && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 12, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>{error}</motion.div>}

        <div style={{ flex: 1 }} />
        <Keypad onKey={onKey} />
      </div>
    </div>
  );
}

/* ── All set screen ───────────────────────────────────────────────────── */
function ScreenDone({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "30px 22px", textAlign: "center" }}>
        <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 280, damping: 20, delay: 0.1 }}
          style={{ width: 92, height: 92, borderRadius: 999, background: TEXT, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 20px 44px rgba(20,21,26,0.20)" }}>
          <Check size={42} strokeWidth={2.8} />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.3 }} style={{ marginTop: 24 }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em", color: TEXT }}>You&apos;re all set</div>
          <div style={{ color: MUTED, fontSize: 15, fontWeight: 600, marginTop: 9, lineHeight: 1.5, maxWidth: 270 }}>
            Your Blip wallet is ready. Let&apos;s make your first payment.
          </div>
        </motion.div>

        {/* Best rates promo */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.45 }}
          style={{ marginTop: 28, width: "100%", display: "flex", alignItems: "center", gap: 13, padding: "14px 16px", borderRadius: 18, background: ACC_SOFT, border: `1px solid ${ACC_BD}`, textAlign: "left" }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: ACC, color: "#fff" }}>
            <Shield size={18} strokeWidth={2.2} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: TEXT, letterSpacing: "-0.01em" }}>Best rates — beat it &amp; we match it</div>
            <div style={{ color: MUTED, fontSize: 12, fontWeight: 600, marginTop: 2 }}>Find a better rate anywhere — we&apos;ll match it</div>
          </div>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4, delay: 0.5 }} style={{ padding: "0 22px 30px" }}>
        <CTA label="Start paying" onClick={onNext} icon={<ChevronRight size={18} strokeWidth={2.5} />} />
      </motion.div>
    </div>
  );
}

/* ── Main export ──────────────────────────────────────────────────────── */
export interface UserOnboardingFlowProps {
  onComplete: () => void;
}

const SCREENS = ["welcome", "f1", "f2", "f3", "pin", "done"] as const;
type StepKey = typeof SCREENS[number];

export function UserOnboardingFlow({ onComplete }: UserOnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const next = useCallback(() => setStep(s => Math.min(s + 1, SCREENS.length - 1)), []);
  const back = useCallback(() => setStep(s => Math.max(s - 1, 0)), []);
  const key = SCREENS[step] as StepKey;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: BG, display: "flex", flexDirection: "column",
      fontFamily: "'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      WebkitFontSmoothing: "antialiased", color: TEXT, overflow: "hidden",
    }}>
      <AnimatePresence mode="wait">
        <motion.div key={key} {...screenAnim} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {key === "welcome" && <ScreenWelcome onNext={next} />}
          {key === "f1" && <ScreenFeature step={1} num="1" badge="INSTANT" title="Send & get paid in" ital="seconds." body="Pay any contact, UPI ID or QR code. Money lands instantly — any day, any time." hero={<HeroInstant />} onNext={next} onBack={back} />}
          {key === "f2" && <ScreenFeature step={2} num="2" badge="BEST RATE" title="Always the" ital="best rate." body="Best rates — beat it and we match it. We compare every exchange in real time, automatically." hero={<HeroBestRate />} onNext={next} onBack={back} />}
          {key === "f3" && <ScreenFeature step={3} num="3" badge="SECURE" title="Safe by" ital="design." body="Funds stay in escrow until settled. Two-factor and a passcode on every payment." hero={<HeroSecurity />} last onNext={next} onBack={back} />}
          {key === "pin"  && <ScreenPin onNext={next} />}
          {key === "done" && <ScreenDone onNext={onComplete} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
