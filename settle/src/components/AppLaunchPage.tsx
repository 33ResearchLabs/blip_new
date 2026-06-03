"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type InstallState = "unavailable" | "ready" | "installing" | "installed";

/* ── design tokens (from styles.css) ── */
const T = {
  bg: "#ffffff",
  bgWarm: "#faf8f5",
  ink: "#100e0c",
  inkSoft: "#2c2825",
  muted: "#8a857d",
  faint: "#b6b0a7",
  line: "rgba(16,14,12,.10)",
  line2: "rgba(16,14,12,.17)",
  coral: "#d6603a",
  coralHi: "#e6794f",
  coralDeep: "#bb4d2b",
  coralSoft: "#f3d4c5",
  coralWash: "#fcefe8",
  coralGlow: "rgba(214,96,58,.14)",
  black: "#0d0c0a",
  black2: "#16140f",
  onBlack: "#f5f3ef",
  onBlackMut: "#9a958c",
  onBlackFaint: "#615c54",
  onBlackLine: "rgba(255,255,255,.09)",
  green: "#3a9e6a",
  greenLt: "#4cc98c",
  red: "#d6493f",
  font: "'Archivo', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

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

  const openApp = state === "ready" ? install : () => { window.location.href = "/?welcome=skip"; };

  return (
    <>
      {/* Google Fonts */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,400;0,600;0,700;0,800;0,900;1,400;1,600;1,700;1,800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');`}</style>

      <div style={{
        position: "absolute", inset: 0,
        background: T.bg, fontFamily: T.font,
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        WebkitFontSmoothing: "antialiased",
      }}>
        {/* radial coral glow top */}
        <div aria-hidden style={{
          position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
          background: `radial-gradient(920px 540px at 50% -8%, rgba(240,105,30,.11), transparent 62%),
                       radial-gradient(620px 520px at 100% 4%, rgba(240,105,30,.05), transparent 55%)`,
        }} />

        {/* ── NAV (dark bar) ── */}
        <nav style={{
          height: 62, flexShrink: 0,
          display: "flex", alignItems: "center", gap: 22,
          padding: "0 clamp(20px,3vw,40px)",
          background: T.black, color: T.onBlack,
          position: "relative", zIndex: 10,
        }}>
          {/* Brand — matches blip.money logo exactly */}
          <a href="/" style={{ display: "flex", alignItems: "center", gap: 6, textDecoration: "none", color: T.onBlack }}>
            <svg viewBox="0 0 70 60" height={17} style={{ width: "auto" }} fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 36 L16 36 L25 8 L38 52 L47 28 L66 28" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span style={{ fontWeight: 700, fontSize: 19, letterSpacing: "-0.04em", display: "flex", alignItems: "baseline" }}>
              <span style={{ color: "#ffffff" }}>Blip</span>
              <em style={{ fontStyle: "italic", fontWeight: 600, color: T.coral, marginLeft: 4 }}>money</em>
            </span>
          </a>

          {/* Live status */}
          <span className="blip-status" style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: T.mono, fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", color: T.onBlackMut, paddingLeft: 18, borderLeft: `1px solid ${T.onBlackLine}` }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: T.greenLt, boxShadow: `0 0 6px ${T.greenLt}` }} />
            MAINNET · LIVE
          </span>

          {/* Links */}
          <div className="blip-links" style={{ display: "flex", gap: 24, marginLeft: "auto" }}>
            {["How it works", "Network"].map(l => (
              <a key={l} href="#" style={{ color: T.onBlackMut, fontSize: 14, fontWeight: 500, textDecoration: "none" }}>{l}</a>
            ))}
          </div>

          {/* Sign in */}
          <div style={{ marginLeft: 24 }}>
            <a href="/?welcome=skip" style={{
              padding: "9px 16px", fontSize: 13.5, fontWeight: 700,
              border: `1px solid ${T.onBlackLine}`, borderRadius: 10,
              color: T.onBlackMut, background: "transparent", cursor: "pointer",
              textDecoration: "none",
            }}>Sign in</a>
          </div>
        </nav>

        {/* ── MAIN STAGE ── */}
        <div style={{
          flex: 1, minHeight: 0, position: "relative", overflow: "hidden",
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "0 clamp(24px,5vw,72px)",
          textAlign: "center", zIndex: 1,
        }}>

          {/* Decorative phone (bottom-left) */}
          <div aria-hidden className="blip-deco" style={{ position: "absolute", left: -46, bottom: -150, transform: "rotate(12deg) scale(.92)", zIndex: 1, pointerEvents: "none" }}>
            <PhoneMock />
          </div>

          {/* Decorative dashboard (bottom-right) */}
          <div aria-hidden className="blip-deco" style={{ position: "absolute", right: -70, bottom: -120, width: 420, transform: "rotate(-9deg) scale(.96)", zIndex: 1, pointerEvents: "none" }}>
            <DashMock />
          </div>

          {/* Content */}
          <div className="blip-main-content" style={{ position: "relative", zIndex: 3 }}>
            {/* Eyebrow */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginBottom: 18, fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: T.muted }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: T.coral, animation: "blipPulse 2.4s infinite" }} />
              Open liquidity network
            </div>

            {/* Headline */}
            <h1 className="blip-h1" style={{ fontWeight: 800, lineHeight: 0.92, letterSpacing: "-0.035em", fontSize: "clamp(40px,6vw,76px)", color: T.ink, margin: "0 0 0" }}>
              Two apps. <em style={{ fontStyle: "italic" }}>One network.</em>
            </h1>

            {/* Two-card chooser */}
            <div className="blip-chooser" style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20,
              maxWidth: 800, margin: "34px auto 0", textAlign: "left",
            }}>
              {/* User card */}
              <div style={{
                border: `1px solid ${T.line}`, borderRadius: 32, padding: 28,
                background: T.bg, boxShadow: "0 30px 70px -42px rgba(16,14,12,.32)",
                transition: "transform .25s, border-color .25s, box-shadow .25s",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-4px)"; (e.currentTarget as HTMLDivElement).style.borderColor = T.coralSoft; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.borderColor = T.line; }}
              >
                {/* Head */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 22, marginBottom: 22, borderBottom: `1px solid ${T.line}` }}>
                  <span style={{ width: 50, height: 50, borderRadius: 15, flexShrink: 0, display: "grid", placeItems: "center", background: "linear-gradient(150deg,#e6794f,#c0512c)", boxShadow: "0 10px 24px -10px rgba(214,96,58,.6)" }}>
                    <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l2.5-7 4 14 2.5-9 1.5 2H22"/></svg>
                  </span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 21, letterSpacing: "-0.02em", lineHeight: 1, color: T.ink }}>
                      Blip <em style={{ fontStyle: "italic", fontWeight: 600 }}>money</em>
                    </div>
                    <div style={{ color: T.muted, fontSize: 14, marginTop: 6 }}>Send &amp; receive money, anywhere</div>
                  </div>
                </div>

                {/* CTA */}
                <div style={{ fontFamily: T.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: T.faint, marginBottom: 10 }}>Use it now</div>
                <button onClick={openApp} style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                  padding: "15px 18px", borderRadius: 14, border: "none", cursor: "pointer",
                  background: T.coral, color: "#fff", fontFamily: T.font, fontWeight: 700, fontSize: 15.5, letterSpacing: "-0.01em",
                  boxShadow: `0 10px 28px -10px rgba(214,96,58,.55)`,
                }}>
                  <GlobeIcon /> Open web app
                </button>

                {/* Download */}
                <div style={{ fontFamily: T.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: T.faint, marginTop: 18, marginBottom: 10 }}>Download the app</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <PlatBtn icon="ios" label="iOS" onClick={openApp} />
                  <PlatBtn icon="android" label="Android" onClick={openApp} />
                </div>
              </div>

              {/* Market card */}
              <div style={{
                border: `1px solid ${T.line}`, borderRadius: 32, padding: 28,
                background: T.bg, boxShadow: "0 30px 70px -42px rgba(16,14,12,.32)",
                transition: "transform .25s, border-color .25s, box-shadow .25s",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-4px)"; (e.currentTarget as HTMLDivElement).style.borderColor = T.coralSoft; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.borderColor = T.line; }}
              >
                {/* Head */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 22, marginBottom: 22, borderBottom: `1px solid ${T.line}` }}>
                  <span style={{ width: 50, height: 50, borderRadius: 15, flexShrink: 0, display: "grid", placeItems: "center", background: T.black, border: "1px solid rgba(214,96,58,.4)" }}>
                    <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke={T.coral} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4v16h16M8 14l3-4 3 3 4-6"/></svg>
                  </span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 21, letterSpacing: "-0.02em", lineHeight: 1, color: T.ink }}>
                      Blip <em style={{ fontStyle: "italic", fontWeight: 600 }}>Market</em>
                    </div>
                    <div style={{ color: T.muted, fontSize: 14, marginTop: 6 }}>Run a merchant desk &amp; earn</div>
                  </div>
                </div>

                {/* CTA */}
                <div style={{ fontFamily: T.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: T.faint, marginBottom: 10 }}>Use it now</div>
                <a href="/merchant/login" style={{ textDecoration: "none" }}>
                  <button style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                    padding: "15px 18px", borderRadius: 14, border: "none", cursor: "pointer",
                    background: T.black, color: T.onBlack, fontFamily: T.font, fontWeight: 700, fontSize: 15.5, letterSpacing: "-0.01em",
                  }}>
                    <MonitorIcon /> Open web app
                  </button>
                </a>

                {/* Download */}
                <div style={{ fontFamily: T.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: T.faint, marginTop: 18, marginBottom: 10 }}>Download the app</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <PlatBtn icon="ios" label="iOS" onClick={() => {}} />
                  <PlatBtn icon="android" label="Android" onClick={() => {}} />
                  <PlatBtn icon="mac" label="Mac" onClick={() => {}} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Styles */}
        <style>{`
          @keyframes blipPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
          @media(max-width:820px){
            .blip-chooser{grid-template-columns:1fr !important;}
            .blip-deco{display:none !important;}
            .blip-links{display:none !important;}
            .blip-status{display:none !important;}
            .blip-main{overflow-y:auto !important; justify-content:flex-start !important; padding-top:32px !important;}
            .blip-h1{font-size:clamp(34px,9vw,52px) !important;}
          }
        `}</style>
      </div>
    </>
  );
}

