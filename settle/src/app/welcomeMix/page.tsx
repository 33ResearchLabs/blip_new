"use client";

import { motion, AnimatePresence, useMotionValue, animate } from "framer-motion";
import {
  Zap, ArrowRight, Shield, MessageSquare,
  Search, Lock, CheckCircle, Star, TrendingUp, Users, ChevronLeft,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

/* ── Count-up hook ─────────────────────────────── */
function useCountUp(to: number, duration = 1.8) {
  const [val, setVal] = useState(0);
  const mv = useMotionValue(0);
  useEffect(() => {
    const c = animate(mv, to, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setVal(Math.floor(v)) });
    return c.stop;
  }, [to, duration, mv]);
  return val;
}

/* ── Data ──────────────────────────────────────── */
const steps = [
  { icon: Search,      color: "#60a5fa", step: "01", title: "Find a merchant",    desc: "Browse verified traders with the best rates, filtered by payment method." },
  { icon: Lock,        color: "#f59e0b", step: "02", title: "Lock in escrow",     desc: "Funds are locked on-chain. Neither side can touch them until the deal is done." },
  { icon: CheckCircle, color: "#10b981", step: "03", title: "Get paid instantly", desc: "Crypto is released the moment payment is confirmed. No delays, no middleman." },
];

const chips = [
  { icon: Zap,           label: "Instant Settlement" },
  { icon: Shield,        label: "Escrow Protected"   },
  { icon: MessageSquare, label: "Built-in Chat"      },
];

const stats = [
  { icon: Users,      value: 12400,   suffix: "+", label: "Trades",   color: "#10b981" },
  { icon: TrendingUp, value: 2400000, prefix: "$", label: "Volume",   color: "#60a5fa" },
  { icon: Star,       value: 4.9,     display: "4.9★", label: "Rating", color: "#f59e0b" },
];

/* ── Animation variants ────────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { delay: i * 0.1, duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  }),
};

const slideVar = {
  enter: (d: number) => ({ opacity: 0, x: d > 0 ? 50 : -50 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] } },
  exit: (d: number) => ({ opacity: 0, x: d > 0 ? -50 : 50, transition: { duration: 0.22 } }),
};

/* ── Sections ──────────────────────────────────── */
type Section = "hero" | "how" | "stats";
const SECTIONS: Section[] = ["hero", "how", "stats"];

