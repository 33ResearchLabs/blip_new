"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Store,
  ShieldCheck,
  ArrowRightLeft,
  Lock,
  MessageSquare,
  CheckCircle2,
  TrendingUp,
  Clock,
  Wallet,
  ChevronRight,
  Globe,
  BarChart3,
  Users,
  BadgeCheck,
  CreditCard,
} from "lucide-react";

const stagger = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

interface MerchantWelcomePageProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export function MerchantWelcomePage({ onGetStarted, onSignIn }: MerchantWelcomePageProps) {
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  const steps = [
    {
      icon: <Store className="w-5 h-5" />,
      title: "Create Your Desk",
      desc: "Set up your merchant profile, payment methods, and trading corridors.",
    },
    {
      icon: <ArrowRightLeft className="w-5 h-5" />,
      title: "Publish Offers",
      desc: "Set your rates and spreads. Users see your offers in the marketplace.",
    },
    {
      icon: <Lock className="w-5 h-5" />,
      title: "Escrow & Trade",
      desc: "Funds lock in escrow automatically. Chat with buyers in real-time.",
    },
    {
      icon: <CheckCircle2 className="w-5 h-5" />,
      title: "Confirm & Earn",
      desc: "Verify payment, release escrow, and collect your spread instantly.",
    },
  ];

  const features = [
    {
      icon: <BarChart3 className="w-6 h-6" />,
      title: "Analytics Dashboard",
      desc: "Track volume, completion rates, and earnings in real-time.",
    },
    {
      icon: <ShieldCheck className="w-6 h-6" />,
      title: "Escrow Protection",
      desc: "Every trade is backed by on-chain escrow. Zero counterparty risk.",
    },
    {
      icon: <Globe className="w-6 h-6" />,
      title: "Multi-Corridor",
      desc: "Trade across INR, AED, USD and 50+ local payment rails.",
    },
    {
      icon: <Clock className="w-6 h-6" />,
      title: "Auto-Expiry",
      desc: "Idle trades expire automatically so your capital is never stuck.",
    },
    {
      icon: <MessageSquare className="w-6 h-6" />,
      title: "Built-in Chat",
      desc: "Communicate with counterparties without leaving the platform.",
    },
    {
      icon: <Wallet className="w-6 h-6" />,
      title: "Instant Settlement",
      desc: "Funds hit your wallet the moment you confirm payment.",
    },
  ];