/* ── Platform button ── */
function PlatBtn({ icon, label, onClick }: { icon: "ios"|"android"|"mac"; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
      padding: "12px 6px", borderRadius: 13, border: `1px solid ${T.line2}`,
      background: T.bgWarm, color: T.inkSoft, fontFamily: T.font, fontWeight: 600, fontSize: 13.5,
      cursor: "pointer", transition: "background .2s",
    }}>
      {icon === "ios" && <svg viewBox="0 0 24 24" width={16} height={16} fill={T.inkSoft}><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.2.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.3 5.4c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3z"/></svg>}
      {icon === "android" && <svg viewBox="0 0 24 24" width={16} height={16} fill={T.inkSoft}><path d="M17.6 9.5l1.6-2.8a.3.3 0 00-.5-.3l-1.6 2.8A9.3 9.3 0 0012 8c-1.9 0-3.7.5-5.1 1.2L5.3 6.4a.3.3 0 10-.5.3l1.6 2.8C3.6 11.1 2 13.7 2 16.7h20c0-3-1.6-5.6-4.4-7.2zM7 14.4a.9.9 0 110-1.8.9.9 0 010 1.8zm10 0a.9.9 0 110-1.8.9.9 0 010 1.8z"/></svg>}
      {icon === "mac" && <svg viewBox="0 0 24 24" width={16} height={16} fill={T.inkSoft}><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.2 0 2-1.1 2.8-2.2.9-1.3 1.2-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8zM14.3 5.4c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3z"/></svg>}
      {label}
    </button>
  );
}