export default function WelcomeMix() {
  const [section, setSection] = useState<Section>("hero");
  const [stepIdx, setStepIdx] = useState(0);
  const [dir, setDir] = useState(1);

  const tradesVal  = useCountUp(12400);
  const volumeVal  = useCountUp(2400000);

  const goSection = (s: Section) => {
    setDir(SECTIONS.indexOf(s) > SECTIONS.indexOf(section) ? 1 : -1);
    setSection(s);
    setStepIdx(0);
  };

  const nextStep = () => {
    if (stepIdx < steps.length - 1) {
      setDir(1); setStepIdx(stepIdx + 1);
    } else {
      goSection("stats");
    }
  };
  const prevStep = () => { setDir(-1); setStepIdx(Math.max(0, stepIdx - 1)); };

  const activeStep = steps[stepIdx];
  const StepIcon = activeStep.icon;

  return (
    <div className="min-h-screen bg-[#060606] text-white flex flex-col relative overflow-hidden">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-orange-500/[0.04] rounded-full blur-[170px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-white/[0.012] rounded-full blur-[200px]" />
        {section === "how" && (
          <motion.div
            animate={{ background: `${activeStep.color}08` }}
            transition={{ duration: 0.6 }}
            className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[400px] rounded-full blur-[140px]"
          />
        )}
      </div>

      {/* Top nav dots */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 flex gap-2 z-20">
        {SECTIONS.map((s) => (
          <motion.button
            key={s}
            onClick={() => goSection(s)}
            animate={{ width: s === section ? 20 : 6, opacity: s === section ? 1 : 0.25 }}
            transition={{ duration: 0.3 }}
            className="h-1.5 rounded-full bg-white"
          />
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm relative z-10">
          <AnimatePresence mode="wait" custom={dir}>

            {/* ── HERO ── */}
            {section === "hero" && (
              <motion.div
                key="hero" custom={dir} variants={slideVar} initial="enter" animate="center" exit="exit"
                className="flex flex-col items-center text-center gap-8"
              >
                <motion.div custom={0} variants={fadeUp} initial="hidden" animate="show" className="flex items-center gap-2.5">
                  <Zap className="w-8 h-8 text-white fill-white" />
                  <span className="text-2xl leading-none">
                    <span className="font-bold">Blip</span>{" "}
                    <span className="italic text-white/80">money</span>
                  </span>
                </motion.div>

                <motion.div custom={1} variants={fadeUp} initial="hidden" animate="show" className="space-y-3">
                  <h1 className="text-[44px] font-bold leading-[1.08] tracking-tight">
                    Trade crypto,<br />get paid fast.
                  </h1>
                  <p className="text-[14px] text-white/50 leading-relaxed">
                    P2P exchange built on Solana.<br />Secure, simple, and instant.
                  </p>
                </motion.div>

                <motion.div custom={2} variants={fadeUp} initial="hidden" animate="show" className="flex flex-wrap justify-center gap-2">
                  {chips.map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium text-white/65"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <Icon className="w-3 h-3 text-white/40" />
                      {label}
                    </div>
                  ))}
                </motion.div>

                <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show" className="w-full space-y-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={() => goSection("how")}
                    className="w-full py-4 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 bg-white text-black"
                  >
                    Get Started
                    <ArrowRight className="w-4 h-4" />
                  </motion.button>
                  <Link href="/" className="block text-[13px] text-white/35 hover:text-white/65 transition-colors">
                    Already have an account?{" "}
                    <span className="text-white/65 font-medium underline underline-offset-2">Sign in</span>
                  </Link>
                </motion.div>
              </motion.div>
            )}

            {/* ── HOW IT WORKS ── */}
            {section === "how" && (
              <motion.div
                key="how" custom={dir} variants={slideVar} initial="enter" animate="center" exit="exit"
                className="flex flex-col items-center gap-2"
              >
                <p className="text-[11px] font-bold tracking-[0.22em] uppercase text-white/35 mb-2">How it works</p>

                <div className="w-full" style={{ minHeight: 300 }}>
                  <AnimatePresence mode="wait" custom={dir}>
                    <motion.div
                      key={stepIdx}
                      custom={dir} variants={slideVar} initial="enter" animate="center" exit="exit"
                      className="flex flex-col items-center text-center gap-5"
                    >
                      <span className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: activeStep.color }}>
                        Step {activeStep.step}
                      </span>
                      <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
                        style={{ background: `${activeStep.color}15`, border: `1px solid ${activeStep.color}25` }}>
                        <StepIcon className="w-9 h-9" style={{ color: activeStep.color }} />
                      </div>
                      <div className="space-y-2">
                        <h2 className="text-[30px] font-bold leading-tight tracking-tight">{activeStep.title}</h2>
                        <p className="text-[14px] text-white/50 leading-relaxed">{activeStep.desc}</p>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Step dots */}
                <div className="flex gap-2 mt-2">
                  {steps.map((_, i) => (
                    <motion.div key={i}
                      animate={{ width: i === stepIdx ? 20 : 6, opacity: i === stepIdx ? 1 : 0.25 }}
                      transition={{ duration: 0.3 }}
                      className="h-1.5 rounded-full bg-white"
                    />
                  ))}
                </div>

                <div className="w-full flex gap-3 mt-5">
                  {stepIdx > 0 && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={prevStep}
                      className="w-12 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </motion.button>
                  )}
                  <motion.button
                    whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                    onClick={nextStep}
                    className="flex-1 h-14 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 bg-white text-black"
                  >
                    {stepIdx < steps.length - 1 ? "Next" : "See the numbers"}
                    <ArrowRight className="w-4 h-4" />
                  </motion.button>
                </div>

                <button onClick={() => goSection("hero")} className="text-[11px] text-white/25 hover:text-white/50 transition-colors mt-1">
                  ← Back
                </button>
              </motion.div>
            )}

            {/* ── STATS ── */}
            {section === "stats" && (
              <motion.div
                key="stats" custom={dir} variants={slideVar} initial="enter" animate="center" exit="exit"
                className="flex flex-col items-center text-center gap-8"
              >
                <motion.div custom={0} variants={fadeUp} initial="hidden" animate="show" className="space-y-2">
                  <p className="text-[11px] font-bold tracking-[0.22em] uppercase text-white/35">By the numbers</p>
                  <h2 className="text-[34px] font-bold leading-tight tracking-tight">
                    Trusted by thousands<br />of traders.
                  </h2>
                </motion.div>

                <motion.div custom={1} variants={fadeUp} initial="hidden" animate="show" className="w-full grid grid-cols-3 gap-3">
                  {stats.map(({ icon: Icon, value, prefix = "", suffix = "", display, label, color }) => (
                    <div key={label} className="flex flex-col items-center gap-2 py-5 px-2 rounded-2xl"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: `${color}15` }}>
                        <Icon className="w-4 h-4" style={{ color }} />
                      </div>
                      <div className="text-[22px] font-bold leading-none" style={{ color }}>
                        {display ? display : label === "Trades"
                          ? `${tradesVal.toLocaleString()}+`
                          : `$${volumeVal.toLocaleString()}`}
                      </div>
                      <div className="text-[10px] text-white/35 font-medium uppercase tracking-wider">{label}</div>
                    </div>
                  ))}
                </motion.div>

                <motion.div custom={2} variants={fadeUp} initial="hidden" animate="show"
                  className="w-full flex justify-center gap-5 py-4 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                  {["Non-custodial", "Escrow protected", "Instant settle"].map((t, i) => (
                    <div key={t} className="flex items-center gap-1.5 text-[11px] text-white/35">
                      {i > 0 && <span className="text-white/15 mr-1">·</span>}
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500/70 inline-block" />
                      {t}
                    </div>
                  ))}
                </motion.div>

                <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show" className="w-full space-y-3">
                  <Link href="/">
                    <motion.button
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      className="w-full py-4 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 bg-white text-black"
                    >
                      Start Trading
                      <ArrowRight className="w-4 h-4" />
                    </motion.button>
                  </Link>
                  <Link href="/" className="block text-[13px] text-white/35 hover:text-white/65 transition-colors">
                    Already have an account?{" "}
                    <span className="text-white/65 font-medium underline underline-offset-2">Sign in</span>
                  </Link>
                </motion.div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center pb-6 z-10 relative">
        <p className="text-[10px] text-white/15 font-mono">Blip Money v1.0 · Non-custodial · Powered by Solana</p>
      </div>
    </div>
  );
}
