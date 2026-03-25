"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Zap, Search, Lock, CheckCircle, ArrowRight, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const slides = [
  {
    icon: Search,
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.1)",
    step: "01",
    title: "Find a merchant",
    desc: "Browse verified P2P merchants offering the best rates. Filter by payment method, rating, and volume.",
    hint: "Hundreds of active merchants available right now",
  },
  {
    icon: Lock,
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.1)",
    step: "02",
    title: "Lock in escrow",
    desc: "Crypto is locked in a secure on-chain escrow contract. Neither party can access it until the trade completes.",
    hint: "Your funds are safe — always",
  },
  {
    icon: CheckCircle,
    color: "#10b981",
    bg: "rgba(16,185,129,0.1)",
    step: "03",
    title: "Get paid instantly",
    desc: "Once payment is confirmed, crypto is released automatically. No waiting. No middleman. No friction.",
    hint: "Average settlement time: under 2 minutes",
  },
];

const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 60 : -60 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -60 : 60, transition: { duration: 0.25 } }),
};

export default function WelcomeC() {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);

  const go = (next: number) => {
    setDirection(next > current ? 1 : -1);
    setCurrent(next);
  };

  const slide = slides[current];
  const Icon = slide.icon;
  const isLast = current === slides.length - 1;

  return (
    <div className="min-h-screen bg-[#060606] text-white flex flex-col items-center justify-between p-6 pt-14 relative overflow-hidden">
      {/* Ambient glow that follows slide color */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ background: `${slide.color}08` }}
          transition={{ duration: 0.6 }}
          className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[150px]"
        />
      </div>

      <div className="w-full max-w-sm relative z-10 flex flex-col items-center gap-6">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-white fill-white" />
          <span className="text-[15px] font-bold">blip money</span>
        </div>

        {/* Slide content */}
        <div className="w-full mt-6" style={{ minHeight: 320 }}>
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={current}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="flex flex-col items-center text-center gap-6"
            >
              {/* Step number + icon */}
              <div className="flex flex-col items-center gap-4">
                <span className="text-[11px] font-bold tracking-[0.25em] uppercase" style={{ color: slide.color }}>
                  Step {slide.step}
                </span>
                <div
                  className="w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: slide.bg, border: `1px solid ${slide.color}25` }}
                >
                  <Icon className="w-9 h-9" style={{ color: slide.color }} />
                </div>
              </div>

              {/* Text */}
              <div className="space-y-3">
                <h2 className="text-[32px] font-bold leading-tight tracking-tight">{slide.title}</h2>
                <p className="text-[15px] text-white/55 leading-relaxed">{slide.desc}</p>
              </div>

              {/* Hint pill */}
              <div
                className="px-4 py-2 rounded-full text-[12px]"
                style={{ background: `${slide.color}10`, color: slide.color, border: `1px solid ${slide.color}20` }}
              >
                {slide.hint}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="w-full max-w-sm relative z-10 flex flex-col items-center gap-6 pb-4">
        {/* Progress dots */}
        <div className="flex gap-2">
          {slides.map((_, i) => (
            <motion.button
              key={i}
              onClick={() => go(i)}
              animate={{ width: i === current ? 24 : 8, opacity: i === current ? 1 : 0.3 }}
              transition={{ duration: 0.3 }}
              className="h-2 rounded-full bg-white"
            />
          ))}
        </div>

        {/* Navigation */}
        <div className="w-full flex gap-3">
          {current > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => go(current - 1)}
              className="w-12 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>
          )}

          {isLast ? (
            <Link href="/" className="flex-1">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="w-full h-14 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 bg-white text-black"
              >
                Start Trading
                <ArrowRight className="w-4 h-4" />
              </motion.button>
            </Link>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => go(current + 1)}
              className="flex-1 h-14 rounded-2xl text-[15px] font-bold flex items-center justify-center gap-2 bg-white text-black"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          )}
        </div>

        <Link href="/" className="text-[12px] text-white/30 hover:text-white/60 transition-colors">
          Skip intro
        </Link>
      </div>
    </div>
  );
}
