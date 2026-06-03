"use client";

import { useState, useEffect, useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type InstallState = "unavailable" | "ready" | "installing" | "installed";
const E = [0.16, 1, 0.3, 1] as const;

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
      position: "absolute", inset: 0, background: "#f5f5f7",
      overflowY: "auto", overflowX: "hidden",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "-apple-system, 'SF Pro Display', BlinkMacSystemFont, sans-serif",
    }}>

      {/* Subtle grid */}
      <div aria-hidden style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        backgroundImage: "radial-gradient(rgba(20,21,26,0.06) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }} />


      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 900, padding: "40px 24px 40px", display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* Logo */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}
          style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 52 }}>
          <svg viewBox="0 0 70 60" width={16} height={14} fill="none">
            <path d="M4 36 L16 36 L25 8 L38 52 L47 28 L66 28" stroke="#14151a" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 400, letterSpacing: "0.01em", color: "rgba(20,21,26,0.45)" }}>Blip Money</span>
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: E, delay: 0.08 }}
          style={{ fontSize: "clamp(40px, 7vw, 80px)", fontWeight: 600, letterSpacing: "-0.055em",
            lineHeight: 0.95, color: "#14151a", textAlign: "center", margin: "0 0 18px" }}
        >
          Two apps.<br/>
          <span style={{ color: "rgba(20,21,26,0.22)" }}>One network.</span>
        </motion.h1>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.2 }}
          style={{ fontSize: 15, color: "rgba(20,21,26,0.45)", textAlign: "center",
            lineHeight: 1.65, letterSpacing: "-0.01em", maxWidth: 320, marginBottom: 52 }}>
          Send money or run a merchant desk — same settlement layer beneath both.
        </motion.p>

        {/* Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: E, delay: 0.28 }}
          style={{
            display: "flex", gap: 14,
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "flex-start",
            justifyContent: "center",
          }}
        >
          <Card
            inverted={true}
            index="01"
            eyebrow="For users"
            title="Send money to anyone"
            description="Real merchants compete on rate. Escrow on-chain. Settled in seconds."
            mockup={<PhoneMockup inverted={true} />}
            onInstall={state === "ready" ? install : undefined}
            installHref="/?welcome=skip"
          />
          <Card
            inverted
            index="02"
            eyebrow="For merchants"
            title="Run a desk. Earn every fill."
            description="Set your rate, take the order, lock escrow. Live order book, one screen."
            mockup={<LaptopMockup inverted />}
            installHref="/merchant/login?install=1"
          />
        </motion.div>

        {/* Coming soon */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }}
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 44, flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(20,21,26,0.25)" }}>Coming soon</span>
          <span style={{ width: 1, height: 10, background: "rgba(20,21,26,0.12)", display: "inline-block" }} />
          {["Native iOS & Android", "Telegram Bot", "Developer API"].map(l => (
            <span key={l} style={{ fontSize: 11, color: "rgba(20,21,26,0.35)", padding: "3px 10px", borderRadius: 99, border: "1px solid rgba(20,21,26,0.12)" }}>{l}</span>
          ))}
        </motion.div>
      </div>

      <div style={{ position: "absolute", bottom: 18, fontSize: 9, letterSpacing: "0.08em", color: "rgba(20,21,26,0.2)", fontFamily: "var(--font-mono), monospace" }}>
        © 2026 Blip Money
      </div>
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({ inverted, index, eyebrow, title, description, mockup, onInstall, installHref }: {
  inverted: boolean; index: string; eyebrow: string; title: string;
  description: string; mockup: React.ReactNode;
  onInstall?: () => void; installHref?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0); const my = useMotionValue(0);
  const rx = useSpring(mx, { stiffness: 120, damping: 18 });
  const ry = useSpring(my, { stiffness: 120, damping: 18 });
  const onMove = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    mx.set(((e.clientY - r.top) / r.height - 0.5) * -5);
    my.set(((e.clientX - r.left) / r.width - 0.5) * 5);
  };

  const bg      = inverted ? "#fff"                        : "#0d0d0d";
  const fg      = inverted ? "#000"                        : "#fff";
  const sub     = inverted ? "rgba(0,0,0,0.38)"            : "rgba(255,255,255,0.3)";
  const border  = inverted ? "1px solid rgba(0,0,0,0.06)"  : "1px solid rgba(255,255,255,0.07)";
  const divider = inverted ? "rgba(0,0,0,0.06)"            : "rgba(255,255,255,0.05)";
  const eyeC    = inverted ? "rgba(0,0,0,0.35)"            : "rgba(255,255,255,0.25)";
  const idxC    = inverted ? "rgba(0,0,0,0.15)"            : "rgba(255,255,255,0.1)";
  const mockBg  = inverted ? "rgba(0,0,0,0.03)"            : "rgba(255,255,255,0.025)";

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={() => { mx.set(0); my.set(0); }}
      whileHover={{ y: -5, scale: 1.008 }}
      transition={{ type: "spring", stiffness: 280, damping: 26 }}
      style={{
        rotateX: rx, rotateY: ry, transformStyle: "preserve-3d",
        width: "min(340px, 88vw)", background: bg, border, borderRadius: 22,
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: inverted
          ? "0 24px 60px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.6)"
          : "0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
      }}
    >
      {/* Mockup area */}
      <div style={{
        height: 186, display: "flex", alignItems: "center", justifyContent: "center",
        background: mockBg, borderBottom: `1px solid ${divider}`,
      }}>
        {mockup}
      </div>

      {/* Content */}
      <div style={{ padding: "20px 22px 18px", display: "flex", flexDirection: "column", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono), monospace", color: idxC }}>{index}</span>
          <span style={{ width: 1, height: 10, background: divider, display: "inline-block" }} />
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: eyeC }}>{eyebrow}</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.2, color: fg, marginBottom: 8 }}>{title}</div>
        <p style={{ fontSize: 12.5, lineHeight: 1.65, color: sub, marginBottom: 18, flex: 1 }}>{description}</p>

        {/* Platform download badges */}
        <div style={{ borderTop: `1px solid ${divider}`, paddingTop: 14 }}>
          <div style={{ fontSize: 9, color: sub, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10, fontWeight: 600 }}>
            Download for
          </div>
          <PlatformBadges inverted={inverted} onInstall={onInstall} openHref={installHref} />
        </div>
      </div>
    </motion.div>
  );
}