function GlobeIcon() {
  return <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18 15 15 0 010-18"/></svg>;
}
function MonitorIcon() {
  return <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>;
}

/* ── Phone decoration ── */
function PhoneMock() {
  return (
    <div style={{ width: 248, borderRadius: 34, padding: 11, background: "linear-gradient(160deg,#2a241c,#0c0a07)", border: "1px solid rgba(0,0,0,.2)", boxShadow: "0 40px 80px -34px rgba(16,14,12,.55), inset 0 1px 0 rgba(255,255,255,.08)" }}>
      <div style={{ background: "#0c0a07", borderRadius: 25, padding: "16px 15px 14px", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: T.mono, fontSize: 11, color: T.onBlackMut, marginBottom: 14 }}>
          <span>9:41</span>
          <span style={{ width: 46, height: 5, borderRadius: 3, background: "rgba(255,255,255,.18)" }} />
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: "0.18em", color: T.onBlackFaint, textTransform: "uppercase" }}>Balance</div>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, marginTop: 4, color: "#fff" }}>$2,400</div>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: T.onBlackMut, marginTop: 5 }}>≈ ₹1,99,920</div>
        <div style={{ display: "flex", gap: 7, margin: "16px 0 14px" }}>
          {["Buy","Sell","Send","Scan"].map((t,i) => (
            <div key={t} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 700, padding: "9px 0", borderRadius: 11, background: i===0 ? T.coral : "rgba(255,255,255,.05)", color: i===0 ? "#fff" : T.onBlackMut }}>{t}</div>
          ))}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 9.5, letterSpacing: "0.18em", color: T.onBlackFaint, textTransform: "uppercase", margin: "4px 0 8px" }}>Recent</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid rgba(255,255,255,.05)" }}>
          <span style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, color: "#fff", background: T.coral }}>M</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>Meera K.</div>
            <div style={{ fontSize: 9.5, color: T.onBlackFaint, fontFamily: T.mono }}>2m ago</div>
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 700, fontFamily: T.mono, color: T.greenLt }}>+₹2,400</span>
        </div>
      </div>
    </div>
  );
}

