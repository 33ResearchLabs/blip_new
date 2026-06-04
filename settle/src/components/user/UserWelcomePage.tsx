"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  ArrowUpRight,
  ArrowDownLeft,
  Lock,
  ShieldCheck,
  Clock,
  Wallet,
  ChevronRight,
  Banknote,
  Fingerprint,
  BadgeCheck,
  Globe,
  Building2,
  User as UserIcon,
  Store,
  ArrowRight,
  Sparkles,
  TrendingUp,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

interface UserWelcomePageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export function UserWelcomePage({ onGetStarted, onSignIn }: UserWelcomePageProps) {
  const [demoPriority, setDemoPriority] = useState<"fast" | "best" | "cheap">("best");
  const [demoType, setDemoType] = useState<"buy" | "sell">("buy");

  const priorities = [
    { key: "fast" as const, label: "Fastest", sub: "~2 min", fee: "3.0%", barHex: "var(--color-warning)" },
    { key: "best" as const, label: "Best Rate", sub: "~8 min", fee: "2.5%", barHex: "var(--color-info)" },
    { key: "cheap" as const, label: "Cheapest", sub: "~15 min", fee: "1.5%", barHex: "var(--color-success)" },
  ] as const;

  const features = [
    { icon: <ShieldCheck className="w-5 h-5" />, title: "Escrow Protection", desc: "On-chain escrow backs every trade — funds locked before you pay." },
    { icon: <Banknote className="w-5 h-5" />, title: "Local Payments", desc: "Bank transfer, UPI, cash, and 50+ regional methods." },
    { icon: <Clock className="w-5 h-5" />, title: "Fast Settlement", desc: "Average trade settles in under 4 minutes." },
    { icon: <BadgeCheck className="w-5 h-5" />, title: "Verified Merchants", desc: "Every merchant is KYB-verified before going live." },
    { icon: <Fingerprint className="w-5 h-5" />, title: "Your Keys, Your Coins", desc: "Connect your own Solana wallet — non-custodial by design." },
    { icon: <Globe className="w-5 h-5" />, title: "Global Corridors", desc: "INR, AED, USD, and growing — borderless settlement." },
  ];

  const demoRate = demoPriority === "fast" ? 3.694 : demoPriority === "best" ? 3.672 : 3.651;
  const demoFee = demoPriority === "fast" ? 3.0 : demoPriority === "best" ? 2.5 : 1.5;
  const demoAmount = 100;
  const demoFiat = (demoAmount * demoRate).toFixed(2);