// ─── Platform Badges ─────────────────────────────────────────────────────────

function PlatformBadges({ inverted, onInstall, openHref }: {
  inverted: boolean;
  onInstall?: () => void;
  openHref?: string;
}) {
  // All platform buttons trigger the same PWA install or open the app URL.
  // The icons help users recognise their own device.
  const install = onInstall ?? (() => { if (openHref) window.location.href = openHref; });
  const userAppHref = openHref ?? "/?welcome=skip";
  const marketHref = "/merchant/login?install=1";

  if (!inverted) {
    // User app — phone/tablet/web
    return (
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <DownloadBadge icon={<IphoneIcon />} top="iPhone" bottom="App Store" dark onClick={install} />
        <DownloadBadge icon={<AndroidIcon />} top="Android" bottom="Google Play" dark onClick={install} />
        <DownloadBadge icon={<GlobeIcon />} top="Browser" bottom="Open web app" dark={false} href={userAppHref} />
      </div>
    );
  }
  // Market app — desktop
  return (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
      <DownloadBadge icon={<AppleIcon />} top="macOS" bottom="Mac app" dark={false} href={marketHref} />
      <DownloadBadge icon={<WindowsIcon />} top="Windows" bottom="Web app" dark={false} href={marketHref} />
      <DownloadBadge icon={<GlobeIcon />} top="Browser" bottom="Open web app" dark={false} href="/merchant" />
    </div>
  );
}

function DownloadBadge({ icon, top, bottom, dark, onClick, href }: {
  icon: React.ReactNode; top: string; bottom: string; dark: boolean;
  onClick?: () => void; href?: string;
}) {
  const bg = dark ? "#fff"                    : "rgba(255,255,255,0.06)";
  const bd = dark ? "none"                    : "1px solid rgba(255,255,255,0.1)";
  const fg = dark ? "#000"                    : "rgba(255,255,255,0.7)";
  const fg2 = dark ? "rgba(0,0,0,0.5)"       : "rgba(255,255,255,0.35)";

  const inner = (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      padding: "7px 12px 7px 10px", borderRadius: 10,
      background: bg, border: bd, cursor: "pointer",
      transition: "opacity 0.15s",
    }}>
      <div style={{ width: 20, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: fg }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 8, fontWeight: 500, color: fg2, letterSpacing: "0.03em", lineHeight: 1, marginBottom: 2 }}>{top}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: fg, letterSpacing: "-0.02em", lineHeight: 1 }}>{bottom}</div>
      </div>
    </div>
  );

  if (href) return <a href={href} style={{ textDecoration: "none" }}>{inner}</a>;
  return <button onClick={onClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>{inner}</button>;
}

