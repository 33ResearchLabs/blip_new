"use client";

/**
 * UserOnboardingFlow — mobile-first new-user welcome sequence.
 *
 * Flow: Welcome → Feature 1 → Feature 2 → Feature 3 → Sign-in → Done
 *
 * Renders as a full-viewport sheet in the user color scheme.
 * Each screen is animated with a slide + fade transition.
 * After the final step `onComplete` is called to advance the app.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Shield, Zap, TrendingUp, Check } from "lucide-react";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

/* ── Accent / brand tokens ─────────────────────────────────────────────── */
const ACC = "#ffb02e";        // warm amber / copper — Blip brand
const ACC_SOFT = "rgba(255,176,46,0.16)";
const ACC_BD = "rgba(255,176,46,0.36)";
const BG = "#0b0b0d";         // near-black background
const SURFACE = "rgba(255,255,255,0.055)";
const HAIR = "rgba(255,255,255,0.10)";
const HAIR2 = "rgba(255,255,255,0.17)";
const TEXT = "#f5f5f7";
const MUTED = "#8a8a90";

/* ── Slide animation ───────────────────────────────────────────────────── */
const EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];
const screenAnim = {
  initial: { opacity: 0, x: 32 },
  animate: { opacity: 1, x: 0 },
  exit:    { opacity: 0, x: -24 },
  transition: { duration: 0.32, ease: EASE },
};

/* ── Illustrations — inline SVG so no external assets needed ─────────── */

function HeroGlobe() {
  return (
    <svg viewBox="0 0 320 220" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="og-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={ACC} stopOpacity="0.22" />
          <stop offset="100%" stopColor={ACC} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="og-center" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={ACC} stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ff8a00" stopOpacity="0.7" />
        </radialGradient>
        <clipPath id="og-clip"><ellipse cx="160" cy="110" rx="88" ry="88" /></clipPath>
      </defs>

      {/* ambient glow */}
      <ellipse cx="160" cy="110" rx="110" ry="110" fill="url(#og-glow)" />

      {/* Globe outline */}
      <ellipse cx="160" cy="110" rx="88" ry="88" fill="none" stroke={HAIR2} strokeWidth="1" />

      {/* Latitude lines */}
      {[-40, -20, 0, 20, 40].map((lat, i) => {
        const y = 110 + (lat / 90) * 88 * 0.55;
        const rx2 = Math.sqrt(Math.max(0, 88 * 88 - (y - 110) * (y - 110) / 0.3025));
        return (
          <ellipse key={i} cx="160" cy={y} rx={rx2 * 0.9} ry={Math.abs(rx2 * 0.3)}
            fill="none" stroke={lat === 0 ? HAIR2 : HAIR} strokeWidth={lat === 0 ? 0.9 : 0.5}
            clipPath="url(#og-clip)" />
        );
      })}
      {/* Longitude lines */}
      {[0, 30, 60, 90, 120, 150].map((lon, i) => (
        <ellipse key={i} cx="160" cy="110"
          rx={Math.abs(88 * Math.sin(lon * Math.PI / 180)) * 0.9} ry={88}
          fill="none" stroke={HAIR} strokeWidth="0.5" clipPath="url(#og-clip)" />
      ))}

      {/* City dots — India & Dubai */}
      {[
        { cx: 200, cy: 92, label: "India" },
        { cx: 185, cy: 80, label: "Dubai" },
        { cx: 130, cy: 100, label: "Europe" },
        { cx: 115, cy: 115, label: "US" },
        { cx: 220, cy: 120, label: "SEA" },
      ].map((d, i) => (
        <g key={i}>
          <circle cx={d.cx} cy={d.cy} r={i < 2 ? 7 : 5} fill={ACC_SOFT} />
          <circle cx={d.cx} cy={d.cy} r={i < 2 ? 3.5 : 2.5} fill={i < 2 ? ACC : "rgba(255,255,255,0.55)"} />
        </g>
      ))}

      {/* Connection arcs between India & Dubai */}
      <path d="M200 92 Q192 60 185 80" stroke={ACC} strokeWidth="1.4"
        strokeDasharray="5 5" fill="none" opacity="0.8" />
      <path d="M200 92 Q162 62 130 100" stroke={ACC} strokeWidth="0.9"
        strokeDasharray="4 7" fill="none" opacity="0.5" />
      <path d="M185 80 Q150 50 115 115" stroke="rgba(255,255,255,0.3)" strokeWidth="0.7"
        strokeDasharray="3 8" fill="none" opacity="0.4" />
    </svg>
  );
}