/* ── Dashboard decoration ── */
function DashMock() {
  return (
    <div style={{ borderRadius: 14, overflow: "hidden", background: "#0c0a07", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 30px 60px -30px rgba(16,14,12,.5)", color: T.onBlack }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", background: "#13100b", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#fff" }}>BLIP MARKET</span>
        <span style={{ display: "flex", gap: 14, marginLeft: 14 }}>
          {["Orders","Analytics"].map(l => <span key={l} style={{ fontSize: 10.5, color: T.onBlackFaint }}>{l}</span>)}
        </span>
        <span style={{ marginLeft: "auto", fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: T.coralHi, background: T.coralGlow, padding: "4px 9px", borderRadius: 7 }}>$45,280</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "108px 1fr" }}>
        <div style={{ padding: 14, borderRight: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, letterSpacing: "0.16em", color: T.onBlackFaint, textTransform: "uppercase" }}>Balance</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 3, color: "#fff" }}>$45k</div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.coralHi, fontWeight: 600, marginTop: 2 }}>↑ +$1,247</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 42, marginTop: 16 }}>
            {[30,55,40,70,50,100,60].map((h,i) => (
              <div key={i} style={{ flex: 1, height: `${h}%`, background: i===5 ? T.coral : "rgba(255,255,255,.12)", borderRadius: 2 }} />
            ))}
          </div>
        </div>
        <div style={{ padding: 12 }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, letterSpacing: "0.16em", color: T.onBlackFaint, textTransform: "uppercase", marginBottom: 8 }}>Pending</div>
          {[{n:"parth.sol",a:"200 USDT",side:"BUY"},{n:"maya.eth",a:"150 USDT",side:"SELL"}].map(o => (
            <div key={o.n} style={{ display: "flex", alignItems: "center", gap: 9, padding: 8, borderRadius: 9 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "#fff", background: "#33302a" }}>{o.n[0].toUpperCase()}</span>
              <div>
                <div style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: "#fff" }}>{o.n}</div>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.onBlackFaint }}>{o.a}</div>
              </div>
              <span style={{ marginLeft: "auto", fontFamily: T.mono, fontSize: 9.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6, letterSpacing: "0.04em", background: o.side==="BUY"?"rgba(76,201,140,.16)":"rgba(214,73,63,.18)", color: o.side==="BUY"?T.greenLt:"#ef7b72" }}>{o.side}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 14px", borderTop: "1px solid rgba(255,255,255,.06)", fontFamily: T.mono, fontSize: 10, color: T.onBlackMut }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.greenLt }} />
        3 orders in progress
      </div>
    </div>
  );
}