function IphoneIcon() {
  return (
    <svg width="14" height="20" viewBox="0 0 14 20" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <rect x="1" y="1" width="12" height="18" rx="3"/>
      <rect x="4.5" y="2.5" width="5" height="1.2" rx="0.6" fill="currentColor" stroke="none"/>
      <circle cx="7" cy="16.5" r="0.8" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function AndroidIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
      <path d="M1 6.5C1 5.4 1.9 4.5 3 4.5h10c1.1 0 2 .9 2 2V13c0 1.1-.9 2-2 2H3c-1.1 0-2-.9-2-2V6.5z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 4.5L3.5 2M11 4.5L12.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="5.5" cy="8.5" r="0.8" fill="currentColor"/>
      <circle cx="10.5" cy="8.5" r="0.8" fill="currentColor"/>
      <rect x="0" y="7" width="1" height="4" rx="0.5" fill="currentColor"/>
      <rect x="15" y="7" width="1" height="4" rx="0.5" fill="currentColor"/>
      <rect x="4.5" y="15" width="2" height="3" rx="1" fill="currentColor"/>
      <rect x="9.5" y="15" width="2" height="3" rx="1" fill="currentColor"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="18" viewBox="0 0 814 1000" fill="currentColor">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 405.8 5.1 255.2 5.1 160.5c0-98.7 54.1-151.1 106.6-151.1 62.2 0 103.7 40.8 165.2 40.8 53.8 0 87.8-40.8 164.8-40.8 64.4 0 118.2 52.4 118.2 52.4s-68.7 34.1-68.7 135.9c0 88.6 64.4 133.7 64.4 133.7l.1-.5zm-39.2-155.1c-26.9 33.5-73.2 64.4-101.3 64.4-2.9 0-5.8-.6-8.3-1.3 0-26.9 28-76.5 56.2-103.1 31.2-29 73.4-51 108.5-54.5 2.3 27.5-10.3 74.3-55.1 94.5z"/>
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 88 88" fill="currentColor">
      <path d="M0 12.5L36 7v29H0V12.5z"/>
      <path d="M40 6.5L88 0v36H40V6.5z"/>
      <path d="M0 48h36v29L0 71.5V48z"/>
      <path d="M40 48h48v36l-48-6.5V48z"/>
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="9"/>
      <ellipse cx="12" cy="12" rx="3.5" ry="9"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
    </svg>
  );
}

// ─── Phone Mockup ─────────────────────────────────────────────────────────────

