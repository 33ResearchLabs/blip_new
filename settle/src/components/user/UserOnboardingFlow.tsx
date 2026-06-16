"use client";

/**
 * UserOnboardingFlow — shown once to new users AFTER they sign in/up.
 * Flow: Welcome → Feature 1 → Feature 2 → Feature 3 → PIN → Done
 * White/light theme. After final step, onComplete() is called.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, Shield, Check, AtSign, X, Loader2 } from "lucide-react";
import { AppPinPad } from "@/components/app-lock/AppPinPad";
import { BlipLogo } from "@/components/shared/BlipLogo";
import { setAppPin, markSessionUnlocked, validateAppPinStrength, APP_PIN_LENGTH } from "@/lib/auth/appPin";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

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
        <BlipLogo size={16} alt="Blip" />
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
        <Dots step={step - 1} total={5} />
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

/* ── PIN screen — sets the real App Lock PIN ──────────────────────────────
 * The passcode entered here is the user's APP LOCK PIN (locks the app on
 * reopen / background, via the appPin verifier system). It is NOT the wallet
 * PIN — the wallet keeps its own separate 6-digit PIN, set later in
 * EmbeddedWalletSetup, which this flow deliberately does not touch.
 *
 * Uses the shared AppPinPad so hardware-keyboard digits + Backspace work on
 * desktop alongside on-screen taps (the pad renders its own dots/shake). */
