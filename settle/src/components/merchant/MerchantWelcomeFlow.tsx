"use client";

import { useState, useEffect } from "react";

const SLIDES = [
  {
    badge: "WELCOME",
    badgeColor: "#b8e9d4",
    badgeBg: "rgba(184,233,212,0.12)",
    title: "Welcome to\nBlip Markets.",
    body: "Your gateway to P2P crypto trading. Buy and sell USDT at the best rates — instantly, securely, and on your terms.",
    illustration: (
      <svg viewBox="0 0 220 160" width={220} height={160} fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Globe */}
        <ellipse cx="110" cy="80" rx="62" ry="62" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5"/>
        <ellipse cx="110" cy="80" rx="35" ry="62" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1.2"/>
        <ellipse cx="110" cy="80" rx="62" ry="24" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1.2"/>
        {/* Blip dot center */}
        <circle cx="110" cy="80" r="6" fill="#b8e9d4" opacity="0.9"/>
        <circle cx="110" cy="80" r="11" fill="#b8e9d4" opacity="0.15"/>
        {/* Orbit nodes */}
        <circle cx="155" cy="52" r="5" fill="#7da0ff" opacity="0.85"/>
        <circle cx="155" cy="52" r="9" fill="#7da0ff" opacity="0.12"/>
        <circle cx="65" cy="108" r="4" fill="#e2b770" opacity="0.85"/>
        <circle cx="65" cy="108" r="8" fill="#e2b770" opacity="0.12"/>
        <circle cx="148" cy="118" r="3.5" fill="#c48ae0" opacity="0.85"/>
        <circle cx="148" cy="118" r="7" fill="#c48ae0" opacity="0.1"/>
        {/* Dashed arcs */}
        <path d="M110 80 Q132 60 155 52" stroke="#b8e9d4" strokeWidth="1.3" strokeDasharray="3 4" opacity="0.5"/>
        <path d="M110 80 Q88 95 65 108" stroke="#e2b770" strokeWidth="1.3" strokeDasharray="3 4" opacity="0.5"/>
        <path d="M110 80 Q128 100 148 118" stroke="#c48ae0" strokeWidth="1.3" strokeDasharray="3 4" opacity="0.4"/>
      </svg>
    ),
  },
  {
    badge: "EARN",
    badgeColor: "#e2b770",
    badgeBg: "rgba(226,183,112,0.12)",
    title: "Trade. Earn.\nEvery time.",
    body: "Every completed trade earns you a cut. The more you trade, the more you earn — with real-time payouts to your wallet.",
    illustration: (
      <svg viewBox="0 0 220 160" width={220} height={160} fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Bar chart */}
        <rect x="36" y="100" width="22" height="40" rx="5" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.08)" strokeWidth="1.2"/>
        <rect x="70" y="74" width="22" height="66" rx="5" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.08)" strokeWidth="1.2"/>
        <rect x="104" y="52" width="22" height="88" rx="5" fill="rgba(226,183,112,0.18)" stroke="#e2b770" strokeWidth="1.4"/>
        <rect x="138" y="30" width="22" height="110" rx="5" fill="rgba(226,183,112,0.3)" stroke="#e2b770" strokeWidth="1.6"/>
        {/* Labels */}
        <text x="47" y="152" fill="rgba(255,255,255,0.25)" fontSize="8" textAnchor="middle" fontFamily="sans-serif">Mon</text>
        <text x="81" y="152" fill="rgba(255,255,255,0.25)" fontSize="8" textAnchor="middle" fontFamily="sans-serif">Tue</text>
        <text x="115" y="152" fill="rgba(255,255,255,0.25)" fontSize="8" textAnchor="middle" fontFamily="sans-serif">Wed</text>
        <text x="149" y="152" fill="#e2b770" fontSize="8" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold">Thu</text>
        {/* Earnings badge */}
        <rect x="148" y="14" width="62" height="22" rx="7" fill="rgba(226,183,112,0.15)" stroke="#e2b770" strokeWidth="1"/>
        <text x="179" y="28" fill="#e2b770" fontSize="9.5" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold">+₹4,820</text>
      </svg>
    ),
  },
  {
    badge: "SECURE",
    badgeColor: "#7da0ff",
    badgeBg: "rgba(125,160,255,0.12)",
    title: "Safe escrow.\nZero risk.",
    body: "Funds are locked on-chain in escrow until both sides confirm. No chargebacks, no disputes — just clean, settled trades.",
    illustration: (
      <svg viewBox="0 0 220 160" width={220} height={160} fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* Shield */}
        <path d="M110 22 L162 44 L162 88 C162 118 110 138 110 138 C110 138 58 118 58 88 L58 44 Z" fill="rgba(125,160,255,0.08)" stroke="rgba(125,160,255,0.3)" strokeWidth="1.5"/>
        {/* Lock body */}
        <rect x="96" y="78" width="28" height="22" rx="5" fill="rgba(125,160,255,0.2)" stroke="#7da0ff" strokeWidth="1.4"/>
        {/* Lock shackle */}
        <path d="M101 78 L101 70 Q110 62 119 70 L119 78" fill="none" stroke="#7da0ff" strokeWidth="2" strokeLinecap="round"/>
        {/* Keyhole */}
        <circle cx="110" cy="87" r="3" fill="#7da0ff" opacity="0.9"/>
        <rect x="108.5" y="87" width="3" height="6" rx="1" fill="#7da0ff" opacity="0.9"/>
        {/* On-chain label */}
        <rect x="68" y="118" width="84" height="17" rx="6" fill="rgba(125,160,255,0.08)" stroke="rgba(125,160,255,0.2)" strokeWidth="1"/>
        <text x="110" y="130" fill="#7da0ff" fontSize="9" textAnchor="middle" fontFamily="sans-serif" fontWeight="600" opacity="0.85">On-chain escrow</text>
        {/* Checkmark ring */}
        <circle cx="148" cy="50" r="12" fill="rgba(184,233,212,0.12)" stroke="#b8e9d4" strokeWidth="1.2"/>
        <path d="M143 50 L147 54 L154 46" stroke="#b8e9d4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

interface MerchantWelcomeFlowProps {
  onComplete: () => void;
}

export function MerchantWelcomeFlow({ onComplete }: MerchantWelcomeFlowProps) {
  const [slide, setSlide] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setEntering(false), 50);
    return () => clearTimeout(t);
  }, []);

  const goNext = () => {
    if (slide < SLIDES.length - 1) {
      setExiting(true);
      setTimeout(() => {
        setSlide((s) => s + 1);
        setExiting(false);
        setEntering(true);
        setTimeout(() => setEntering(false), 50);
      }, 220);
    } else {
      onComplete();
    }
  };

  const goTo = (i: number) => {
    if (i === slide) return;
    setExiting(true);
    setTimeout(() => {
      setSlide(i);
      setExiting(false);
      setEntering(true);
      setTimeout(() => setEntering(false), 50);
    }, 220);
  };

  const current = SLIDES[slide];
  const isLast = slide === SLIDES.length - 1;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "#08080a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px 32px",
      }}
    >
      {/* Ambient glow */}
      <div style={{
        position: "absolute",
        top: "15%",
        left: "50%",
        transform: "translateX(-50%)",
        width: 420,
        height: 280,
        borderRadius: "50%",
        background: `radial-gradient(ellipse at center, ${current.badgeColor}18 0%, transparent 70%)`,
        pointerEvents: "none",
        transition: "background 0.5s ease",
      }}/>

      {/* Skip */}
      {!isLast && (
        <button
          onClick={onComplete}
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 99,
            padding: "6px 14px",
            color: "rgba(255,255,255,0.4)",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.01em",
          }}
        >
          Skip
        </button>
      )}

      {/* Card */}
      <div style={{
        width: "100%",
        maxWidth: 380,
        opacity: exiting ? 0 : entering ? 0 : 1,
        transform: exiting ? "translateY(12px)" : entering ? "translateY(-10px)" : "translateY(0)",
        transition: "opacity 0.22s ease, transform 0.22s ease",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
      }}>
        {/* Illustration area */}
        <div style={{
          width: "100%",
          height: 200,
          borderRadius: 24,
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 28,
          overflow: "hidden",
          position: "relative",
        }}>
          {current.illustration}
        </div>

        {/* Badge */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: current.badgeBg,
          border: `1px solid ${current.badgeColor}30`,
          borderRadius: 99,
          padding: "4px 12px",
          marginBottom: 16,
        }}>
          <div style={{ width: 5, height: 5, borderRadius: 99, background: current.badgeColor }}/>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", color: current.badgeColor, textTransform: "uppercase" }}>
            {current.badge}
          </span>
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1.15,
          color: "#f5f5f7",
          textAlign: "center",
          marginBottom: 14,
          whiteSpace: "pre-line",
        }}>
          {current.title}
        </h1>

        {/* Body */}
        <p style={{
          fontSize: 15,
          lineHeight: 1.6,
          color: "rgba(255,255,255,0.45)",
          textAlign: "center",
          maxWidth: 300,
          fontWeight: 400,
          marginBottom: 0,
        }}>
          {current.body}
        </p>
      </div>

      {/* Dots */}
      <div style={{ display: "flex", gap: 7, marginTop: 36, marginBottom: 24 }}>
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            style={{
              width: i === slide ? 22 : 7,
              height: 7,
              borderRadius: 99,
              background: i === slide ? current.badgeColor : "rgba(255,255,255,0.15)",
              border: "none",
              cursor: "pointer",
              padding: 0,
              transition: "width 0.25s ease, background 0.25s ease",
            }}
          />
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={goNext}
        style={{
          width: "100%",
          maxWidth: 380,
          padding: "16px 24px",
          borderRadius: 16,
          background: isLast
            ? `linear-gradient(135deg, ${current.badgeColor}22, ${current.badgeColor}10)`
            : "rgba(255,255,255,0.07)",
          border: isLast ? `1.5px solid ${current.badgeColor}50` : "1px solid rgba(255,255,255,0.1)",
          color: isLast ? current.badgeColor : "#f5f5f7",
          fontSize: 15.5,
          fontWeight: 700,
          cursor: "pointer",
          letterSpacing: "-0.01em",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
      >
        {isLast ? "Start trading →" : "Next"}
      </button>
    </div>
  );
}