function HeroInstant() {
  return (
    <svg viewBox="0 0 320 220" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="hi-glow" cx="50%" cy="55%" r="40%">
          <stop offset="0%" stopColor={ACC} stopOpacity="0.28" />
          <stop offset="100%" stopColor={ACC} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="120" rx="100" ry="80" fill="url(#hi-glow)" />

      {/* Phone 1 */}
      <rect x="65" y="52" width="62" height="110" rx="12" fill="rgba(255,255,255,0.06)" stroke={HAIR2} strokeWidth="0.8" />
      <rect x="71" y="60" width="50" height="94" rx="8" fill="rgba(255,255,255,0.04)" />
      <rect x="87" y="56" width="18" height="4" rx="2" fill="rgba(255,255,255,0.15)" />
      <rect x="78" y="80" width="36" height="6" rx="3" fill="rgba(255,255,255,0.12)" />
      <rect x="80" y="92" width="30" height="4" rx="2" fill="rgba(255,255,255,0.07)" />
      <rect x="78" y="108" width="36" height="10" rx="4" fill={ACC} opacity="0.9" />
      <text x="96" y="116" textAnchor="middle" fill="#0b0b0d" fontSize="6" fontWeight="800">Send</text>

      {/* Arrow with glow */}
      <g>
        <line x1="138" y1="107" x2="182" y2="107" stroke={ACC} strokeWidth="2" />
        <polygon points="182,103 190,107 182,111" fill={ACC} />
        <circle cx="164" cy="107" r="12" fill={ACC_SOFT} />
        <path d="M158 107 L164 101 L170 107" fill="none" stroke={ACC} strokeWidth="2" strokeLinecap="round" />
        <path d="M164 101 L164 113" stroke={ACC} strokeWidth="2" strokeLinecap="round" />
      </g>

      {/* Phone 2 */}
      <rect x="193" y="52" width="62" height="110" rx="12" fill="rgba(255,255,255,0.06)" stroke={HAIR2} strokeWidth="0.8" />
      <rect x="199" y="60" width="50" height="94" rx="8" fill="rgba(255,255,255,0.04)" />
      <rect x="214" y="56" width="18" height="4" rx="2" fill="rgba(255,255,255,0.15)" />

      {/* Success checkmark on phone 2 */}
      <circle cx="224" cy="95" r="18" fill="rgba(74,222,128,0.15)" stroke="rgba(74,222,128,0.4)" strokeWidth="1" />
      <path d="M216 95 L221 100 L232 88" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      <text x="224" y="120" textAnchor="middle" fill={MUTED} fontSize="6" fontWeight="700">₹42,000</text>
      <text x="224" y="130" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="5">Received · 0.8s</text>
    </svg>
  );
}

function HeroBestRate() {
  const bars = [
    { label: "Blip", val: 97, highlight: true },
    { label: "WazirX", val: 78, highlight: false },
    { label: "Binance", val: 65, highlight: false },
  ];
  return (
    <svg viewBox="0 0 320 220" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="hb-glow" cx="50%" cy="60%" r="45%">
          <stop offset="0%" stopColor="#11c98a" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#11c98a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="130" rx="110" ry="70" fill="url(#hb-glow)" />

      {bars.map((b, i) => {
        const x = 72 + i * 66;
        const maxH = 110;
        const h = (b.val / 100) * maxH;
        const y = 155 - h;
        return (
          <g key={b.label}>
            <rect x={x} y={y} width={44} height={h} rx="8"
              fill={b.highlight ? ACC : "rgba(255,255,255,0.08)"}
              stroke={b.highlight ? ACC_BD : HAIR}
              strokeWidth="0.8"
              opacity={b.highlight ? 1 : 0.8}
            />
            {b.highlight && (
              <>
                <rect x={x} y={y} width={44} height={h} rx="8"
                  fill="url(#hb-top-shine)" opacity="0.3" />
                <circle cx={x + 22} cy={y - 12} r="9" fill={ACC_SOFT} />
                <path d={`M${x+17} ${y-12} L${x+21} ${y-8} L${x+27} ${y-16}`}
                  stroke={ACC} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </>
            )}
            <text x={x + 22} y="172" textAnchor="middle" fill={b.highlight ? TEXT : MUTED}
              fontSize="8" fontWeight={b.highlight ? "800" : "600"}>{b.label}</text>
            <text x={x + 22} y={y - 4} textAnchor="middle"
              fill={b.highlight ? ACC : MUTED} fontSize="8" fontWeight="800">
              {b.highlight ? "Best" : ""}
            </text>
          </g>
        );
      })}

      {/* Rate pill */}
      <rect x="108" y="30" width="104" height="26" rx="13" fill={ACC_SOFT} stroke={ACC_BD} strokeWidth="0.8" />
      <text x="160" y="47" textAnchor="middle" fill={ACC} fontSize="12" fontWeight="800">₹102.50 / USDT</text>
    </svg>
  );
}