function ScreenPin({ onConfirmed }: {
  /** Called with the confirmed PIN. The PIN is deliberately NOT persisted here
   *  — it's saved together with onboarding completion on the final "Done"
   *  action, so a refresh anywhere before then leaves nothing half-set. */
  onConfirmed: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [phase, setPhase] = useState<"enter"|"confirm">("enter");
  const [error, setError] = useState("");
  const [errorTick, setErrorTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const flash = (msg: string) => { setError(msg); setErrorTick(t => t + 1); };

  // First entry: reject weak PINs (1234 / 0000 …) before asking to confirm —
  // same strength gate the rest of the app-lock UI uses.
  const handleEnter = useCallback((val: string) => {
    const weak = validateAppPinStrength(val);
    if (weak) { flash(weak); setPin(""); return; }
    setError("");
    setPin(val);
    setPhase("confirm");
  }, []);

  // Confirm: must match the first entry. Hand the PIN up and advance (the brief
  // pause lets the filled dots register). Persistence happens on "Done".
  const handleConfirm = useCallback((val: string) => {
    if (val !== pin) { flash("Passcodes don't match — try again"); setConfirmPin(""); return; }
    setError("");
    setBusy(true);
    setTimeout(() => onConfirmed(val), 250);
  }, [pin, onConfirmed]);

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
            {phase === "enter"
              ? `${APP_PIN_LENGTH} digits to unlock the app.`
              : `Enter the same ${APP_PIN_LENGTH} digits again.`}
          </div>
        </motion.div>

        {error && (
          <motion.div key={errorTick} initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ marginTop: 16, color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
            {error}
          </motion.div>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ width: "100%", maxWidth: 320 }}>
          <AppPinPad
            value={phase === "enter" ? pin : confirmPin}
            onChange={(v) => {
              if (phase === "enter") setPin(v); else setConfirmPin(v);
              if (error) setError("");
            }}
            onComplete={phase === "enter" ? handleEnter : handleConfirm}
            length={APP_PIN_LENGTH}
            errorTick={errorTick}
            disabled={busy}
            theme="light"
          />
        </div>
      </div>
    </div>
  );
}

/* ── Username screen — claims the user's @handle (token-authed) ────────────
 * Required step before the passcode. Persists via POST /api/auth/user/username
 * (self-only, set-once). If the account already has a real (non-temporary)
 * username, the step degrades to a one-tap confirmation instead of a dead-end,
 * since the server blocks renames of an already-claimed handle. */
function ScreenUsername({ onNext, onBack, userId }: {
  onNext: () => void;
  onBack: () => void;
  userId: string | null;
}) {
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [alreadySet, setAlreadySet] = useState(false);
  const [currentUsername, setCurrentUsername] = useState("");

  // Same 4-20 / [a-zA-Z0-9_] rule the server (validateUsername) enforces.
  const formatValid = useMemo(
    () => value.length >= 4 && value.length <= 20 && /^[a-zA-Z0-9_]+$/.test(value),
    [value],
  );
  const formatError = useMemo(() => {
    if (!value) return null;
    if (value.length < 4 || value.length > 20) return "4–20 characters";
    if (!/^[a-zA-Z0-9_]+$/.test(value)) return "Letters, numbers & _ only";
    return null;
  }, [value]);

  // On mount: if a real username is already set, make this a confirmation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/auth/user/username");
        const data = await res.json();
        if (cancelled) return;
        if (data?.success) {
          const current: string = data.data?.username ?? "";
          setCurrentUsername(current);
          if (data.data?.isSet) {
            // Already committed → confirmation only.
            setAlreadySet(true);
            setValue(current);
          } else if (current && !current.startsWith("user_")) {
            // Auto-assigned a real-looking handle (e.g. Google email-derived):
            // prefill it so the user can keep or tweak it instead of a blank field.
            setValue(current);
          }
        }
      } catch {
        /* fall back to the input form */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced live availability check.
  const isOwnCurrent =
    !!currentUsername && value.toLowerCase() === currentUsername.toLowerCase();

  useEffect(() => {
    if (alreadySet || !formatValid) { setAvailable(null); setChecking(false); return; }
    // The user's own current handle is "available" to them — keeping it is
    // allowed, so skip the server check that would report it taken by themselves.
    if (isOwnCurrent) { setAvailable(true); setChecking(false); return; }
    setChecking(true);
    setAvailable(null);
    const handle = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(
          `/api/auth/user/username-availability?username=${encodeURIComponent(value)}`,
        );
        const data = await res.json();
        setAvailable(!!data?.data?.available);
      } catch {
        setAvailable(null);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [value, formatValid, alreadySet, isOwnCurrent]);

  const canContinue =
    loaded && !busy && (alreadySet || (formatValid && available === true && !checking));

  const handleContinue = useCallback(async () => {
    if (!canContinue) return;
    // Already-set (or, defensively, no userId) → nothing to persist, advance.
    if (alreadySet || !userId) { onNext(); return; }
    setBusy(true);
    setError("");
    try {
      const res = await fetchWithAuth("/api/auth/user/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.error ?? "Couldn't save username. Try again.");
        setAvailable(false);
        setBusy(false);
        return;
      }
      onNext();
    } catch {
      setError("Couldn't save username. Try again.");
      setBusy(false);
    }
  }, [canContinue, alreadySet, userId, value, onNext]);

  const borderColor =
    error || available === false ? "#dc2626"
    : available === true || alreadySet ? "#10b981"
    : HAIR2;
  const statusText =
    error ? error
    : alreadySet ? `@${value} is yours`
    : formatError ? formatError
    : checking ? "Checking availability…"
    : available === true ? (isOwnCurrent ? "Your current handle — tap Continue to keep it" : "Available")
    : available === false ? "Already taken"
    : "4–20 letters, numbers or _";
  const statusColor =
    error || available === false ? "#dc2626"
    : available === true || alreadySet ? "#10b981"
    : MUTED;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 22px 0" }}>
        <button onClick={onBack} style={{ width: 40, height: 40, borderRadius: 999, border: `1px solid ${HAIR2}`, background: SURFACE, color: TEXT, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <Dots step={3} total={5} />
        <span style={{ width: 40 }} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "12px 22px 26px" }}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} style={{ textAlign: "center" }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", background: SURFACE, border: `1px solid ${HAIR2}`, color: TEXT }}>
            <AtSign size={26} strokeWidth={1.8} />
          </div>
          <div style={{ fontFamily: "'Georgia','Cambria',serif", fontSize: 32, lineHeight: 1.14, letterSpacing: "-0.01em", color: TEXT }}>
            <span style={{ display: "block" }}>Pick your</span>
            <span style={{ display: "block", fontStyle: "italic" }}>username.</span>
          </div>
          <div style={{ color: MUTED, fontSize: 14, fontWeight: 600, marginTop: 14, lineHeight: 1.5, maxWidth: 300, marginLeft: "auto", marginRight: "auto" }}>
            {alreadySet
              ? "This is your Blip handle — how others find and pay you."
              : "This is how others find and pay you. Choose carefully — it can't be changed later."}
          </div>
        </motion.div>

        <div style={{ marginTop: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "15px 16px", borderRadius: 16, border: `1.5px solid ${borderColor}`, background: SURFACE, transition: "border-color 0.2s ease" }}>
            <span style={{ color: MUTED, fontSize: 18, fontWeight: 800, lineHeight: 1 }}>@</span>
            <input
              value={value}
              onChange={(e) => { setValue(e.target.value.trim()); setError(""); }}
              placeholder="yourname"
              maxLength={20}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={alreadySet || busy || !loaded}
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 18, fontWeight: 700, color: TEXT, fontFamily: "inherit", letterSpacing: "-0.01em" }}
            />
            {!alreadySet && formatValid && (
              checking
                ? <Loader2 size={18} className="animate-spin" style={{ color: MUTED }} />
                : available === true
                  ? <Check size={18} strokeWidth={2.6} style={{ color: "#10b981" }} />
                  : available === false
                    ? <X size={18} strokeWidth={2.6} style={{ color: "#dc2626" }} />
                    : null
            )}
            {alreadySet && <Check size={18} strokeWidth={2.6} style={{ color: "#10b981" }} />}
          </div>
          <div style={{ minHeight: 18, marginTop: 8, fontSize: 12.5, fontWeight: 600, color: statusColor }}>
            {statusText}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <motion.button
          whileTap={canContinue ? { scale: 0.97 } : undefined}
          onClick={handleContinue}
          disabled={!canContinue}
          style={{
            width: "100%", padding: "19px", borderRadius: 18, border: "none",
            background: TEXT, color: "#fff",
            fontFamily: "inherit", fontWeight: 800, fontSize: 16.5,
            cursor: canContinue ? "pointer" : "not-allowed",
            opacity: canContinue ? 1 : 0.4,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            boxShadow: canContinue ? "0 10px 28px rgba(20,21,26,0.18)" : "none",
            letterSpacing: "-0.01em", transition: "opacity 0.2s ease",
          }}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <>Continue<ChevronRight size={18} strokeWidth={2.5} /></>}
        </motion.button>
      </div>
    </div>
  );
}