function PhoneMockup({ inverted }: { inverted: boolean }) {
  const frame   = inverted ? "#e0e0e0" : "#1e1e20";
  const screen  = inverted ? "#f5f5f7" : "#080810";
  const text1   = inverted ? "rgba(0,0,0,0.7)"  : "rgba(255,255,255,0.7)";
  const text2   = inverted ? "rgba(0,0,0,0.3)"  : "rgba(255,255,255,0.3)";
  const card    = inverted ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)";
  const cardBd  = inverted ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.06)";
  const btnBg   = inverted ? "#000" : "#fff";
  const btnFg   = inverted ? "#fff" : "#000";
  const island  = inverted ? "#ccc" : "#000";
  const barFg   = inverted ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)";

  return (
    <motion.svg width="76" height="148" viewBox="0 0 76 148" fill="none"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: E, delay: 0.45 }}>
      {/* Body */}
      <rect x="0.5" y="0.5" width="75" height="147" rx="18.5" fill={frame} stroke={inverted ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)"} strokeWidth="1"/>
      {/* Screen */}
      <rect x="4" y="4" width="68" height="140" rx="15.5" fill={screen}/>
      {/* Dynamic island */}
      <rect x="23" y="9" width="30" height="8" rx="4" fill={island}/>
      {/* Status time */}
      <text x="12" y="13.5" fill={barFg} fontSize="5" fontWeight="700">9:41</text>
      {/* Battery */}
      <rect x="55" y="9.5" width="10" height="6" rx="1.5" stroke={barFg} strokeWidth="0.7" fill="none"/>
      <rect x="55.8" y="10.3" width="7" height="4.4" rx="1" fill={barFg}/>
      <rect x="65" y="11" width="1.5" height="3" rx="0.75" fill={barFg}/>

      {/* Balance section */}
      <text x="38" y="34" textAnchor="middle" fill={text2} fontSize="5" letterSpacing="0.1em">BALANCE</text>
      <text x="38" y="47" textAnchor="middle" fill={text1} fontSize="16" fontWeight="700" letterSpacing="-0.04em">$2,400</text>
      <text x="38" y="54" textAnchor="middle" fill={text2} fontSize="4.5">≈ ₹1,99,920</text>

      {/* Action buttons */}
      {[["Send", 12], ["Request", 30], ["Swap", 51] as [string, number]].map(([label, x], i) => (
        <g key={label as string}>
          <rect x={x as number} y="60" width="16" height="16" rx="5"
            fill={i === 0 ? btnBg : card}
            stroke={i === 0 ? "none" : cardBd} strokeWidth="0.7"/>
          <text x={(x as number) + 8} y="71" textAnchor="middle"
            fill={i === 0 ? btnFg : text2} fontSize="5" fontWeight={i === 0 ? "700" : "500"}>
            {label}
          </text>
        </g>
      ))}

      {/* Divider */}
      <line x1="12" y1="82" x2="64" y2="82" stroke={inverted ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"} strokeWidth="0.7"/>
      <text x="12" y="91" fill={text2} fontSize="4.5" letterSpacing="0.08em" fontWeight="600">RECENT</text>

      {/* Transactions */}
      {[
        { name: "Meera K.", amount: "+₹2,400", sub: "India · 2m ago", color: inverted ? "#16a34a" : "#4ade80" },
        { name: "Arjun V.", amount: "−$80.00", sub: "Dubai · 1h ago", color: text2 },
      ].map((t, i) => (
        <g key={t.name}>
          <circle cx="18" cy={102 + i * 20} r="6" fill={card}/>
          <text x="18" y={104.5 + i * 20} textAnchor="middle" fill={text2} fontSize="5">{t.name[0]}</text>
          <text x="27" y={100 + i * 20} fill={text1} fontSize="5.5" fontWeight="600">{t.name}</text>
          <text x="27" y={106 + i * 20} fill={text2} fontSize="4">{t.sub}</text>
          <text x="64" y={100 + i * 20} textAnchor="end" fill={t.color} fontSize="5.5" fontWeight="700">{t.amount}</text>
        </g>
      ))}

      {/* Home bar */}
      <rect x="26" y="138" width="24" height="3" rx="1.5" fill={inverted ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.2)"}/>
      {/* Side buttons */}
      <rect x="-1.5" y="32" width="2" height="12" rx="1" fill={inverted ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)"}/>
      <rect x="-1.5" y="50" width="2" height="9" rx="1" fill={inverted ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)"}/>
      <rect x="75.5" y="38" width="2" height="18" rx="1" fill={inverted ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)"}/>
    </motion.svg>
  );
}

// ─── Laptop Mockup ────────────────────────────────────────────────────────────