function HeroSecurity() {
  return (
    <svg viewBox="0 0 320 220" width="100%" height="100%" style={{ display: "block" }}>
      <defs>
        <radialGradient id="hs-glow" cx="50%" cy="55%" r="40%">
          <stop offset="0%" stopColor="rgba(100,160,255,0.30)" />
          <stop offset="100%" stopColor="rgba(100,160,255,0)" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="120" rx="110" ry="80" fill="url(#hs-glow)" />

      {/* Shield */}
      <path d="M160 40 L200 56 L200 100 C200 128 182 148 160 158 C138 148 120 128 120 100 L120 56 Z"
        fill="rgba(100,160,255,0.10)" stroke="rgba(100,160,255,0.45)" strokeWidth="1.5" />
      <path d="M160 52 L192 64 L192 100 C192 122 178 139 160 148 C142 139 128 122 128 100 L128 64 Z"
        fill="rgba(100,160,255,0.08)" stroke="rgba(100,160,255,0.25)" strokeWidth="0.8" />

      {/* Checkmark inside shield */}
      <path d="M148 98 L156 106 L172 87" stroke="rgba(100,200,255,0.9)" strokeWidth="3"
        strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* Lock at bottom */}
      <rect x="144" y="118" width="32" height="24" rx="5" fill="rgba(255,255,255,0.06)"
        stroke="rgba(100,160,255,0.4)" strokeWidth="1" />
      <path d="M152 118 L152 112 A8 8 0 0 1 168 112 L168 118" fill="none"
        stroke="rgba(100,160,255,0.4)" strokeWidth="1.5" />
      <circle cx="160" cy="129" r="3" fill="rgba(100,180,255,0.7)" />

      {/* "On-chain" label */}
      <rect x="104" y="170" width="112" height="24" rx="12" fill={SURFACE} stroke={HAIR} strokeWidth="0.8" />
      <text x="160" y="186" textAnchor="middle" fill={MUTED} fontSize="9" fontWeight="700"
        letterSpacing="0.06em">ON-CHAIN ESCROW</text>

      {/* Orbiting dots */}
      {[[110, 75], [210, 75], [105, 140], [215, 140]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={3} fill="rgba(100,180,255,0.5)" />
      ))}
    </svg>
  );
}

/* ── Progress dots ─────────────────────────────────────────────────────── */
function Dots({ step, total }: { step: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{
          height: 6,
          width: i === step ? 20 : 6,
          borderRadius: 999,
          background: i === step ? TEXT : HAIR2,
          transition: "width 0.3s ease",
        }} />
      ))}
    </div>
  );
}

/* ── CTA button ────────────────────────────────────────────────────────── */
function CTA({ label, ghost, onClick, icon }: {
  label: string; ghost?: boolean; onClick?: () => void; icon?: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      style={{
        width: "100%",
        padding: "19px",
        borderRadius: 18,
        border: ghost ? `1px solid ${HAIR2}` : "none",
        background: ghost ? "transparent" : "#fff",
        color: ghost ? "rgba(255,255,255,0.85)" : "#0b0b0d",
        fontFamily: "inherit",
        fontWeight: 800,
        fontSize: 16.5,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        boxShadow: ghost ? "none" : "0 10px 28px rgba(0,0,0,0.24)",
        letterSpacing: "-0.01em",
      }}
    >
      {label}{icon}
    </motion.button>
  );
}