/* ── All set screen ───────────────────────────────────────────────────── */
function ScreenDone({ onFinish, finishing, error }: {
  /** Saves the chosen PIN + marks onboarding complete. The single commit
   *  point for the whole flow — nothing is persisted before this. */
  onFinish: () => void;
  finishing: boolean;
  error: string;
}) {
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
        {error && (
          <div style={{ color: "#dc2626", fontSize: 13, fontWeight: 600, textAlign: "center", marginBottom: 12 }}>
            {error}
          </div>
        )}
        <motion.button
          whileTap={finishing ? undefined : { scale: 0.97 }}
          onClick={onFinish}
          disabled={finishing}
          style={{
            width: "100%", padding: "19px", borderRadius: 18, border: "none",
            background: TEXT, color: "#fff", fontFamily: "inherit", fontWeight: 800, fontSize: 16.5,
            cursor: finishing ? "default" : "pointer", opacity: finishing ? 0.7 : 1,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            boxShadow: "0 10px 28px rgba(20,21,26,0.18)", letterSpacing: "-0.01em",
          }}
        >
          {finishing ? <Loader2 size={18} className="animate-spin" /> : <>Start paying<ChevronRight size={18} strokeWidth={2.5} /></>}
        </motion.button>
      </motion.div>
    </div>
  );
}

