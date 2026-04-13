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
  TrendingUp,
  Building2,
} from "lucide-react";

const stagger = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.07, delayChildren: 0.15 },
  },
};

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};

const SECTION_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";
const CARD = "bg-surface-card border border-border-subtle";

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
    { icon: <ShieldCheck className="w-5 h-5" />, title: "Escrow Protection", desc: "On-chain escrow backs every trade" },
    { icon: <Banknote className="w-5 h-5" />, title: "Local Payments", desc: "Bank, UPI, cash & 50+ methods" },
    { icon: <Clock className="w-5 h-5" />, title: "Fast Settlement", desc: "Average trade under 4 minutes" },
    { icon: <BadgeCheck className="w-5 h-5" />, title: "Verified Merchants", desc: "Every merchant is KYB-verified" },
    { icon: <Fingerprint className="w-5 h-5" />, title: "Your Keys", desc: "Connect your own Solana wallet" },
    { icon: <Globe className="w-5 h-5" />, title: "Global Access", desc: "INR, AED, USD and growing" },
  ];

  // Demo rate based on priority
  const demoRate = demoPriority === "fast" ? 3.694 : demoPriority === "best" ? 3.672 : 3.651;
  const demoFee = demoPriority === "fast" ? 3.0 : demoPriority === "best" ? 2.5 : 1.5;
  const demoAmount = 100;
  const demoFiat = (demoAmount * demoRate).toFixed(2);

  return (
    <div className="flex-1 w-full max-w-[440px] mx-auto flex flex-col bg-surface-base text-text-primary overflow-y-auto">
      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-warning/[0.04] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col px-5 pb-10">

        {/* ─── HERO ──────────────────────────────────────── */}
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="visible"
          className="flex flex-col items-center text-center pt-14 pb-8"
        >
          <motion.div variants={fadeUp} className="mb-6">
            <div className="w-16 h-16 rounded-2xl bg-surface-card border border-border-subtle flex items-center justify-center">
              <Zap className="w-8 h-8 text-text-primary fill-current" />
            </div>
          </motion.div>

          <motion.div variants={fadeUp}>
            <span className="text-[22px] leading-none">
              <span className="font-bold text-text-primary">Blip</span>{" "}
              <span className="italic text-text-secondary">money</span>
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="text-2xl font-extrabold text-text-primary leading-tight tracking-tight mt-4 mb-2"
          >
            Buy & Sell USDT Safely
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-[13px] text-text-secondary leading-relaxed max-w-[320px] mb-8"
          >
            Exchange fiat for crypto with verified merchants. Zero fees, escrow protection, real-time settlement.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col gap-2.5 w-full">
            <button
              onClick={onGetStarted}
              className="w-full py-3.5 bg-accent text-accent-text rounded-xl font-bold text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2"
            >
              Start Trading <ChevronRight className="w-4 h-4" />
            </button>
            <button
              onClick={onSignIn}
              className="w-full py-3.5 bg-surface-card border border-border-subtle text-text-primary rounded-xl font-bold text-sm hover:bg-surface-hover transition-all"
            >
              I Have an Account
            </button>
          </motion.div>
        </motion.div>

        {/* ─── STATS ─────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="grid grid-cols-2 gap-3 mb-8"
        >
          {[
            { value: "2.4M+", label: "Trades" },
            { value: "1,200+", label: "Merchants" },
            { value: "< 4 min", label: "Avg. Time" },
            { value: "99.9%", label: "Uptime" },
          ].map((s, i) => (
            <div key={i} className="text-center py-3 rounded-xl bg-surface-card border border-border-subtle">
              <div className="text-base font-bold text-text-primary font-mono">{s.value}</div>
              <div className="text-[10px] text-text-tertiary uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </motion.div>

        {/* ─── INTERACTIVE TRADE PREVIEW ──────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mb-8"
        >
          <p className={`${SECTION_LABEL} mb-3`}>See How It Works</p>

          {/* Buy / Sell toggle — same as TradeCreationScreen */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            {([
              { type: "buy" as const, label: "Buy", sub: "Get USDT", Icon: ArrowDownLeft,
                iconBgOn: "bg-[var(--color-success)]/15", iconOn: "text-[var(--color-success)]",
                dotClass: "bg-[var(--color-success)]",
                iconBgOnStyle: { backgroundColor: 'var(--color-success-dim)' },
                iconOnStyle: { color: 'var(--color-success)' },
                dotStyle: { backgroundColor: 'var(--color-success)' },
              },
              { type: "sell" as const, label: "Sell", sub: "Send USDT", Icon: ArrowUpRight,
                iconBgOn: "bg-[var(--color-error)]/15", iconOn: "text-[var(--color-error)]",
                dotClass: "bg-[var(--color-error)]",
                iconBgOnStyle: { backgroundColor: 'var(--color-error-dim)' },
                iconOnStyle: { color: 'var(--color-error)' },
                dotStyle: { backgroundColor: 'var(--color-error)' },
              },
            ]).map(({ type, label, sub, Icon, iconBgOnStyle, iconOnStyle, dotStyle }) => {
              const on = demoType === type;
              return (
                <motion.button
                  key={type}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setDemoType(type)}
                  className={`flex items-center justify-between rounded-[16px] py-2.5 px-3 bg-surface-card ${
                    on ? "border-[1.5px] border-text-secondary shadow-[0_4px_14px_rgba(0,0,0,0.3)]" : "border border-border-subtle"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-[10px] flex items-center justify-center"
                      style={on ? iconBgOnStyle : undefined}
                    >
                      <Icon size={16} strokeWidth={2.5} style={on ? iconOnStyle : undefined} className={on ? "" : "text-text-tertiary"} />
                    </div>
                    <div className="flex flex-col text-left">
                      <p className="text-[14px] font-bold text-text-primary">{label}</p>
                      <p className="text-[10px] font-medium text-text-tertiary">{sub}</p>
                    </div>
                  </div>
                  {on && <div className="w-2 h-2 rounded-full" style={dotStyle} />}
                </motion.button>
              );
            })}
          </div>

          {/* Amount preview card */}
          <div className={`w-full rounded-[28px] mb-3 flex flex-col items-center py-4 px-3 ${CARD}`}>
            <p className="text-[10px] font-bold tracking-[0.28em] text-text-tertiary uppercase mb-2">
              {demoType === "buy" ? "You Pay (USDT)" : "You Sell (USDT)"}
            </p>
            <div className="flex items-baseline justify-center gap-1.5">
              <span className="text-[48px] font-extrabold tracking-[-0.06em] leading-none text-text-primary">
                {demoAmount}
              </span>
              <span className="text-[18px] font-bold text-text-tertiary tracking-[-0.01em]">USDT</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[22px] font-bold tracking-[-0.02em] text-text-secondary">
                د.إ{demoFiat}
              </span>
              <span className="text-[12px] font-semibold text-text-tertiary">AED</span>
            </div>

            {/* Fee breakdown */}
            <div className="flex items-center gap-4 mt-3 pt-3 w-full border-t border-border-subtle">
              <div className="flex-1 text-center">
                <p className="text-[9px] font-bold tracking-[0.18em] text-text-tertiary uppercase mb-[3px]">Fee</p>
                <p className="text-[15px] font-extrabold text-text-secondary">{demoFee.toFixed(1)}%</p>
              </div>
              <div className="w-px h-7 bg-border-medium" />
              <div className="flex-1 text-center">
                <p className="text-[9px] font-bold tracking-[0.18em] text-text-tertiary uppercase mb-[3px]">Rate</p>
                <p className="text-[15px] font-extrabold text-text-secondary">د.إ{demoRate.toFixed(3)}</p>
              </div>
              <div className="w-px h-7 bg-border-medium" />
              <div className="flex-1 text-center">
                <p className="text-[9px] font-bold tracking-[0.18em] text-text-tertiary uppercase mb-[3px]">You Get</p>
                <p className="text-[15px] font-extrabold text-text-primary">
                  {demoType === "buy" ? `${demoAmount} USDT` : `د.إ${demoFiat}`}
                </p>
              </div>
            </div>
          </div>

          {/* Pay via — same style as TradeCreation */}
          <div className="mb-3">
            <p className="text-[10px] font-bold tracking-[0.28em] text-text-tertiary uppercase mb-2">Pay via</p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { method: "bank", label: "Bank Transfer", sub: "Wire / IBAN", Icon: Building2 },
                { method: "cash", label: "Cash", sub: "Meet in person", Icon: Banknote },
              ]).map(({ method, label, sub, Icon }) => {
                const on = method === "bank";
                return (
                  <div
                    key={method}
                    className={`flex items-center justify-between rounded-[16px] py-2.5 px-3 bg-surface-card ${
                      on ? "border-[1.5px] border-text-secondary shadow-[0_4px_14px_rgba(0,0,0,0.3)]" : "border border-border-subtle"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-[10px] flex items-center justify-center bg-surface-active">
                        <Icon size={16} className="text-text-secondary" />
                      </div>
                      <div className="flex flex-col">
                        <p className="text-[14px] font-bold text-text-primary">{label}</p>
                        <p className="text-[10px] font-medium text-text-tertiary">{sub}</p>
                      </div>
                    </div>
                    {on && <div className="w-2 h-2 rounded-full bg-accent" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Priority — exact same as TradeCreationScreen */}
          <div className="mb-3">
            <p className="text-[10px] font-bold tracking-[0.28em] text-text-tertiary uppercase mb-3">Priority</p>
            <div className="flex gap-2.5">
              {priorities.map(({ key, label, sub, fee, barHex }) => {
                const on = demoPriority === key;
                return (
                  <motion.button
                    key={key}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setDemoPriority(key)}
                    className={`flex-1 rounded-[16px] py-2.5 px-3 bg-surface-card ${
                      on ? "border-[1.5px]" : "border border-border-subtle"
                    }`}
                    style={on ? { borderColor: barHex, boxShadow: `0 2px 10px ${barHex}22` } : undefined}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col items-start leading-tight">
                        <p className="text-[12px] font-bold text-text-primary">{label}</p>
                        <p className="text-[10px] font-medium text-text-tertiary">{sub}</p>
                      </div>
                      <div
                        className="flex items-center justify-center h-5 px-1 rounded-full border"
                        style={{ background: `${barHex}15`, borderColor: `${barHex}40` }}
                      >
                        <span className="text-[11px] font-semibold leading-none" style={{ color: barHex }}>
                          {fee}
                        </span>
                      </div>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>

          {/* Market rate bar — same style */}
          <div className={`w-full rounded-[24px] overflow-hidden ${CARD}`}>
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="flex-1 min-w-0">
                <p className={`${SECTION_LABEL} mb-[5px]`}>Live Rate · USDT / AED</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-[1.1]">
                    د.إ{demoRate.toFixed(3)}
                  </span>
                  <span className="text-[13px] font-semibold text-text-tertiary">AED</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <TrendingUp size={11} style={{ color: 'var(--color-success)' }} />
                  <span className="text-[11px] font-bold" style={{ color: 'var(--color-success)' }}>
                    +0.24% today
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5 border-t border-border-subtle bg-surface-hover">
              <span className="text-[10px] font-semibold text-text-tertiary tracking-[0.08em]">7D LOW 3.651</span>
              <div className="flex-1 mx-4 h-1 rounded-full bg-border-medium overflow-hidden">
                <div className="h-1 rounded-full w-[68%] bg-text-primary/40" />
              </div>
              <span className="text-[10px] font-semibold text-text-tertiary tracking-[0.08em]">HIGH 3.694</span>
            </div>
          </div>
        </motion.div>

        {/* ─── FEATURES ──────────────────────────────────── */}
        <div className="mb-8">
          <h3 className={`${SECTION_LABEL} mb-3`}>Why Blip</h3>
          <div className="grid grid-cols-2 gap-2">
            {features.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 + i * 0.06, duration: 0.35 }}
                className="p-3.5 rounded-xl bg-surface-card border border-border-subtle"
              >
                <div className="w-8 h-8 rounded-lg bg-surface-hover flex items-center justify-center text-text-tertiary mb-2.5">
                  {f.icon}
                </div>
                <div className="text-[12px] font-semibold text-text-primary mb-0.5">{f.title}</div>
                <div className="text-[10px] text-text-tertiary leading-relaxed">{f.desc}</div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* ─── TRUST CARD ────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1 }}
          className="p-5 rounded-2xl border border-border-subtle mb-8"
          style={{ background: 'var(--color-success-dim)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck className="w-4 h-4" style={{ color: 'var(--color-success)' }} />
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-success)' }}>
              Your Safety
            </span>
          </div>
          <h4 className="text-base font-bold text-text-primary mb-2">Every Trade Is Protected</h4>
          <p className="text-[11px] text-text-secondary leading-relaxed mb-4">
            Sellers lock crypto in escrow before you send any payment. Disputes are resolved by our compliance team.
          </p>
          <div className="space-y-2">
            {[
              { icon: <Lock className="w-3.5 h-3.5" />, text: "Funds locked before you pay" },
              { icon: <Clock className="w-3.5 h-3.5" />, text: "Auto-cancel on inactive trades" },
              { icon: <BadgeCheck className="w-3.5 h-3.5" />, text: "All merchants KYB verified" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <div className="text-text-secondary">{item.icon}</div>
                <span className="text-[11px] text-text-secondary">{item.text}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ─── BOTTOM CTA ────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3 }}
          className="p-6 rounded-2xl bg-accent text-center relative overflow-hidden"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent)]" />
          <h4 className="text-lg font-extrabold text-accent-text mb-2 relative z-10">Ready to Trade?</h4>
          <p className="text-[11px] text-accent-text/50 mb-4 relative z-10">Create a free account in seconds</p>
          <button
            onClick={onGetStarted}
            className="w-full py-3 bg-surface-base text-text-primary rounded-xl font-bold text-sm hover:opacity-90 transition-all relative z-10"
          >
            Create Free Account
          </button>
        </motion.div>

        {/* Merchant link */}
        <div className="mt-6 text-center">
          <p className="text-[10px] text-text-tertiary">
            Are you a merchant?{" "}
            <a href="/merchant" className="text-text-secondary hover:text-text-primary transition-colors underline underline-offset-2">
              Merchant Portal
            </a>
          </p>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center space-y-1.5 pb-4">
          <p className="text-[10px] text-text-quaternary font-mono">Blip Money v1.0</p>
          <div className="flex items-center justify-center gap-3 text-[10px] text-text-tertiary">
            <a href="#" className="hover:text-text-secondary transition-colors">Privacy</a>
            <span className="text-text-quaternary">·</span>
            <a href="#" className="hover:text-text-secondary transition-colors">Terms</a>
            <span className="text-text-quaternary">·</span>
            <a href="#" className="hover:text-text-secondary transition-colors">Risk</a>
          </div>
        </div>
      </div>
    </div>
  );
}
