"use client";

import { memo } from "react";
import type React from "react";

/**
 * Animated default avatar — a tiny face that blinks every few seconds.
 * Shown when the merchant hasn't uploaded a custom photo.
 *
 * Color is deterministic from `seed` so the same merchant always gets
 * the same hue. Eyes blink via a CSS @keyframes animation — no GIF, no
 * canvas, no external dep.
 */

function seedToHue(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 33) ^ seed.charCodeAt(i);
  }
  return Math.abs(h) % 360;
}

// A small palette of nice dark-on-bright combos — pick by hue bucket
function faceColors(hue: number): { bg1: string; bg2: string; skin: string; hair: string } {
  // Map hue to one of 6 character types
  const bucket = Math.floor(((hue % 360) / 360) * 6);
  const palettes = [
    { bg1: "#1a1a2e", bg2: "#16213e", skin: "#e8c9a0", hair: "#2c1810" },   // midnight blue, warm skin
    { bg1: "#0d2137", bg2: "#0a3d62", skin: "#f4c08b", hair: "#1a0a00" },   // ocean, golden
    { bg1: "#1a0a2e", bg2: "#2d1b69", skin: "#deb887", hair: "#3d1c02" },   // deep purple, tan
    { bg1: "#0a1628", bg2: "#122040", skin: "#c8a97e", hair: "#0d0d0d" },   // navy, caramel
    { bg1: "#1c1c1c", bg2: "#2a2a2a", skin: "#e0ac69", hair: "#1a0800" },   // charcoal, bronze
    { bg1: "#0f2027", bg2: "#203a43", skin: "#f5cba7", hair: "#2c0e0e" },   // teal-dark, light skin
  ];
  return palettes[bucket];
}

interface BlinkingAvatarProps {
  seed?: string | null;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const BlinkingAvatar = memo(function BlinkingAvatar({
  seed = "merchant",
  size = 28,
  className = "",
  style,
}: BlinkingAvatarProps) {
  const safeSeed = seed || "merchant";
  const hue = seedToHue(safeSeed);
  const colors = faceColors(hue);
  const uid = `ba_${safeSeed.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 12)}_${size}`;

  // Scale all face coordinates relative to a 100×100 viewBox
  // Blink animation: eyelids drop from scaleY(0) to scaleY(1) → back
  // The animation fires at ~97% of the cycle so with 4.5s total it
  // blinks once at ~4.4s, stays open for most of the loop.
  const blinkKeyframes = `
    @keyframes ${uid}_blink {
      0%,90%,100% { transform: scaleY(0); }
      94%,96%     { transform: scaleY(1); }
    }
    @keyframes ${uid}_blink2 {
      0%,93%,100% { transform: scaleY(0); }
      97%,99%     { transform: scaleY(1); }
    }
  `;

  return (
    <>
      <style>{blinkKeyframes}</style>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className={`shrink-0 ${className}`}
        style={{ borderRadius: "50%", display: "block", ...style }}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id={`${uid}_bg`} cx="40%" cy="30%" r="75%">
            <stop offset="0%" stopColor={colors.bg1} />
            <stop offset="100%" stopColor={colors.bg2} />
          </radialGradient>
          {/* Clip for eyelids — left eye */}
          <clipPath id={`${uid}_le`}>
            <ellipse cx="37" cy="52" rx="8.5" ry="7" />
          </clipPath>
          {/* Clip for eyelids — right eye */}
          <clipPath id={`${uid}_re`}>
            <ellipse cx="63" cy="52" rx="8.5" ry="7" />
          </clipPath>
        </defs>

        {/* Background circle */}
        <circle cx="50" cy="50" r="50" fill={`url(#${uid}_bg)`} />

        {/* Subtle noise/grain overlay ring */}
        <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

        {/* Hair block (top cap) */}
        <ellipse cx="50" cy="22" rx="28" ry="20" fill={colors.hair} />
        <rect x="22" y="22" width="56" height="14" fill={colors.hair} />

        {/* Head/face */}
        <ellipse cx="50" cy="56" rx="26" ry="30" fill={colors.skin} />

        {/* Ear left */}
        <ellipse cx="24" cy="57" rx="5" ry="7" fill={colors.skin} />
        {/* Ear right */}
        <ellipse cx="76" cy="57" rx="5" ry="7" fill={colors.skin} />

        {/* Neck + shoulder hint (fills bottom) */}
        <ellipse cx="50" cy="96" rx="22" ry="14" fill={colors.skin} />
        <ellipse cx="50" cy="100" rx="34" ry="10" fill={colors.bg2} />

        {/* ── Eyes ── */}
        {/* White sclera */}
        <ellipse cx="37" cy="52" rx="8.5" ry="7" fill="white" />
        <ellipse cx="63" cy="52" rx="8.5" ry="7" fill="white" />

        {/* Iris */}
        <circle cx="37" cy="53" r="4.5" fill="#3a2a1a" />
        <circle cx="63" cy="53" r="4.5" fill="#3a2a1a" />

        {/* Pupil */}
        <circle cx="37.5" cy="53" r="2.5" fill="#0d0d0d" />
        <circle cx="63.5" cy="53" r="2.5" fill="#0d0d0d" />

        {/* Highlight */}
        <circle cx="39" cy="51.5" r="1.2" fill="rgba(255,255,255,0.85)" />
        <circle cx="65" cy="51.5" r="1.2" fill="rgba(255,255,255,0.85)" />

        {/* ── Animated eyelids (blink) ── */}
        {/* Left eyelid — clips to the sclera ellipse, scales from top */}
        <g clipPath={`url(#${uid}_le)`}>
          <ellipse
            cx="37"
            cy="45.5"
            rx="9"
            ry="7"
            fill={colors.skin}
            style={{
              transformOrigin: "37px 45.5px",
              transformBox: "fill-box",
              animation: `${uid}_blink 4.8s ease-in-out infinite`,
            }}
          />
        </g>

        {/* Right eyelid — slightly offset delay for natural async blink */}
        <g clipPath={`url(#${uid}_re)`}>
          <ellipse
            cx="63"
            cy="45.5"
            rx="9"
            ry="7"
            fill={colors.skin}
            style={{
              transformOrigin: "63px 45.5px",
              transformBox: "fill-box",
              animation: `${uid}_blink 4.8s ease-in-out infinite`,
              animationDelay: "0.04s",
            }}
          />
        </g>

        {/* Eyebrows */}
        <path
          d="M29.5 43.5 Q37 40.5 44.5 43"
          stroke={colors.hair}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M55.5 43 Q63 40.5 70.5 43.5"
          stroke={colors.hair}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />

        {/* Nose — subtle */}
        <path
          d="M48 60 Q50 65 52 60"
          stroke={`${colors.skin}99`}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
          style={{ filter: "brightness(0.75)" }}
        />

        {/* Smile */}
        <path
          d="M41 70 Q50 76 59 70"
          stroke="#c0836a"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </>
  );
});