function LaptopMockup({ inverted }: { inverted: boolean }) {
  const frame   = inverted ? "#d8d8da" : "#1c1c1e";
  const screen  = inverted ? "#f0f0f2" : "#07070a";
  const text1   = inverted ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.65)";
  const text2   = inverted ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.28)";
  const rowBg   = inverted ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)";
  const rowBd   = inverted ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.06)";
  const divider = inverted ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.05)";
  const buyC    = inverted ? "#15803d" : "#4ade80";
  const sellC   = inverted ? "#b91c1c" : "#f87171";
  const amber   = inverted ? "#b45309" : "#fbbf24";

  return (
    <motion.svg width="188" height="130" viewBox="0 0 188 130" fill="none"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: E, delay: 0.5 }}>
      {/* Base */}
      <rect x="14" y="118" width="160" height="8" rx="2" fill={frame} stroke={inverted ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.08)"} strokeWidth="0.8"/>
      <rect x="50" y="115" width="88" height="4" rx="1.5" fill={inverted ? "#ccc" : "#111"}/>
      {/* Screen bezel */}
      <rect x="2" y="1" width="184" height="116" rx="8" fill={frame} stroke={inverted ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)"} strokeWidth="0.8"/>
      {/* Screen */}
      <rect x="8" y="7" width="172" height="104" rx="5" fill={screen}/>
      {/* Camera */}
      <circle cx="94" cy="4.5" r="1.5" fill={inverted ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.1)"}/>

      {/* Topbar */}
      <rect x="8" y="7" width="172" height="14" rx="5" fill={inverted ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.02)"}/>
      <rect x="8" y="18" x2="180" y2="18" width="172" height="0.6" fill={divider}/>
      {/* Blip wordmark */}
      <text x="16" y="16.5" fill={text1} fontSize="5" fontWeight="700" letterSpacing="0.04em">BLIP MARKET</text>
      {["Orders", "Analytics", "History"].map((t, i) => (
        <text key={t} x={76 + i * 30} y="16.5" fill={text2} fontSize="4.5">{t}</text>
      ))}
      {/* Balance pill */}
      <rect x="140" y="10" width="36" height="8" rx="3" fill={rowBg} stroke={rowBd} strokeWidth="0.5"/>
      <text x="158" y="15.5" textAnchor="middle" fill={text1} fontSize="4" fontWeight="700">$45,280</text>

      {/* Left panel */}
      <rect x="8" y="21" width="50" height="90" rx="0" fill={inverted ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.01)"}/>
      <rect x="58" y="21" width="0.6" height="90" fill={divider}/>
      <text x="15" y="32" fill={text2} fontSize="4" letterSpacing="0.1em">BALANCE</text>
      <text x="15" y="43" fill={text1} fontSize="13" fontWeight="700" letterSpacing="-0.04em">$45k</text>
      <text x="15" y="50" fill={amber} fontSize="4" fontWeight="600">↑ +$1,247 today</text>
      {/* Mini chart */}
      {[0.4, 0.6, 0.45, 0.75, 0.55, 0.7, 0.5, 0.88, 0.65].map((h, i) => (
        <rect key={i} x={15 + i * 4} y={80 - h * 20} width="2.8" height={h * 20} rx="0.8"
          fill={i === 8 ? amber : inverted ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)"}/>
      ))}
      <text x="15" y="96" fill={text2} fontSize="3.8">Last 9 days</text>
      {/* Online dot */}
      <circle cx="15" cy="106" r="2.5" fill="#22c55e"/>
      <text x="21" y="108" fill={text2} fontSize="3.8">Online · INR / AED</text>

      {/* Main — order book */}
      <text x="66" y="30" fill={text2} fontSize="4" letterSpacing="0.08em">PENDING ORDERS</text>
      {[
        { n: "parth.sol",  a: "200 USDT", r: "₹103.70", s: "BUY",  hot: true  },
        { n: "maya.eth",   a: "100 USDT", r: "₹100.30", s: "SELL", hot: false },
        { n: "arjun.x",   a: "350 USDT", r: "₹103.85", s: "BUY",  hot: false },
        { n: "sana.dxb",  a: "820 USDT", r: "AED 3.67", s: "BUY", hot: false },
      ].map((o, i) => (
        <g key={i}>
          <rect x="62" y={34 + i * 19} width="98" height="15" rx="3"
            fill={o.hot ? rowBg : "transparent"}
            stroke={o.hot ? rowBd : "transparent"} strokeWidth="0.6"/>
          <circle cx="70" cy={41.5 + i * 19} r="4" fill={rowBg}/>
          <text x="70" y={43.5 + i * 19} textAnchor="middle" fill={text2} fontSize="4">{o.n[0].toUpperCase()}</text>
          <text x="77" y={40 + i * 19} fill={text1} fontSize="5" fontWeight="500">{o.n}</text>
          <text x="77" y={46 + i * 19} fill={text2} fontSize="4">{o.a} · {o.r}</text>
          <rect x="130" y={36 + i * 19} width="14" height="8" rx="2"
            fill={o.s === "BUY" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)"}
            stroke={o.s === "BUY" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"} strokeWidth="0.5"/>
          <text x="137" y={41.5 + i * 19} textAnchor="middle"
            fill={o.s === "BUY" ? buyC : sellC} fontSize="4" fontWeight="700">{o.s}</text>
          {o.hot && (
            <rect x="147" y={36 + i * 19} width="11" height="8" rx="2"
              fill={inverted ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)"} stroke={rowBd} strokeWidth="0.5"/>
          )}
          {o.hot && <text x="152.5" y={41.5 + i * 19} textAnchor="middle" fill={text2} fontSize="4" fontWeight="600">Accept</text>}
        </g>
      ))}

      {/* Status bar */}
      <rect x="8" y="107" width="172" height="4" fill={inverted ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.015)"}/>
      <circle cx="14" cy="109" r="1.5" fill="#22c55e"/>
      <text x="18" y="110.5" fill={text2} fontSize="3.5">4 corridors active · 3 orders in progress</text>
    </motion.svg>
  );
}