/* ── Keypad for PIN ────────────────────────────────────────────────────── */
function Keypad({ onKey }: { onKey: (k: string) => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", rowGap: 4, width: "100%", maxWidth: 320 }}>
      {keys.map((k, i) => (
        <button
          key={i}
          disabled={k === ""}
          onClick={() => k && k !== "" && onKey(k)}
          style={{
            height: 58,
            border: "none",
            background: "transparent",
            color: TEXT,
            fontFamily: "inherit",
            fontWeight: 600,
            fontSize: 26,
            cursor: k === "" ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 12,
            transition: "background 0.12s",
          }}
        >
          {k === "del" ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
              stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 5H8L2 12l6 7h13a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/>
              <path d="M17 9l-5 6M12 9l5 6"/>
            </svg>
          ) : k}
        </button>
      ))}
    </div>
  );
}

/* ── Screen: Welcome ───────────────────────────────────────────────────── */
function ScreenWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "62px 22px 30px" }}>
      {/* Brand */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7 }}
        style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg viewBox="0 0 70 60" width={14} height={12} fill="none">
          <path d="M4 36 L16 36 L25 8 L38 52 L47 28 L66 28"
            stroke={ACC} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em",
          textTransform: "uppercase", color: ACC }}>Blip</span>
      </motion.div>

      {/* Hero image */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        style={{
          marginTop: 24, height: 220, borderRadius: 26, overflow: "hidden",
          background: `radial-gradient(120% 90% at 20% 15%, rgba(255,176,46,0.28) 0%, transparent 55%),
                       radial-gradient(100% 90% at 90% 90%, rgba(123,107,255,0.22) 0%, transparent 55%),
                       #161619`,
          border: `1px solid ${HAIR2}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        }}
      >
        <HeroGlobe />
      </motion.div>

      {/* Headline */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.18 }}
        style={{ marginTop: 24 }}>
        <div style={{
          fontFamily: "'Georgia', 'Cambria', serif",
          fontSize: 50, lineHeight: 1.02, letterSpacing: "-0.01em", color: TEXT,
        }}>
          <span style={{ display: "block" }}>Money that</span>
          <span style={{ display: "block", fontStyle: "italic" }}>moves.</span>
        </div>
        <div style={{
          color: "rgba(255,255,255,0.58)", fontSize: 15, fontWeight: 600,
          marginTop: 14, lineHeight: 1.55, maxWidth: 300,
        }}>
          Pay anyone, get the best rate, settle instantly — one wallet for everything money.
        </div>
      </motion.div>

      <div style={{ flex: 1 }} />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.28 }}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <CTA label="Get started" onClick={onNext}
          icon={<ChevronRight size={18} strokeWidth={2.5} />} />
        <button onClick={() => { window.location.href = "/?welcome=skip"; }} style={{
          width: "100%", padding: "15px", borderRadius: 18, border: "none",
          background: "transparent", color: "rgba(255,255,255,0.78)",
          fontFamily: "inherit", fontWeight: 700, fontSize: 15, cursor: "pointer",
        }}>
          I already have an account
        </button>
      </motion.div>
    </div>
  );
}

/* ── Screen: Feature (1-3) ─────────────────────────────────────────────── */
interface FeatureScreenProps {
  step: number; total: number; num: string; badge: string;
  title: string; ital: string; body: string;
  hero: React.ReactNode; last?: boolean;
  onNext: () => void; onBack: () => void;
}
function ScreenFeature({ step, total, num, badge, title, ital, body, hero, last, onNext, onBack }: FeatureScreenProps) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "54px 22px 0",
      }}>
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 999, border: `1px solid ${HAIR2}`,
          background: SURFACE, color: TEXT, display: "flex", alignItems: "center",
          justifyContent: "center", cursor: "pointer",
        }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <Dots step={step - 1} total={total} />
        <span style={{ width: 40, color: MUTED, fontSize: 13, fontWeight: 700,
          textAlign: "right", cursor: "pointer" }}>
          {step < total ? "Skip" : ""}
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 22px 26px" }}>
        {/* Hero image */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            position: "relative", marginTop: 12, height: 220, borderRadius: 26,
            overflow: "hidden",
            background: `radial-gradient(120% 90% at 18% 12%, rgba(255,176,46,0.18) 0%, transparent 55%),
                         radial-gradient(100% 90% at 90% 92%, rgba(123,107,255,0.14) 0%, transparent 55%),
                         rgba(255,255,255,0.04)`,
            border: `1px solid ${HAIR}`,
            boxShadow: "0 18px 44px rgba(20,22,40,0.22)",
          }}
        >
          {hero}
          {/* Floating badge */}
          <div style={{
            position: "absolute", top: 14, left: 14,
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "7px 12px", borderRadius: 999,
            background: "rgba(11,11,13,0.62)",
            backdropFilter: "blur(8px)",
            color: "#fff",
          }}>
            <span style={{
              fontFamily: "'Georgia', serif", fontSize: 22, fontWeight: 700, lineHeight: 1,
            }}>{num}</span>
            <span style={{ width: 4, height: 4, borderRadius: 999, background: ACC }} />
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.12em" }}>{badge}</span>
          </div>
        </motion.div>

        {/* Text */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          style={{ marginTop: 24 }}
        >
          <div style={{
            fontFamily: "'Georgia', 'Cambria', serif",
            fontSize: 40, lineHeight: 1.1, letterSpacing: "-0.01em", color: TEXT,
          }}>
            <span style={{ display: "block" }}>{title}</span>
            <span style={{ display: "block", fontStyle: "italic" }}>{ital}</span>
          </div>
          <div style={{
            color: MUTED, fontSize: 15, fontWeight: 600, marginTop: 14, lineHeight: 1.55, maxWidth: 330,
          }}>{body}</div>
        </motion.div>

        <div style={{ flex: 1 }} />
        <CTA
          label={last ? "Create your account" : "Next"}
          onClick={onNext}
          icon={<ChevronRight size={18} strokeWidth={2.5} />}
        />
      </div>
    </div>
  );
}

/* ── Screen: All set ───────────────────────────────────────────────────── */
function ScreenDone({ onNext }: { onNext: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "30px 22px", textAlign: "center",
      }}>
        <motion.div
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 20, delay: 0.1 }}
          style={{
            width: 92, height: 92, borderRadius: 999,
            background: "#fff",
            color: "#0b0b0d",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 20px 44px rgba(255,255,255,0.18)",
          }}
        >
          <Check size={42} strokeWidth={2.8} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          style={{ marginTop: 24 }}
        >
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>You&apos;re all set</div>
          <div style={{ color: MUTED, fontSize: 15, fontWeight: 600, marginTop: 9, lineHeight: 1.5, maxWidth: 270 }}>
            Your Blip wallet is ready. Let&apos;s make your first payment.
          </div>
        </motion.div>

        {/* Promo: Best rates — beat it and we match it */}
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          style={{
            marginTop: 28, width: "100%",
            display: "flex", alignItems: "center", gap: 13,
            padding: "14px 16px",
            borderRadius: 18,
            background: ACC_SOFT,
            border: `1px solid ${ACC_BD}`,
            textAlign: "left",
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 12, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: ACC, color: "#0b0b0d",
          }}>
            <Shield size={18} strokeWidth={2.2} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14, color: TEXT, letterSpacing: "-0.01em" }}>
              Best rates — beat it &amp; we match it
            </div>
            <div style={{ color: MUTED, fontSize: 12, fontWeight: 600, marginTop: 2 }}>
              Find a better rate anywhere — we&apos;ll match it
            </div>
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        style={{ padding: "0 22px 30px" }}
      >
        <CTA label="Start paying" onClick={onNext}
          icon={<ChevronRight size={18} strokeWidth={2.5} />} />
      </motion.div>
    </div>
  );
}

/* ── Screen: PIN setup ─────────────────────────────────────────────────── */
function ScreenPin({ onNext }: { onNext: () => void }) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [phase, setPhase] = useState<"enter" | "confirm">("enter");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);

  const onKey = useCallback((k: string) => {
    if (phase === "enter") {
      if (k === "del") { setPin(p => p.slice(0, -1)); return; }
      if (pin.length >= 6) return;
      const next = pin + k;
      setPin(next);
      if (next.length === 6) {
        setTimeout(() => setPhase("confirm"), 350);
      }
    } else {
      if (k === "del") { setConfirmPin(p => p.slice(0, -1)); return; }
      if (confirmPin.length >= 6) return;
      const next = confirmPin + k;
      setConfirmPin(next);
      if (next.length === 6) {
        if (next === pin) {
          // Save pin to localStorage for app-lock
          try {
            localStorage.setItem("blip_onb_pin", pin);
          } catch {
            // ignore
          }
          setTimeout(() => onNext(), 350);
        } else {
          setShake(true);
          setError("PINs don't match — try again");
          setTimeout(() => {
            setShake(false);
            setConfirmPin("");
            setError("");
          }, 700);
        }
      }
    }
  }, [pin, confirmPin, phase, onNext]);

  const currentPin = phase === "enter" ? pin : confirmPin;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "54px 22px 0",
      }}>
        <button
          onClick={() => {
            if (phase === "confirm") { setPhase("enter"); setConfirmPin(""); setError(""); }
          }}
          style={{
            width: 40, height: 40, borderRadius: 999, border: `1px solid ${HAIR2}`,
            background: SURFACE, color: TEXT, display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer",
            visibility: phase === "confirm" ? "visible" : "hidden",
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <Dots step={5} total={7} />
        <span style={{ width: 40 }} />
      </div>

      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        padding: "12px 22px 14px", alignItems: "center",
      }}>
        {/* Icon + title */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{ marginTop: 14, textAlign: "center" }}
        >
          <div style={{
            width: 56, height: 56, borderRadius: 18, margin: "0 auto 16px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: SURFACE, border: `1px solid ${HAIR2}`,
            color: TEXT,
          }}>
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
              <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
            </svg>
          </div>
          <div style={{
            fontFamily: "'Georgia', 'Cambria', serif",
            fontSize: 32, lineHeight: 1.14, letterSpacing: "-0.01em", color: TEXT,
          }}>
            <span style={{ display: "block" }}>
              {phase === "enter" ? "Create a" : "Confirm your"}
            </span>
            <span style={{ display: "block", fontStyle: "italic" }}>passcode.</span>
          </div>
          <div style={{ color: MUTED, fontSize: 14, fontWeight: 600, marginTop: 14 }}>
            {phase === "enter"
              ? "6 digits to secure every payment."
              : "Enter the same 6 digits again."}
          </div>
        </motion.div>

        {/* PIN dots */}
        <motion.div
          animate={shake ? { x: [-6, 6, -6, 6, 0] } : { x: 0 }}
          transition={{ duration: 0.35 }}
          style={{ display: "flex", gap: 16, marginTop: 28 }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} style={{
              width: 16, height: 16, borderRadius: 999,
              background: i < currentPin.length ? TEXT : "transparent",
              border: `2px solid ${i < currentPin.length ? TEXT : HAIR2}`,
              transition: "background 0.15s, border-color 0.15s",
            }} />
          ))}
        </motion.div>

        {error && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ marginTop: 12, color: "#f87171", fontSize: 13, fontWeight: 600 }}
          >
            {error}
          </motion.div>
        )}

        <div style={{ flex: 1 }} />

        {/* Biometric hint */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 6, marginBottom: 12, color: MUTED, fontSize: 12.5, fontWeight: 700,
        }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/>
            <path d="M12 10v4M10 12h4"/>
          </svg>
          Or enable Face ID
        </div>

        <Keypad onKey={onKey} />
      </div>
    </div>
  );
}

/* ── Screen: Sign In ───────────────────────────────────────────────────── */
interface ScreenSignInProps {
  onNext: () => void;
  onGoogleSuccess: (token: string) => void;
  handleUserLogin: () => void;
  loginForm: { username: string; password: string };
  setLoginForm: (f: { username: string; password: string }) => void;
  isLoggingIn: boolean;
  loginError: string;
  setLoginError: (e: string) => void;
  authMode: 'login' | 'register';
  setAuthMode: (m: 'login' | 'register') => void;
  handleUserRegister: () => void;
}

function ScreenSignIn({
  onNext, onGoogleSuccess, handleUserLogin, loginForm, setLoginForm,
  isLoggingIn, loginError, setLoginError, authMode, setAuthMode, handleUserRegister,
}: ScreenSignInProps) {
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = () => {
    setLoginError("");
    if (authMode === 'login') handleUserLogin();
    else handleUserRegister();
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "54px 22px 0",
      }}>
        <div style={{ width: 40 }} />
        <Dots step={4} total={7} />
        <span style={{ width: 40 }} />
      </div>

      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        padding: "24px 22px 28px",
      }}>
        {/* Headline */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div style={{
            fontFamily: "'Georgia', 'Cambria', serif",
            fontSize: 40, lineHeight: 1.1, letterSpacing: "-0.01em", color: TEXT,
            marginBottom: 6,
          }}>
            <span style={{ display: "block" }}>Let's get</span>
            <span style={{ display: "block", fontStyle: "italic" }}>you in.</span>
          </div>
        </motion.div>

        {/* Tab switcher */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          style={{
            display: "flex", gap: 0,
            background: SURFACE, borderRadius: 14,
            padding: 4, marginBottom: 20, marginTop: 10,
          }}
        >
          {(['login', 'register'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => { setAuthMode(mode); setLoginError(""); }}
              style={{
                flex: 1, padding: "9px", borderRadius: 10, border: "none",
                background: authMode === mode ? "#fff" : "transparent",
                color: authMode === mode ? "#0b0b0d" : MUTED,
                fontFamily: "inherit", fontWeight: 700, fontSize: 14,
                cursor: "pointer",
                boxShadow: authMode === mode ? "0 2px 8px rgba(0,0,0,0.20)" : "none",
                transition: "all 0.2s ease",
              }}
            >
              {mode === 'login' ? 'Sign in' : 'Register'}
            </button>
          ))}
        </motion.div>

        {/* Google button */}
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <GoogleSignInButton
            role="user"
            source="onboarding"
            onSuccess={(data) => {
              onGoogleSuccess(data);
              onNext();
            }}
            onError={(msg) => setLoginError(msg)}
            theme="dark"
          />
        </motion.div>

        {/* OR divider */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            margin: "16px 0",
          }}
        >
          <div style={{ flex: 1, height: 1, background: HAIR }} />
          <span style={{ color: MUTED, fontSize: 12, fontWeight: 700 }}>or</span>
          <div style={{ flex: 1, height: 1, background: HAIR }} />
        </motion.div>

        {/* Email + Password */}
        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <input
            type="email"
            placeholder="Email or username"
            maxLength={254}
            value={loginForm.username}
            onChange={(e) => { setLoginForm({ ...loginForm, username: e.target.value }); setLoginError(""); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            style={{
              width: "100%", padding: "15px 16px", borderRadius: 14, border: `1px solid ${HAIR2}`,
              background: SURFACE, color: TEXT, fontFamily: "inherit",
              fontSize: 15, fontWeight: 600, outline: "none", boxSizing: "border-box",
            }}
          />
          <div style={{ position: "relative" }}>
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              maxLength={100}
              value={loginForm.password}
              onChange={(e) => { setLoginForm({ ...loginForm, password: e.target.value }); setLoginError(""); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              style={{
                width: "100%", padding: "15px 46px 15px 16px", borderRadius: 14, border: `1px solid ${HAIR2}`,
                background: SURFACE, color: TEXT, fontFamily: "inherit",
                fontSize: 15, fontWeight: 600, outline: "none", boxSizing: "border-box",
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              style={{
                position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", padding: 4,
                color: MUTED,
              }}
            >
              <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                {showPassword
                  ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                  : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                }
              </svg>
            </button>
          </div>
        </motion.div>

        {/* Error */}
        {loginError && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ marginTop: 10, color: "#f87171", fontSize: 13, fontWeight: 600 }}
          >
            {loginError}
          </motion.div>
        )}

        <div style={{ flex: 1 }} />

        {/* Submit */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.28 }}
          style={{ marginTop: 16 }}
        >
          <CTA
            label={isLoggingIn ? "Please wait…" : authMode === 'login' ? "Sign in" : "Create account"}
            onClick={handleSubmit}
            icon={!isLoggingIn ? <ChevronRight size={18} strokeWidth={2.5} /> : undefined}
          />
        </motion.div>

        <button
          onClick={() => { window.location.href = "/?welcome=skip"; }}
          style={{
            width: "100%", padding: "13px", marginTop: 10,
            borderRadius: 14, border: "none", background: "transparent",
            color: "rgba(255,255,255,0.50)", fontFamily: "inherit",
            fontWeight: 600, fontSize: 14, cursor: "pointer",
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────────── */
export interface UserOnboardingFlowProps {
  onComplete: () => void;
  onGoogleSuccess?: (token: string) => void;
  handleUserLogin?: () => void;
  loginForm?: { username: string; password: string };
  setLoginForm?: (f: { username: string; password: string }) => void;
  isLoggingIn?: boolean;
  loginError?: string;
  setLoginError?: (e: string) => void;
  authMode?: 'login' | 'register';
  setAuthMode?: (m: 'login' | 'register') => void;
  handleUserRegister?: () => void;
}

const SCREENS = ["welcome", "f1", "f2", "f3", "signin", "pin", "done"] as const;
type StepKey = typeof SCREENS[number];

export function UserOnboardingFlow({
  onComplete,
  onGoogleSuccess,
  handleUserLogin,
  loginForm,
  setLoginForm,
  isLoggingIn,
  loginError,
  setLoginError,
  authMode,
  setAuthMode,
  handleUserRegister,
}: UserOnboardingFlowProps) {
  const [step, setStep] = useState<number>(0);
  // Local fallback auth state (when props not provided)
  const [localAuthMode, setLocalAuthMode] = useState<'login' | 'register'>('login');
  const [localLoginForm, setLocalLoginForm] = useState({ username: "", password: "" });
  const [localLoginError, setLocalLoginError] = useState("");

  const resolvedAuthMode = authMode ?? localAuthMode;
  const resolvedSetAuthMode = setAuthMode ?? setLocalAuthMode;
  const resolvedLoginForm = loginForm ?? localLoginForm;
  const resolvedSetLoginForm = setLoginForm ?? setLocalLoginForm;
  const resolvedLoginError = loginError ?? localLoginError;
  const resolvedSetLoginError = setLoginError ?? setLocalLoginError;
  const resolvedIsLoggingIn = isLoggingIn ?? false;

  const next = useCallback(() => setStep(s => Math.min(s + 1, SCREENS.length - 1)), []);
  const back = useCallback(() => setStep(s => Math.max(s - 1, 0)), []);

  const key = SCREENS[step];
  const isDark = key === "welcome";

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: BG,
      display: "flex", flexDirection: "column",
      fontFamily: "'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
      WebkitFontSmoothing: "antialiased",
      color: TEXT,
      overflow: "hidden",
      zIndex: 9999,
    }}>
      <AnimatePresence mode="wait">
        <motion.div key={key} {...screenAnim}
          style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {key === "welcome" && <ScreenWelcome onNext={next} />}
          {key === "f1" && (
            <ScreenFeature
              step={1} total={7} num="1" badge="INSTANT"
              title="Send & get paid in" ital="seconds."
              body="Pay any contact, UPI ID or QR code. Money lands instantly — any day, any time."
              hero={<HeroInstant />}
              onNext={next} onBack={back}
            />
          )}
          {key === "f2" && (
            <ScreenFeature
              step={2} total={7} num="2" badge="BEST RATE"
              title="Always the" ital="best rate."
              body="We compare every exchange in real time. Best rates, beat it and we match it — automatically."
              hero={<HeroBestRate />}
              onNext={next} onBack={back}
            />
          )}
          {key === "f3" && (
            <ScreenFeature
              step={3} total={7} num="3" badge="SECURE"
              title="Safe by" ital="design."
              body="Funds stay in escrow until settled. Two-factor and a passcode on every payment."
              hero={<HeroSecurity />}
              last
              onNext={next} onBack={back}
            />
          )}
          {key === "signin" && (
            <ScreenSignIn
              onNext={next}
              onGoogleSuccess={onGoogleSuccess ?? (() => {})}
              handleUserLogin={handleUserLogin ?? (() => {})}
              loginForm={resolvedLoginForm}
              setLoginForm={resolvedSetLoginForm}
              isLoggingIn={resolvedIsLoggingIn}
              loginError={resolvedLoginError}
              setLoginError={resolvedSetLoginError}
              authMode={resolvedAuthMode}
              setAuthMode={resolvedSetAuthMode}
              handleUserRegister={handleUserRegister ?? (() => {})}
            />
          )}
          {key === "pin" && <ScreenPin onNext={next} />}
          {key === "done" && <ScreenDone onNext={onComplete} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
