"use client";

import { motion } from "framer-motion";

// ─── Sparkline SVG ────────────────────────────────────────────────────────────
const SPARK_DATA = [28, 42, 33, 58, 44, 70, 55, 82, 69, 98, 87, 115, 102, 138];
export const HomeSparkline = ({ width = 300, height = 52 }: { width?: number; height?: number }) => {
  const data = SPARK_DATA;
  const max = Math.max(...data), min = Math.min(...data), rng = max - min || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - 6 - ((v - min) / rng) * (height - 14),
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full">
      <defs>
        <linearGradient id="hsg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
        <filter id="hglow">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={area} fill="url(#hsg)" />
      <path d={line} fill="none" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="3.5" fill="#10b981" filter="url(#hglow)" />
      <circle cx={last.x} cy={last.y} r="7" fill="none" stroke="#10b981" strokeWidth="1" opacity="0.35" />
    </svg>
  );
};

// ─── Ambient glow orbs ────────────────────────────────────────────────────────
export const HomeAmbientGlow = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
    {([
      { color: 'rgba(124,58,237,0.13)', dur: 18, style: { top: '-15%', left: '-10%', width: '65%', height: '55%' } },
      { color: 'rgba(16,185,129,0.09)', dur: 22, style: { bottom: '-20%', right: '-10%', width: '60%', height: '55%' } },
      { color: 'rgba(59,130,246,0.07)', dur: 26, style: { top: '35%', right: '15%', width: '40%', height: '40%' } },
    ] as const).map((orb, i) => (
      <motion.div
        key={i}
        animate={{ x: [0, 40 * (i % 2 === 0 ? 1 : -1), -30, 0], y: [0, -40, 50, 0], scale: [1, 1.15, 0.9, 1] }}
        transition={{ duration: orb.dur, repeat: Infinity, ease: 'linear' }}
        className="absolute rounded-full"
        style={{ ...orb.style, background: `radial-gradient(ellipse, ${orb.color} 0%, transparent 70%)`, filter: 'blur(60px)' }}
      />
    ))}
  </div>
);