  const goToMerchant = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/market/login";
    }
  };

  const scrollToChooser = () => {
    if (typeof window === "undefined") return;
    const el = document.getElementById("role-chooser");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex-1 w-full mx-auto flex flex-col text-text-primary overflow-y-auto relative" style={{ background: "var(--color-bg-primary, #060606)" }}>
      {/* Global ambient glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full blur-[160px] opacity-60"
          style={{ background: "radial-gradient(closest-side, rgba(249,115,22,0.18), transparent)" }}
        />
        <div className="absolute top-[40%] -left-40 w-[600px] h-[600px] rounded-full blur-[140px] opacity-40"
          style={{ background: "radial-gradient(closest-side, rgba(96,165,250,0.10), transparent)" }}
        />
        <div className="absolute top-[60%] -right-40 w-[500px] h-[500px] rounded-full blur-[140px] opacity-40"
          style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.08), transparent)" }}
        />
      </div>

      {/* ─── NAVIGATION BAR ─────────────────────────────── */}
      <nav className="relative z-20 w-full border-b border-white/[0.04] backdrop-blur-md" style={{ background: "rgba(6,6,6,0.6)" }}>
        <div className="max-w-7xl mx-auto px-5 md:px-8 lg:px-12 h-16 md:h-18 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-text-primary fill-current" />
            </div>
            <span className="text-[17px] leading-none">
              <span className="font-bold text-text-primary">Blip</span>{" "}
              <span className="italic text-text-secondary">money</span>
            </span>
          </div>
          <div className="flex items-center gap-1 md:gap-2">
            <button
              onClick={scrollToChooser}
              className="px-3 md:px-4 py-2 rounded-lg text-[13px] font-semibold text-text-secondary hover:text-text-primary hover:bg-white/5 transition-all"
            >
              Sign In
            </button>
            <button
              onClick={scrollToChooser}
              className="px-3 md:px-5 py-2 rounded-lg text-[13px] font-bold bg-white text-black hover:bg-neutral-200 transition-all flex items-center gap-1.5"
            >
              Get Started
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl w-full mx-auto px-5 md:px-8 lg:px-12">

        {/* ─── HERO ──────────────────────────────────────── */}
        <motion.section
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="pt-12 md:pt-20 lg:pt-28 pb-12 md:pb-16 flex flex-col items-center text-center"
        >
          <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] mb-6 md:mb-8">
            <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--color-warning)" }} />
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase text-text-secondary">
              Peer-to-peer · Escrow-backed
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="text-[34px] sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-text-primary leading-[1.05] tracking-tight max-w-4xl"
          >
            The safest way to{" "}
            <span className="relative inline-block">
              <span className="relative z-10" style={{
                background: "linear-gradient(135deg, #f97316 0%, #fbbf24 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}>
                trade USDT
              </span>
            </span>
            <br className="hidden sm:block" />
            <span className="sm:hidden"> </span>
            with real people.
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-[14px] md:text-[17px] text-text-secondary leading-relaxed max-w-2xl mt-5 md:mt-7"
          >
            Buy and sell crypto with verified merchants worldwide. On-chain escrow
            protects every trade. Settle in minutes, not days.
          </motion.p>

          {/* Stats inline */}
          <motion.div variants={fadeUp} className="mt-8 md:mt-10 flex flex-wrap items-center justify-center gap-x-8 md:gap-x-12 gap-y-3">
            {[
              { value: "2.4M+", label: "Trades settled" },
              { value: "1,200+", label: "Verified merchants" },
              { value: "< 4 min", label: "Avg. settlement" },
              { value: "99.9%", label: "Uptime" },
            ].map((s, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <span className="text-lg md:text-xl font-bold text-text-primary font-mono tracking-tight">{s.value}</span>
                <span className="text-[11px] md:text-[12px] text-text-tertiary">{s.label}</span>
              </div>
            ))}
          </motion.div>
        </motion.section>

        {/* ─── ROLE CHOOSER (PRIMARY CTA) ─────────────────── */}
        <section id="role-chooser" className="pb-16 md:pb-24 scroll-mt-24">
          <div className="text-center mb-6 md:mb-8">
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase text-text-tertiary mb-2">
              Choose how you want to use Blip
            </p>
            <h2 className="text-xl md:text-2xl font-bold text-text-primary">
              Which one are you?
            </h2>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 max-w-4xl mx-auto"
          >
            {/* USER CARD */}
            <button
              onClick={onSignIn}
              className="group relative text-left p-6 md:p-7 rounded-2xl border border-white/[0.08] hover:border-white/25 transition-all duration-300 overflow-hidden"
              style={{ background: "linear-gradient(160deg, rgba(96,165,250,0.08) 0%, rgba(255,255,255,0.02) 60%)" }}
            >
              {/* Hover glow */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ background: "radial-gradient(circle at 30% 0%, rgba(96,165,250,0.15), transparent 60%)" }}
              />
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4 md:mb-6">
                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center border border-white/10"
                    style={{ background: "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(96,165,250,0.04))" }}
                  >
                    <UserIcon className="w-6 h-6 md:w-7 md:h-7" style={{ color: "var(--color-info)" }} />
                  </div>
                  <div className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.08]">
                    <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-text-tertiary">For traders</span>
                  </div>
                </div>

                <h3 className="text-2xl md:text-[26px] font-bold text-text-primary mb-2 tracking-tight">
                  I&apos;m a User
                </h3>
                <p className="text-[13px] md:text-[14px] text-text-secondary leading-relaxed mb-5 md:mb-6">
                  Buy and sell USDT with verified merchants. Pick the best rate, pay your way, settle on-chain.
                </p>

                <ul className="space-y-2 mb-6 md:mb-7">
                  {[
                    "Trade with INR, AED, USD",
                    "Bank transfer, UPI, or cash",
                    "Escrow-protected every time",
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-[12.5px] text-text-secondary">
                      <div className="w-1 h-1 rounded-full bg-text-tertiary flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
                  <span className="text-[13px] font-semibold text-text-primary">
                    Continue as User
                  </span>
                  <div className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center group-hover:bg-white group-hover:text-black transition-all">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </button>

            {/* MERCHANT CARD */}
            <button
              onClick={goToMerchant}
              className="group relative text-left p-6 md:p-7 rounded-2xl border border-white/[0.08] hover:border-white/25 transition-all duration-300 overflow-hidden"
              style={{ background: "linear-gradient(160deg, rgba(249,115,22,0.08) 0%, rgba(255,255,255,0.02) 60%)" }}
            >
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ background: "radial-gradient(circle at 30% 0%, rgba(249,115,22,0.18), transparent 60%)" }}
              />
              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4 md:mb-6">
                  <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center border border-white/10"
                    style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.20), rgba(249,115,22,0.04))" }}
                  >
                    <Store className="w-6 h-6 md:w-7 md:h-7" style={{ color: "#f97316" }} />
                  </div>
                  <div className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.08]">
                    <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-text-tertiary">For businesses</span>
                  </div>
                </div>

                <h3 className="text-2xl md:text-[26px] font-bold text-text-primary mb-2 tracking-tight">
                  I&apos;m a Merchant
                </h3>
                <p className="text-[13px] md:text-[14px] text-text-secondary leading-relaxed mb-5 md:mb-6">
                  Run a desk, accept orders from real users, and earn on every settled trade. KYB-verified merchants only.
                </p>

                <ul className="space-y-2 mb-6 md:mb-7">
                  {[
                    "Manage liquidity & offers",
                    "Earn on every trade",
                    "Real-time order routing",
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-[12.5px] text-text-secondary">
                      <div className="w-1 h-1 rounded-full bg-text-tertiary flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
                  <span className="text-[13px] font-semibold text-text-primary">
                    Continue as Merchant
                  </span>
                  <div className="w-9 h-9 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center group-hover:bg-white group-hover:text-black transition-all">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </button>
          </motion.div>

          <p className="text-center text-[12px] text-text-tertiary mt-6">
            Already have an account?{" "}
            <button onClick={onSignIn} className="text-text-secondary hover:text-text-primary font-semibold underline underline-offset-2 transition-colors">
              Sign in
            </button>
          </p>
        </section>

        {/* ─── PRODUCT PREVIEW ──────────────────────────── */}
        <section className="pb-16 md:pb-24 lg:pb-32">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* Left — copy */}
            <div className="order-2 lg:order-1 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] mb-4">
                <TrendingUp className="w-3 h-3 text-text-tertiary" />
                <span className="text-[10px] font-semibold tracking-[0.15em] uppercase text-text-tertiary">Live preview</span>
              </div>

              <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-text-primary leading-[1.1] tracking-tight mb-4 md:mb-5">
                Three taps from decision to settlement.
              </h2>
              <p className="text-[14px] md:text-[15px] text-text-secondary leading-relaxed mb-6 max-w-lg mx-auto lg:mx-0">
                Pick a side, choose your priority, hit go. Funds lock in escrow the moment a merchant matches.
                You see the rate, the fee, and the receive amount — no surprises.
              </p>

              <div className="space-y-3 mb-7 max-w-md mx-auto lg:mx-0">
                {[
                  { num: "1", title: "Choose buy or sell", desc: "Pick your direction and the amount" },
                  { num: "2", title: "Set your priority", desc: "Fastest, best rate, or cheapest" },
                  { num: "3", title: "Settle on-chain", desc: "Merchant matches, escrow locks, you settle" },
                ].map((step) => (
                  <div key={step.num} className="flex items-start gap-3 text-left">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/[0.05] border border-white/[0.10] flex items-center justify-center text-[12px] font-bold text-text-primary font-mono">
                      {step.num}
                    </div>
                    <div>
                      <p className="text-[13px] md:text-[14px] font-semibold text-text-primary">{step.title}</p>
                      <p className="text-[12px] text-text-tertiary leading-relaxed">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={onGetStarted}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white text-black font-bold text-[14px] hover:bg-neutral-200 transition-all"
              >
                Start your first trade
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Right — phone mockup */}
            <div className="order-1 lg:order-2 flex justify-center lg:justify-end">
              <div className="relative w-full" style={{ maxWidth: 340 }}>
                <div className="absolute -inset-10 rounded-full blur-[80px] opacity-50 pointer-events-none"
                  style={{ background: "radial-gradient(closest-side, rgba(249,115,22,0.20), transparent)" }}
                />

                <div className="relative rounded-[40px] border-[3px] border-white/10 bg-[#0a0a0a] overflow-hidden shadow-2xl"
                  style={{ boxShadow: "0 40px 80px -20px rgba(0,0,0,0.6), 0 0 60px -20px rgba(249,115,22,0.12)" }}
                >
                  <div className="flex justify-center pt-2 pb-1">
                    <div className="w-24 h-6 rounded-full bg-black border border-white/[0.06]" />
                  </div>

                  <div className="flex items-center justify-between px-6 py-1.5">
                    <span className="text-[9px] font-semibold text-white/40 font-mono">9:41</span>
                    <div className="flex items-center gap-1">
                      <div className="flex gap-[2px]">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="w-[3px] rounded-sm bg-white/40" style={{ height: 4 + i * 2 }} />
                        ))}
                      </div>
                      <div className="w-5 h-2.5 rounded-sm border border-white/30 ml-1 relative">
                        <div className="absolute inset-[1px] rounded-[1px] bg-white/40" style={{ width: "70%" }} />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-white fill-current" />
                      <span className="text-[13px] font-bold text-white">Blip</span>
                      <span className="text-[13px] italic text-white/60">money</span>
                    </div>
                    <div className="w-6 h-6 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                      <Wallet className="w-3 h-3 text-white/40" />
                    </div>
                  </div>

                  <div className="px-3 py-3 space-y-2.5">
                    {/* Buy/Sell toggle */}
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { type: "buy" as const, label: "Buy", sub: "Get USDT", Icon: ArrowDownLeft, color: "var(--color-success)" },
                        { type: "sell" as const, label: "Sell", sub: "Send USDT", Icon: ArrowUpRight, color: "var(--color-error)" },
                      ]).map(({ type, label, sub, Icon, color }) => {
                        const on = demoType === type;
                        return (
                          <motion.button
                            key={type}
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setDemoType(type)}
                            className={`flex items-center justify-between rounded-xl py-2 px-2.5 ${
                              on ? "border-[1.5px] border-white/40 bg-white/[0.04]" : "border border-white/[0.06] bg-white/[0.02]"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-lg flex items-center justify-center"
                                style={on ? { background: `${color}22` } : { background: "rgba(255,255,255,0.03)" }}
                              >
                                <Icon size={12} strokeWidth={2.5} style={{ color: on ? color : "rgba(255,255,255,0.4)" }} />
                              </div>
                              <div className="flex flex-col text-left">
                                <p className="text-[11px] font-bold text-white">{label}</p>
                                <p className="text-[8px] font-medium text-white/40">{sub}</p>
                              </div>
                            </div>
                            {on && <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />}
                          </motion.button>
                        );
                      })}
                    </div>

                    {/* Amount card */}
                    <div className="w-full rounded-2xl flex flex-col items-center py-3 px-2.5 bg-white/[0.02] border border-white/[0.06]">
                      <p className="text-[8px] font-bold tracking-[0.2em] text-white/40 uppercase mb-1">
                        {demoType === "buy" ? "You Pay (USDT)" : "You Sell (USDT)"}
                      </p>
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="text-[32px] font-extrabold tracking-[-0.06em] leading-none text-white">{demoAmount}</span>
                        <span className="text-[13px] font-bold text-white/40">USDT</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[16px] font-bold tracking-[-0.02em] text-white/70">د.إ{demoFiat}</span>
                        <span className="text-[10px] font-semibold text-white/40">AED</span>
                      </div>

                      <div className="flex items-center gap-3 mt-2 pt-2 w-full border-t border-white/[0.06]">
                        <div className="flex-1 text-center">
                          <p className="text-[7px] font-bold tracking-[0.15em] text-white/40 uppercase mb-[2px]">Fee</p>
                          <p className="text-[11px] font-extrabold text-white/80">{demoFee.toFixed(1)}%</p>
                        </div>
                        <div className="w-px h-5 bg-white/[0.06]" />
                        <div className="flex-1 text-center">
                          <p className="text-[7px] font-bold tracking-[0.15em] text-white/40 uppercase mb-[2px]">Rate</p>
                          <p className="text-[11px] font-extrabold text-white/80">د.إ{demoRate.toFixed(3)}</p>
                        </div>
                        <div className="w-px h-5 bg-white/[0.06]" />
                        <div className="flex-1 text-center">
                          <p className="text-[7px] font-bold tracking-[0.15em] text-white/40 uppercase mb-[2px]">You Get</p>
                          <p className="text-[11px] font-extrabold text-white">
                            {demoType === "buy" ? `${demoAmount} USDT` : `د.إ${demoFiat}`}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Pay via */}
                    <div>
                      <p className="text-[8px] font-bold tracking-[0.2em] text-white/40 uppercase mb-1.5">Pay via</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { method: "bank", label: "Bank Transfer", sub: "Wire / IBAN", Icon: Building2 },
                          { method: "cash", label: "Cash", sub: "Meet in person", Icon: Banknote },
                        ]).map(({ method, label, sub, Icon }) => {
                          const on = method === "bank";
                          return (
                            <div
                              key={method}
                              className={`flex items-center gap-2 rounded-xl py-2 px-2.5 ${
                                on ? "border-[1.5px] border-white/40 bg-white/[0.04]" : "border border-white/[0.06] bg-white/[0.02]"
                              }`}
                            >
                              <div className="w-5 h-5 rounded-lg flex items-center justify-center bg-white/[0.04]">
                                <Icon size={11} className="text-white/70" />
                              </div>
                              <div className="flex flex-col">
                                <p className="text-[10px] font-bold text-white">{label}</p>
                                <p className="text-[7px] font-medium text-white/40">{sub}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Priority */}
                    <div>
                      <p className="text-[8px] font-bold tracking-[0.2em] text-white/40 uppercase mb-1.5">Priority</p>
                      <div className="flex gap-1.5">
                        {priorities.map(({ key, label, sub, fee, barHex }) => {
                          const on = demoPriority === key;
                          return (
                            <motion.button
                              key={key}
                              whileTap={{ scale: 0.96 }}
                              onClick={() => setDemoPriority(key)}
                              className={`flex-1 rounded-xl py-1.5 px-2 bg-white/[0.02] ${
                                on ? "border-[1.5px]" : "border border-white/[0.06]"
                              }`}
                              style={on ? { borderColor: barHex, boxShadow: `0 2px 8px ${barHex}22` } : undefined}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex flex-col items-start leading-tight">
                                  <p className="text-[9px] font-bold text-white">{label}</p>
                                  <p className="text-[7px] font-medium text-white/40">{sub}</p>
                                </div>
                                <div className="flex items-center justify-center h-4 px-1 rounded-full border"
                                  style={{ background: `${barHex}15`, borderColor: `${barHex}40` }}
                                >
                                  <span className="text-[8px] font-semibold leading-none" style={{ color: barHex }}>{fee}</span>
                                </div>
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Trade button */}
                    <button
                      onClick={onGetStarted}
                      className="w-full py-3 bg-white text-black rounded-xl font-bold text-[12px] hover:bg-neutral-200 transition-all flex items-center justify-center gap-1.5"
                    >
                      Start Trading <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex justify-center py-2">
                    <div className="w-28 h-1 rounded-full bg-white/15" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── FEATURES GRID ────────────────────────────── */}
        <section className="pb-16 md:pb-24 border-t border-white/[0.04] pt-16 md:pt-24">
          <div className="text-center mb-10 md:mb-14">
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase text-text-tertiary mb-3">
              Why Blip
            </p>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-text-primary tracking-tight max-w-3xl mx-auto leading-[1.1]">
              Built for safety. Designed for speed.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {features.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="p-5 md:p-6 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.10] transition-all"
              >
                <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-text-secondary mb-4">
                  {f.icon}
                </div>
                <h3 className="text-[15px] font-bold text-text-primary mb-1.5">{f.title}</h3>
                <p className="text-[12.5px] text-text-tertiary leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ─── SAFETY / TRUST SECTION ───────────────────── */}
        <section className="pb-16 md:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5 }}
            className="relative rounded-3xl border border-white/[0.08] overflow-hidden p-8 md:p-12 lg:p-16"
            style={{
              background:
                "linear-gradient(135deg, rgba(16,185,129,0.10) 0%, rgba(255,255,255,0.02) 50%, rgba(96,165,250,0.06) 100%)",
            }}
          >
            <div className="absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full blur-[120px] opacity-50"
              style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.15), transparent)" }}
            />

            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.10] mb-4">
                  <ShieldCheck className="w-3.5 h-3.5" style={{ color: "var(--color-success)" }} />
                  <span className="text-[11px] font-semibold tracking-[0.15em] uppercase" style={{ color: "var(--color-success)" }}>
                    Your safety
                  </span>
                </div>
                <h3 className="text-2xl md:text-3xl lg:text-4xl font-extrabold text-text-primary leading-tight tracking-tight mb-4">
                  Every trade is protected — by code, not promises.
                </h3>
                <p className="text-[13px] md:text-[15px] text-text-secondary leading-relaxed">
                  Sellers lock crypto into an on-chain escrow before you send a single fiat payment.
                  If anything goes wrong, our compliance team reviews evidence and resolves disputes — fast.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { icon: <Lock className="w-4 h-4" />, title: "Escrow first, payment second", desc: "Crypto locks before you transfer fiat" },
                  { icon: <Clock className="w-4 h-4" />, title: "Auto-cancel inactive trades", desc: "Funds return if a counterparty goes silent" },
                  { icon: <BadgeCheck className="w-4 h-4" />, title: "KYB-verified merchants", desc: "Every merchant is business-verified before listing" },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
                    <div className="w-9 h-9 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center flex-shrink-0 text-text-primary">
                      {item.icon}
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-text-primary mb-0.5">{item.title}</p>
                      <p className="text-[12px] text-text-tertiary leading-relaxed">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </section>

        {/* ─── FINAL CTA ────────────────────────────────── */}
        <section className="pb-16 md:pb-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.5 }}
            className="relative rounded-3xl overflow-hidden p-10 md:p-16 text-center"
            style={{
              background:
                "linear-gradient(135deg, #f97316 0%, #ea580c 50%, #c2410c 100%)",
            }}
          >
            <div className="absolute inset-0 opacity-30"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.25), transparent 40%), radial-gradient(circle at 80% 80%, rgba(255,255,255,0.15), transparent 40%)",
              }}
            />

            <div className="relative z-10 max-w-2xl mx-auto">
              <h3 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight mb-3 md:mb-4">
                Ready to trade?
              </h3>
              <p className="text-[14px] md:text-[16px] text-white/85 leading-relaxed mb-7 md:mb-8 max-w-md mx-auto">
                Create a free account in seconds. Connect your wallet, pick a merchant, settle on-chain.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto">
                <button
                  onClick={onGetStarted}
                  className="flex-1 py-3.5 bg-white text-black rounded-xl font-bold text-[14px] hover:bg-neutral-100 transition-all flex items-center justify-center gap-2"
                >
                  Create Free Account
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  onClick={goToMerchant}
                  className="flex-1 py-3.5 bg-black/30 hover:bg-black/40 text-white border border-white/30 rounded-xl font-bold text-[14px] transition-all backdrop-blur-sm"
                >
                  I&apos;m a Merchant
                </button>
              </div>
            </div>
          </motion.div>
        </section>

        {/* ─── FOOTER ───────────────────────────────────── */}
        <footer className="border-t border-white/[0.04] pt-8 md:pt-10 pb-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-text-secondary fill-current" />
              <span className="text-[13px] text-text-secondary">
                <span className="font-bold">Blip</span> <span className="italic">money</span> · v1.0
              </span>
            </div>
            <div className="flex items-center gap-5 text-[12px] text-text-tertiary">
              <a href="#" className="hover:text-text-secondary transition-colors">Privacy</a>
              <a href="#" className="hover:text-text-secondary transition-colors">Terms</a>
              <a href="#" className="hover:text-text-secondary transition-colors">Risk</a>
              <a href="/market" className="hover:text-text-secondary transition-colors">Merchant Portal</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
