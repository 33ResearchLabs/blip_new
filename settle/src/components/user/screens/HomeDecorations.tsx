"use client";

import { motion } from "framer-motion";

// ─── Sparkline SVG — premium smooth line chart ─────────────────────────────
const SPARK_DATA = [28, 42, 33, 58, 44, 70, 55, 82, 69, 98, 87, 115, 102, 138];

function smoothPath(pts: { x: number; y: number }[], close?: { w: number; h: number }) {
  if (pts.length < 2) return "";
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C${cpx.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${curr.y.toFixed(1)} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`;
  }
  if (close) d += ` L${close.w},${close.h} L0,${close.h} Z`;
  return d;
}

export const HomeSparkline = ({ width = 300, height = 56 }: { width?: number; height?: number }) => {
  const data = SPARK_DATA;
  const max = Math.max(...data), min = Math.min(...data), rng = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - 8 - ((v - min) / rng) * (height - 18),
  }));
  const line = smoothPath(pts);
  const area = smoothPath(pts, { w: width, h: height });
  const last = pts[pts.length - 1];

  // mid-point for color split
  const midX = width / 2;
  const midPt = pts.find(p => p.x >= midX) ?? last;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full overflow-visible text-text-primary"
    >
      <defs>
        {/* Area fill gradient — uses currentColor so it themes */}
        <linearGradient id="sg-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        {/* Line gradient — fades into bright on right */}
        <linearGradient id="sg-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.95" />
        </linearGradient>
        {/* End dot glow */}
        <filter id="sg-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Area */}
      <path d={area} fill="url(#sg-area)" />
      {/* Line */}
      <path d={line} fill="none" stroke="url(#sg-line)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />

      {/* Vertical reference tick at midpoint */}
      <line
        x1={midPt.x} y1={midPt.y + 6} x2={midPt.x} y2={height}
        stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" strokeDasharray="2 3"
      />

      {/* End dot */}
      <circle cx={last.x} cy={last.y} r="3" fill="currentColor" filter="url(#sg-glow)" opacity="0.9" />
      {/* Pulsing ring */}
      <motion.circle
        cx={last.x} cy={last.y} r="6" fill="none"
        stroke="currentColor" strokeOpacity="0.3" strokeWidth="1"
        animate={{ r: [5, 9], opacity: [0.3, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
      />
    </svg>
  );
};

// ─── Ambient glow orbs — refined, very subtle ──────────────────────────────
export const HomeAmbientGlow = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
    {([
      { color: 'rgba(124,58,237,0.10)', dur: 18, style: { top: '-15%', left: '-10%', width: '65%', height: '55%' } },
      { color: 'rgba(16,185,129,0.07)', dur: 22, style: { bottom: '-20%', right: '-10%', width: '60%', height: '55%' } },
      { color: 'rgba(96,165,250,0.05)', dur: 26, style: { top: '35%', right: '15%', width: '40%', height: '40%' } },
    ] as const).map((orb, i) => (
      <motion.div
        key={i}
        animate={{ x: [0, 35 * (i % 2 === 0 ? 1 : -1), -25, 0], y: [0, -35, 45, 0], scale: [1, 1.12, 0.92, 1] }}
        transition={{ duration: orb.dur, repeat: Infinity, ease: 'linear' }}
        className="absolute rounded-full"
        style={{ ...orb.style, background: `radial-gradient(ellipse, ${orb.color} 0%, transparent 70%)`, filter: 'blur(70px)' }}
      />
    ))}
  </div>
);