  const stats = [
    { value: "1,200+", label: "Active Merchants" },
    { value: "2.4M+", label: "Trades Completed" },
    { value: "3.5 min", label: "Avg. Settlement" },
    { value: "99.9%", label: "Platform Uptime" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-primary/[0.04] rounded-full blur-[180px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-primary/[0.02] rounded-full blur-[150px]" />
      </div>

      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-background/60 backdrop-blur-xl border-b border-foreground/[0.04]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Zap className="w-6 h-6 text-primary fill-primary" />
            <span className="text-lg leading-none">
              <span className="font-bold text-foreground">Blip</span>{" "}
              <span className="italic text-foreground/80">money</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onSignIn}
              className="text-sm text-foreground/40 hover:text-foreground transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={onGetStarted}
              className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      <main className="relative pt-14">
        {/* ─── HERO ──────────────────────────────────────────── */}
        <section className="px-6 pt-20 pb-24 max-w-4xl mx-auto text-center">
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="visible"
            className="flex flex-col items-center"
          >
            <motion.div variants={fadeUp}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[11px] font-bold uppercase tracking-widest mb-6">
                <Store className="w-3 h-3" /> Merchant Portal
              </div>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-foreground leading-[1.1] tracking-tight mb-5"
            >
              Run Your Own{" "}
              <span className="text-primary">P2P Desk</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="text-base sm:text-lg text-foreground/40 max-w-xl leading-relaxed mb-10"
            >
              Create liquidity, set your own spreads, and earn from every trade.
              Backed by on-chain escrow and real-time settlement on Blip Money.
            </motion.p>

            <motion.div
              variants={fadeUp}
              className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto"
            >
              <button
                onClick={onGetStarted}
                className="w-full sm:w-auto px-8 py-3.5 bg-primary text-white rounded-2xl font-bold text-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
              >
                Start as Merchant <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={onSignIn}
                className="w-full sm:w-auto px-8 py-3.5 bg-foreground/[0.04] border border-foreground/[0.06] text-foreground rounded-2xl font-bold text-sm hover:bg-foreground/[0.08] transition-all"
              >
                I Have an Account
              </button>
            </motion.div>
          </motion.div>

          {/* Stats strip */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20 pt-10 border-t border-foreground/[0.04]"
          >
            {stats.map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-xl sm:text-2xl font-bold text-foreground mb-1 font-mono">
                  {s.value}
                </div>
                <div className="text-[11px] text-foreground/30 uppercase tracking-wider">
                  {s.label}
                </div>
              </div>
            ))}
          </motion.div>
        </section>

        {/* ─── HOW IT WORKS ──────────────────────────────────── */}
        <section className="px-6 py-20 max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            className="text-center mb-14"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
              How It Works
            </h2>
            <p className="text-sm text-foreground/30">
              Four steps from setup to earning
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map((step, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
                onMouseEnter={() => setHoveredStep(i)}
                onMouseLeave={() => setHoveredStep(null)}
                className="relative group p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/[0.04] hover:border-primary/20 transition-all cursor-default"
              >
                {/* Step number watermark */}
                <div className="absolute top-3 right-4 text-5xl font-black text-foreground/[0.03] select-none">
                  {i + 1}
                </div>
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-colors ${
                    hoveredStep === i
                      ? "bg-primary/15 text-primary"
                      : "bg-foreground/[0.04] text-foreground/40"
                  }`}
                >
                  {step.icon}
                </div>
                <h4 className="text-sm font-bold text-foreground mb-1.5">
                  {step.title}
                </h4>
                <p className="text-xs text-foreground/30 leading-relaxed">
                  {step.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ─── FEATURES GRID ─────────────────────────────────── */}
        <section className="px-6 py-20 max-w-5xl mx-auto">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            className="text-center mb-14"
          >
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground mb-3">
              Built for Professionals
            </h2>
            <p className="text-sm text-foreground/30">
              Everything you need to run a high-volume desk
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                className="group p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/[0.04] hover:border-foreground/[0.08] transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-foreground/[0.04] flex items-center justify-center mb-4 text-foreground/50 group-hover:text-primary group-hover:bg-primary/10 transition-colors">
                  {f.icon}
                </div>
                <h4 className="text-sm font-bold text-foreground mb-1.5">
                  {f.title}
                </h4>
                <p className="text-xs text-foreground/30 leading-relaxed">
                  {f.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ─── MERCHANT BENEFITS BENTO ────────────────────────── */}
        <section className="px-6 py-20 max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Large card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="md:col-span-2 p-8 sm:p-10 rounded-3xl bg-primary/[0.06] border border-primary/10"
            >
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="w-5 h-5 text-primary" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-primary/70">
                  Earn More
                </span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 leading-tight">
                Set Your Own Spreads. <br className="hidden sm:block" />
                Keep 100% of Your Margin.
              </h3>
              <p className="text-sm text-foreground/35 leading-relaxed max-w-md mb-8">
                No platform fees on trades. You control your pricing corridors,
                minimum order sizes, and accepted payment methods.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { icon: <BadgeCheck className="w-4 h-4" />, text: "Verified merchant badge for trust" },
                  { icon: <Users className="w-4 h-4" />, text: "Featured on leaderboard by volume" },
                  { icon: <CreditCard className="w-4 h-4" />, text: "Accept 50+ payment methods" },
                  { icon: <ShieldCheck className="w-4 h-4" />, text: "Dispute resolution support" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="text-primary/60">{item.icon}</div>
                    <span className="text-xs text-foreground/50">{item.text}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Side card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="p-8 rounded-3xl bg-foreground/[0.02] border border-foreground/[0.04] flex flex-col items-center justify-center text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
                <Wallet className="w-8 h-8 text-primary" />
              </div>
              <h4 className="text-lg font-bold text-foreground mb-2">
                KYB Verified
              </h4>
              <p className="text-xs text-foreground/30 mb-5 leading-relaxed">
                Complete verification to unlock full trading limits and earn user trust.
              </p>
              <div className="px-4 py-1.5 bg-primary/15 text-primary rounded-full text-[10px] font-bold uppercase tracking-widest">
                Trusted & Secure
              </div>
            </motion.div>
          </div>
        </section>

        {/* ─── FINAL CTA ─────────────────────────────────────── */}
        <section className="px-6 py-20 max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="relative overflow-hidden p-10 sm:p-16 rounded-[32px] bg-primary text-center"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent)]" />
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 relative z-10">
              Ready to Start Earning?
            </h2>
            <p className="text-white/60 text-sm sm:text-base mb-8 max-w-md mx-auto relative z-10">
              Join 1,200+ merchants already trading on Blip Money.
              Set up takes less than 5 minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 relative z-10">
              <button
                onClick={onGetStarted}
                className="w-full sm:w-auto px-10 py-4 bg-white text-primary rounded-2xl font-bold text-sm hover:bg-white/90 transition-all shadow-xl"
              >
                Create Merchant Account
              </button>
              <button
                onClick={onSignIn}
                className="w-full sm:w-auto px-10 py-4 bg-white/10 text-white border border-white/20 rounded-2xl font-bold text-sm hover:bg-white/20 transition-all"
              >
                Sign In
              </button>
            </div>
          </motion.div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-foreground/[0.04] py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary fill-primary" />
            <span className="text-sm font-bold text-foreground">
              Blip <span className="italic font-normal text-foreground/60">money</span>
            </span>
          </div>
          <div className="flex gap-6 text-[11px] text-foreground/20">
            <a href="#" className="hover:text-foreground/40 transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground/40 transition-colors">Terms</a>
            <a href="#" className="hover:text-foreground/40 transition-colors">Risk Warning</a>
          </div>
          <p className="text-[11px] text-foreground/15 font-mono">
            Blip Money v1.0
          </p>
        </div>
      </footer>
    </div>
  );
}
