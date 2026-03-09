"use client";

import { motion } from "framer-motion";

const orbs = [
  { color: 'rgba(124,58,237,0.13)', dur: 18, style: { top: '-15%', left: '-10%', width: '65%', height: '55%' } as React.CSSProperties },
  { color: 'rgba(16,185,129,0.09)', dur: 22, style: { bottom: '-20%', right: '-10%', width: '60%', height: '55%' } as React.CSSProperties },
  { color: 'rgba(59,130,246,0.07)', dur: 26, style: { top: '35%', right: '15%', width: '40%', height: '40%' } as React.CSSProperties },
];

export default function AmbientGlow() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {orbs.map((orb, i) => (
        <motion.div
          key={i}
          animate={{
            x: [0, 40 * (i % 2 === 0 ? 1 : -1), -30, 0],
            y: [0, -40, 50, 0],
            scale: [1, 1.15, 0.9, 1],
          }}
          transition={{ duration: orb.dur, repeat: Infinity, ease: 'linear' }}
          className="absolute rounded-full"
          style={{
            ...orb.style,
            background: `radial-gradient(ellipse, ${orb.color} 0%, transparent 70%)`,
            filter: 'blur(60px)',
          }}
        />
      ))}
    </div>
  );
}