/* ── Main export ──────────────────────────────────────────────────────── */
export interface UserOnboardingFlowProps {
  onComplete: () => void;
  /** Authenticated user id — required to persist the App Lock PIN set in the
   *  passcode step. The flow only renders when a user is signed in. */
  userId: string | null;
  /** Fired right after the App Lock PIN is saved, so the AppLockProvider can
   *  refresh its visible lock state (e.g. refreshPinStatus). */
  onPasscodeSet?: () => void;
}

const SCREENS = ["welcome", "f1", "f2", "f3", "username", "pin", "done"] as const;
type StepKey = typeof SCREENS[number];

export function UserOnboardingFlow({ onComplete, userId, onPasscodeSet }: UserOnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const next = useCallback(() => setStep(s => Math.min(s + 1, SCREENS.length - 1)), []);
  const back = useCallback(() => setStep(s => Math.max(s - 1, 0)), []);
  const key = SCREENS[step] as StepKey;

  // The PIN is collected in the passcode step but only persisted on the final
  // "Done" tap — together with onboarding completion — so a refresh anywhere
  // mid-flow leaves nothing half-saved (no PIN set without onboarding complete).
  const [chosenPin, setChosenPin] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState("");

  const handleFinish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    setFinishError("");
    try {
      if (chosenPin && userId) {
        const res = await setAppPin(userId, chosenPin);
        if (!res.ok) {
          setFinishError(res.message ?? "Couldn't save your passcode. Try again.");
          setFinishing(false);
          return;
        }
        // Mark THIS session unlocked so the lock screen doesn't immediately pop,
        // then let the provider refresh its visible state.
        markSessionUnlocked(userId);
        onPasscodeSet?.();
      }
      onComplete();
    } catch {
      setFinishError("Couldn't save your passcode. Try again.");
      setFinishing(false);
    }
  }, [finishing, chosenPin, userId, onComplete, onPasscodeSet]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      // Frame the flow as the centered phone column (like the rest of the app)
      // instead of stretching full-width on desktop. The surrounding "desk"
      // uses the same --user-frame color the app shell uses; on a phone the
      // 440px column simply fills the screen.
      background: "var(--user-frame, #080810)",
      display: "flex", justifyContent: "center",
    }}>
      <div style={{
        position: "relative", width: "100%", maxWidth: 440,
        display: "flex", flexDirection: "column",
        background: BG, color: TEXT, overflow: "hidden",
        fontFamily: "'Manrope', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
        boxShadow: "0 0 40px rgba(0,0,0,0.25)",
      }}>
      <AnimatePresence mode="wait">
        <motion.div key={key} {...screenAnim} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {key === "welcome" && <ScreenWelcome onNext={next} />}
          {key === "f1" && <ScreenFeature step={1} num="1" badge="INSTANT" title="Send & get paid in" ital="seconds." body="Pay any contact, UPI ID or QR code. Money lands instantly — any day, any time." hero={<HeroInstant />} onNext={next} onBack={back} />}
          {key === "f2" && <ScreenFeature step={2} num="2" badge="BEST RATE" title="Always the" ital="best rate." body="Best rates — beat it and we match it. We compare every exchange in real time, automatically." hero={<HeroBestRate />} onNext={next} onBack={back} />}
          {key === "f3" && <ScreenFeature step={3} num="3" badge="SECURE" title="Safe by" ital="design." body="Funds stay in escrow until settled. Two-factor and a passcode on every payment." hero={<HeroSecurity />} onNext={next} onBack={back} />}
          {key === "username" && <ScreenUsername onNext={next} onBack={back} userId={userId} />}
          {key === "pin"  && <ScreenPin onConfirmed={(p) => { setChosenPin(p); next(); }} />}
          {key === "done" && <ScreenDone onFinish={handleFinish} finishing={finishing} error={finishError} />}
        </motion.div>
      </AnimatePresence>
      </div>
    </div>
  );
}
