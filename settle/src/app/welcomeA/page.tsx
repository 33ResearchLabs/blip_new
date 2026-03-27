"use client";

import { motion, type Variants } from "framer-motion";
import { Zap, Shield, MessageSquare, ArrowRight } from "lucide-react";
import Link from "next/link";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  }),
};

const chips = [
  { icon: Zap,            label: "Instant Settlement" },
  { icon: Shield,         label: "Escrow Protected"   },
  { icon: MessageSquare,  label: "Built-in Chat"      },
];

export default function WelcomeA() {
  return (
    <div className="min-h-screen bg-[#060606] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-orange-500/[0.04] rounded-full blur-[160px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] h-[350px] bg-white/[0.015] rounded-full blur-[200px]" />
      </div>

      <div className="w-full max-w-sm relative z-10 flex flex-col items-center text-center gap-10">

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
          <h1 className="text-[42px] font-bold leading-[1.1] tracking-tight">
            Trade crypto,<br />get paid fast.
          </h1>
          <p className="text-[15px] text-white/50 leading-relaxed">
            The fastest P2P crypto exchange.<br />
            Secure, simple, and instant.
          </p>
        </motion.div>

        {/* Feature chips */}
        <motion.div
          custom={2} variants={fadeUp} initial="hidden" animate="show"
          className="flex flex-wrap justify-center gap-2"
        >
          {chips.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium text-white/70"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <Icon className="w-3.5 h-3.5 text-white/50" />
              {label}
            </div>
          ))}
        </motion.div>

        {/* CTA */}
        <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show" className="w-full space-y-3">
          <Link href="/">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="w-full py-4 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 bg-white text-black"
            >
              Get Started
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          </Link>
          <Link href="/" className="block text-[13px] text-white/40 hover:text-white/70 transition-colors">
            Already have an account? <span className="text-white/70 font-medium underline underline-offset-2">Sign in</span>
          </Link>
        </motion.div>

        {/* Footer */}
        <motion.p
          custom={4} variants={fadeUp} initial="hidden" animate="show"
          className="text-[10px] text-white/20 font-mono"
        >
          Blip Money v1.0 · Non-custodial · Powered by Solana
        </motion.p>
      </div>
    </div>
  );
}
