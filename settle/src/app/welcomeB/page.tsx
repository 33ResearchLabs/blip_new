"use client";

import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Zap, ArrowRight, TrendingUp, Users, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

function CountUp({ to, duration = 1.8, prefix = "", suffix = "" }: { to: number; duration?: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const val = useMotionValue(0);

  useEffect(() => {
    const controls = animate(val, to, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(Math.floor(v)),
    });
    return controls.stop;
  }, [to, duration, val]);

  return <span>{prefix}{display.toLocaleString()}{suffix}</span>;
}

const stats = [
  { icon: Users,      value: 12400,  suffix: "+", label: "Trades",        color: "#10b981" },
  { icon: TrendingUp, value: 2400000, prefix: "$", label: "Volume",       color: "#60a5fa" },
  { icon: Star,       value: 4.9,    suffix: "★",  label: "Avg Rating",   color: "#f59e0b", isFloat: true },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.13, duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  }),
};

export default function WelcomeB() {
  return (
    <div className="min-h-screen bg-[#060606] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/4 w-[500px] h-[400px] bg-blue-500/[0.04] rounded-full blur-[150px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[300px] bg-green-500/[0.04] rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[200px] bg-orange-500/[0.03] rounded-full blur-[180px]" />
      </div>

      <div className="w-full max-w-sm relative z-10 flex flex-col items-center text-center gap-9">

        {/* Logo */}
        <motion.div
          custom={0} variants={fadeUp} initial="hidden" animate="show"
          className="flex items-center gap-2.5"
        >
          <Zap className="w-8 h-8 text-white fill-white" />
          <span className="text-2xl leading-none">
            <span className="font-bold">Blip</span>{" "}
            <span className="italic text-white/80">money</span>
          </span>
        </motion.div>

        {/* Headline */}
        <motion.div custom={1} variants={fadeUp} initial="hidden" animate="show" className="space-y-3">
          <h1 className="text-[38px] font-bold leading-[1.15] tracking-tight">
            Trusted by thousands<br />of traders.
          </h1>
          <p className="text-[14px] text-white/50">Real numbers. Real people. Real trades.</p>
        </motion.div>

        {/* Stat cards */}
        <motion.div custom={2} variants={fadeUp} initial="hidden" animate="show" className="w-full grid grid-cols-3 gap-3">
          {stats.map(({ icon: Icon, value, prefix = "", suffix = "", label, color, isFloat }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-2 py-5 px-2 rounded-2xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${color}15` }}>
                <Icon className="w-4 h-4" style={{ color }} />
              </div>
              <div className="text-[22px] font-bold leading-none" style={{ color }}>
                {isFloat ? (
                  <span>{value}{suffix}</span>
                ) : (
                  <CountUp to={value} prefix={prefix} suffix={suffix} />
                )}
              </div>
              <div className="text-[10px] text-white/40 font-medium uppercase tracking-wider">{label}</div>
            </div>
          ))}
        </motion.div>

        {/* Trust bar */}
        <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show"
          className="w-full flex items-center justify-center gap-6 py-4 rounded-2xl"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          {["Non-custodial", "Escrow protected", "Instant settle"].map((t, i) => (
            <div key={t} className="flex items-center gap-1.5 text-[11px] text-white/40">
              {i > 0 && <span className="text-white/15">·</span>}
              <span className="w-1.5 h-1.5 rounded-full bg-green-500/70 inline-block" />
              {t}
            </div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div custom={4} variants={fadeUp} initial="hidden" animate="show" className="w-full space-y-3">
          <Link href="/">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="w-full py-4 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 bg-white text-black"
            >
              Start Trading
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          </Link>
          <Link href="/" className="block text-[13px] text-white/40 hover:text-white/70 transition-colors">
            Already have an account? <span className="text-white/70 font-medium underline underline-offset-2">Sign in</span>
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