// ─── Globe ────────────────────────────────────────────────────────────────────

function GlobeArt() {
  const R = 300; const cx = 400; const cy = 400; const tilt = 0.42;
  const lats = [-60, -40, -20, 0, 20, 40, 60];
  const lons = [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];
  const dots: [number, number][] = [
    [cx - R * 0.52, cy + R * 0.20], [cx + R * 0.58, cy + R * 0.08],
    [cx - R * 0.28, cy - R * 0.44], [cx + R * 0.18, cy + R * 0.52],
    [cx + R * 0.38, cy - R * 0.36],
  ];
  return (
    <motion.svg viewBox="0 0 800 800" width={760} height={760} fill="none"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 2.5, ease: "easeOut" }}>
      <defs>
        <clipPath id="gc"><circle cx={cx} cy={cy} r={R}/></clipPath>
        <radialGradient id="gf" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity="0.08"/>
          <stop offset="50%" stopColor="white" stopOpacity="0.5"/>
          <stop offset="100%" stopColor="white" stopOpacity="1"/>
        </radialGradient>
        <mask id="gm"><circle cx={cx} cy={cy} r={R} fill="url(#gf)"/></mask>
      </defs>
      <g mask="url(#gm)">
        <circle cx={cx} cy={cy} r={R} stroke="rgba(255,255,255,0.16)" strokeWidth="0.7"/>
        {lats.map((lat, i) => {
          const φ = lat * Math.PI / 180;
          const rx = Math.abs(R * Math.cos(φ)); const ry = rx * tilt;
          return <ellipse key={i} cx={cx} cy={cy + R * Math.sin(φ) * tilt} rx={rx} ry={ry}
            stroke={lat === 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)"}
            strokeWidth={lat === 0 ? 1 : 0.6} clipPath="url(#gc)"/>;
        })}
        {lons.map((lon, i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={Math.abs(R * Math.sin(lon * Math.PI / 180))} ry={R}
            stroke="rgba(255,255,255,0.06)" strokeWidth="0.6" clipPath="url(#gc)"/>
        ))}
        <line x1={cx} y1={cy-R} x2={cx} y2={cy+R} stroke="rgba(255,255,255,0.16)" strokeWidth="1" clipPath="url(#gc)"/>
        <ellipse cx={cx} cy={cy} rx={R} ry={R*tilt} stroke="rgba(255,255,255,0.16)" strokeWidth="1" clipPath="url(#gc)"/>
        <path d={`M${dots[0][0]} ${dots[0][1]} Q${cx-20} ${cy-R*0.4} ${dots[1][0]} ${dots[1][1]}`}
          stroke="rgba(210,160,90,0.45)" strokeWidth="0.9" strokeDasharray="5 6" clipPath="url(#gc)"/>
        <path d={`M${dots[2][0]} ${dots[2][1]} Q${cx+R*0.2} ${cy+R*0.1} ${dots[3][0]} ${dots[3][1]}`}
          stroke="rgba(210,160,90,0.28)" strokeWidth="0.8" strokeDasharray="4 8" clipPath="url(#gc)"/>
        <path d={`M${dots[4][0]} ${dots[4][1]} Q${cx+R*0.05} ${cy-R*0.15} ${dots[1][0]} ${dots[1][1]}`}
          stroke="rgba(210,160,90,0.18)" strokeWidth="0.7" strokeDasharray="3 9" clipPath="url(#gc)"/>
        {dots.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={5} fill="rgba(210,160,90,0.07)"/>
            <circle cx={x} cy={y} r={2.8} fill="rgba(210,160,90,0.2)"/>
            <circle cx={x} cy={y} r={1.4} fill="rgba(255,255,255,0.85)"/>
          </g>
        ))}
      </g>
    </motion.svg>
  );
}
