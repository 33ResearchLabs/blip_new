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
    <div className="merchant-welcome min-h-screen bg-[var(--mw-bg-primary)] text-[var(--mw-text-primary)] overflow-x-hidden">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[700px] h-[500px] bg-[var(--mw-glow-hero)] rounded-full blur-[180px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-[var(--mw-glow)] rounded-full blur-[150px]" />
      </div>

      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-[var(--mw-bg-primary)]/80 backdrop-blur-xl border-b border-[var(--mw-divider)]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Zap className="w-6 h-6 text-[var(--mw-text-primary)] fill-[var(--mw-text-primary)]" />
            <span className="text-lg leading-none">
              <span className="font-bold text-[var(--mw-text-primary)]">Blip</span>{" "}
              <span className="italic text-[var(--mw-text-secondary)]">money</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onSignIn}
              className="text-sm text-[var(--mw-text-tertiary)] hover:text-[var(--mw-text-primary)] transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={onGetStarted}
              className="mw-btn-primary px-4 py-2 text-sm font-semibold rounded-xl transition-colors"
            >
              Get Started
            </button>
          </div>
        </div>
      </nav>

      <main className="relative pt-14">
        {/* ─── HERO ──────────────────────────────────────────── */}
        <section className="mw-hero-bg px-6 pt-16 pb-16 max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-10 lg:gap-8 items-center">
            {/* Left — text content */}
            <motion.div
              variants={stagger}
              initial="hidden"
              animate="visible"
              className="flex flex-col items-start text-left"
            >
              <motion.div variants={fadeUp}>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--mw-accent-dim)] border border-[var(--mw-border)] text-[var(--mw-accent)] text-[11px] font-bold uppercase tracking-widest mb-6">
                  <Store className="w-3 h-3" /> For Liquidity Providers
                </div>
              </motion.div>

              <motion.h1
                variants={fadeUp}
                className="text-4xl sm:text-5xl md:text-[3.5rem] font-extrabold text-[var(--mw-text-primary)] leading-[1.1] tracking-tight mb-5"
              >
                Own the Flow
                <br />
                of Money
              </motion.h1>

              <motion.p
                variants={fadeUp}
                className="text-base sm:text-lg text-[var(--mw-text-tertiary)] max-w-md leading-relaxed mb-8"
              >
                Launch your P2P desk, control spreads,
                and earn on every transaction.
                Powered by on-chain escrow and real-time settlement.
              </motion.p>

              <motion.div
                variants={fadeUp}
                className="flex flex-col sm:flex-row items-start gap-3 w-full sm:w-auto mb-8"
              >
                <button
                  onClick={onGetStarted}
                  className="mw-btn-primary w-full sm:w-auto px-8 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all"
                >
                  Start Your Desk <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={onSignIn}
                  className="mw-btn-secondary w-full sm:w-auto px-8 py-3.5 rounded-2xl font-bold text-sm transition-all"
                >
                  Login to Dashboard
                </button>
              </motion.div>

              <motion.p variants={fadeUp} className="text-[11px] text-[var(--mw-text-muted)] tracking-wide">
                No custody &middot; No counterparty risk &middot; Fully on-chain
              </motion.p>
            </motion.div>

            {/* Right — 3D dashboard mockup */}
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3, duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
              className="relative hidden lg:block"
            >
              {/* Background glow — cool blue-white, no orange */}
              <div className="absolute -inset-16 bg-[var(--mw-glow-hero)] rounded-full blur-[120px]" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[400px] bg-[var(--mw-glow)] rounded-full blur-[100px]" />
              <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-gradient-to-t from-[var(--mw-glow)] via-transparent to-transparent rounded-full blur-[80px]" />
              <div className="absolute top-1/4 -right-10 w-[200px] h-[300px] bg-[var(--mw-glow)] rounded-full blur-[60px]" />

              {/* 3D perspective container */}
              <div className="relative" style={{ perspective: '1200px' }}>
                <div
                  className="relative rounded-2xl overflow-hidden border border-[var(--mw-border-strong)] bg-[var(--mw-bg-secondary)]"
                  style={{
                    transform: 'rotateY(-8deg) rotateX(4deg)',
                    transformOrigin: 'center center',
                  }}
                >
                  {/* Glossy reflection overlay */}
                  <div
                    className="absolute inset-0 z-30 pointer-events-none"
                    style={{
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 25%, transparent 50%, transparent 75%, rgba(255,255,255,0.015) 100%)',
                    }}
                  />
                  <div
                    className="absolute top-0 left-0 right-0 h-[1px] z-30 pointer-events-none"
                    style={{
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15) 30%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0.15) 70%, transparent)',
                    }}
                  />
                  <div
                    className="absolute top-0 left-0 bottom-0 w-[1px] z-30 pointer-events-none"
                    style={{
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05) 50%, transparent)',
                    }}
                  />

                  {/* ── Navbar ── */}
                  <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--mw-bg-primary)] border-b border-[var(--mw-divider)]">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-[var(--mw-text-primary)] fill-[var(--mw-text-primary)]" />
                      <span className="text-[10px] font-bold text-[var(--mw-text-secondary)]">Blip <span className="italic font-normal text-[var(--mw-text-muted)]">money</span></span>
                    </div>
                    <div className="flex items-center gap-1">
                      {['Dashboard', 'Wallet', 'Settings'].map((t, i) => (
                        <span key={t} className={`text-[8px] px-2 py-1 rounded-md font-mono ${i === 0 ? 'bg-[var(--mw-surface)] text-[var(--mw-text-secondary)]' : 'text-[var(--mw-text-muted)]'}`}>{t}</span>
                      ))}
                    </div>
                    <div className="w-5 h-5 rounded-full bg-[var(--mw-surface)] border border-[var(--mw-border)]" />
                  </div>

                  {/* ── Body: 3-panel layout ── */}
                  <div className="flex" style={{ height: 420 }}>
                    {/* Panel 1: StatusCard + ConfigPanel */}
                    <div className="w-[145px] border-r border-[var(--mw-divider)] flex flex-col overflow-hidden">
                      {/* Live ticker strip */}
                      <div className="flex items-center justify-between px-2 py-1 bg-[var(--mw-surface)] border-b border-[var(--mw-divider)]">
                        <div className="flex items-center gap-1">
                          <div className="w-1 h-1 rounded-full bg-[var(--mw-success)] animate-pulse" />
                          <span className="text-[6px] font-bold text-[var(--mw-success)] font-mono tracking-widest">LIVE</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ShieldCheck className="w-2 h-2 text-[var(--mw-text-muted)]" />
                          <span className="text-[6px] text-[var(--mw-text-muted)] font-mono">TRUSTED</span>
                        </div>
                        <div className="w-5 h-2.5 rounded-full bg-[var(--mw-success-dim)] border border-[var(--mw-success)]/30 relative">
                          <div className="absolute right-0.5 top-0.5 w-1.5 h-1.5 rounded-full bg-[var(--mw-success)]" />
                        </div>
                      </div>

                      {/* Balance hero */}
                      <div className="px-2.5 py-2 border-b border-[var(--mw-divider)]">
                        <div className="flex items-center gap-1 mb-1">
                          <Wallet className="w-2 h-2 text-[var(--mw-text-muted)]" />
                          <span className="text-[6px] text-[var(--mw-text-muted)] uppercase tracking-wider font-mono">Available Balance</span>
                        </div>
                        <p className="text-lg font-black text-[var(--mw-text-primary)] font-mono leading-none">5,150</p>
                        <p className="text-[8px] text-[var(--mw-text-muted)] font-mono mt-0.5">USDT</p>
                        <div className="flex items-center gap-1 mt-1">
                          <TrendingUp className="w-2 h-2 text-[var(--mw-success)]" />
                          <span className="text-[7px] text-[var(--mw-success)] font-mono font-bold">+295.50</span>
                          <span className="text-[6px] text-[var(--mw-text-muted)] font-mono">24h</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Lock className="w-2 h-2 text-[var(--mw-text-muted)]" />
                          <span className="text-[7px] text-[var(--mw-text-muted)] font-mono">1,432 in escrow</span>
                        </div>
                      </div>

                      {/* Corridor selector */}
                      <div className="px-2 py-1.5 border-b border-[var(--mw-divider)]">
                        <div className="flex gap-1 mb-1">
                          <div className="flex-1 text-center text-[6px] py-0.5 rounded bg-[var(--mw-surface)] text-[var(--mw-text-muted)] font-mono">USDT/AED</div>
                          <div className="flex-1 text-center text-[6px] py-0.5 rounded bg-[var(--mw-accent-dim)] border border-[var(--mw-border)] text-[var(--mw-accent)] font-mono font-bold">USDT/INR</div>
                        </div>
                        <p className="text-sm font-bold text-[var(--mw-text-primary)] font-mono text-center">92.15</p>
                        <p className="text-[7px] text-[var(--mw-text-muted)] font-mono text-center">INR / USDT</p>
                      </div>

                      {/* Config: Amount input */}
                      <div className="px-2 py-1.5 border-b border-[var(--mw-divider)]">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[6px] text-[var(--mw-text-muted)] uppercase tracking-wider font-mono">Amount</span>
                          <span className="text-[6px] px-1 py-0.5 rounded bg-[var(--mw-accent-dim)] text-[var(--mw-accent)]/60 font-mono">MAX</span>
                        </div>
                        <div className="flex items-baseline gap-0.5">
                          <span className="text-sm font-bold text-[var(--mw-text-primary)] font-mono">196</span>
                          <span className="text-[8px] text-[var(--mw-text-muted)] font-mono">USDT</span>
                        </div>
                        <p className="text-[7px] text-[var(--mw-text-muted)] font-mono">= 18,061 INR</p>
                      </div>

                      {/* Spread tiers */}
                      <div className="px-2 py-1.5 border-b border-[var(--mw-divider)]">
                        <div className="grid grid-cols-3 gap-1">
                          <div className="text-center py-1 rounded bg-[var(--mw-accent-dim)] border border-[var(--mw-border)]">
                            <Zap className="w-2 h-2 text-[var(--mw-accent)] mx-auto mb-0.5" />
                            <p className="text-[6px] text-[var(--mw-accent)] font-mono font-bold">FAST</p>
                            <p className="text-[5px] text-[var(--mw-text-muted)] font-mono">+2.5%</p>
                          </div>
                          <div className="text-center py-1 rounded bg-[var(--mw-surface)]">
                            <BarChart3 className="w-2 h-2 text-[var(--mw-text-muted)] mx-auto mb-0.5" />
                            <p className="text-[6px] text-[var(--mw-text-muted)] font-mono">BEST</p>
                            <p className="text-[5px] text-[var(--mw-text-muted)] font-mono">+2.0%</p>
                          </div>
                          <div className="text-center py-1 rounded bg-[var(--mw-surface)]">
                            <TrendingUp className="w-2 h-2 text-[var(--mw-text-muted)] mx-auto mb-0.5" />
                            <p className="text-[6px] text-[var(--mw-text-muted)] font-mono">CHEAP</p>
                            <p className="text-[5px] text-[var(--mw-text-muted)] font-mono">+1.5%</p>
                          </div>
                        </div>
                      </div>

                      {/* Buy / Sell buttons */}
                      <div className="px-2 py-2 mt-auto">
                        <div className="grid grid-cols-2 gap-1 mb-1">
                          <div className="mw-btn-primary text-center py-1.5 rounded-lg text-[7px] font-bold font-mono">BUY</div>
                          <div className="text-center py-1.5 rounded-lg bg-[var(--mw-surface)] border border-[var(--mw-border)] text-[7px] text-[var(--mw-text-muted)] font-bold font-mono">SELL</div>
                        </div>
                        <p className="text-[5px] text-[var(--mw-text-muted)] font-mono text-center">+2.5% spread &middot; B 94.45 &middot; S 89.85</p>
                      </div>
                    </div>

                    {/* Panel 2: Pending Orders */}
                    <div className="w-[190px] border-r border-[var(--mw-divider)] flex flex-col">
                      <div className="px-2 py-1.5 border-b border-[var(--mw-divider)] flex items-center justify-between">
                        <span className="text-[8px] font-bold text-[var(--mw-text-tertiary)] uppercase tracking-wider font-mono">Pending</span>
                        <span className="text-[7px] px-1 py-0.5 rounded bg-[var(--mw-accent-dim)] text-[var(--mw-accent)] font-mono font-bold">4</span>
                      </div>
                      <div className="flex-1 overflow-hidden p-1.5 space-y-1">
                        {[
                          { user: 'crypto_trader01', pay: '196 USDT', get: '18,032 INR', time: '14:23', pref: 'FAST' },
                          { user: 'shubh_trade', pay: '112 USDT', get: '10,640 INR', time: '11:45', pref: 'BEST' },
                          { user: 'deep_finance', pay: '500 USDT', get: '46,100 INR', time: '08:12', pref: 'FAST' },
                          { user: 'alpha_pay', pay: '250 USDT', get: '23,050 INR', time: '05:30', pref: 'BEST' },
                        ].map((o, i) => (
                          <div key={i} className="rounded-lg bg-[var(--mw-surface)] border border-[var(--mw-divider)] p-2 relative">
                            <div className="absolute top-1.5 left-1.5 w-1 h-1 rounded-full bg-[var(--mw-info)] animate-ping opacity-40" />
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[8px] text-[var(--mw-text-secondary)] font-mono pl-2">{o.user}</span>
                              <span className="text-[7px] font-bold text-[var(--mw-text-secondary)] font-mono">{o.time}</span>
                            </div>
                            <div className="flex items-center gap-1 mb-1">
                              <span className="text-[8px] text-red-400/70 font-mono">Pay</span>
                              <span className="text-[8px] text-[var(--mw-text-secondary)] font-mono font-medium">{o.pay}</span>
                              <span className="text-[7px] text-[var(--mw-text-muted)]">&rarr;</span>
                              <span className="text-[8px] text-[var(--mw-success)]/70 font-mono">Get</span>
                              <span className="text-[8px] text-[var(--mw-success)]/80 font-mono font-medium">{o.get}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className={`text-[6px] px-1 py-0.5 rounded border font-mono font-bold ${
                                o.pref === 'FAST' ? 'text-[var(--mw-accent)] bg-[var(--mw-accent-dim)] border-[var(--mw-border)]' : 'text-[var(--mw-info)] bg-[var(--mw-info-dim)] border-[var(--mw-info)]/20'
                              }`}>{o.pref}</span>
                              <div className="mw-btn-primary px-2 py-0.5 rounded text-[7px] font-bold font-mono">ACCEPT</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Panel 3: In Progress */}
                    <div className="flex-1 flex flex-col">
                      <div className="px-2 py-1.5 border-b border-[var(--mw-divider)] flex items-center justify-between">
                        <span className="text-[8px] font-bold text-[var(--mw-text-tertiary)] uppercase tracking-wider font-mono">In Progress</span>
                        <span className="text-[7px] px-1 py-0.5 rounded bg-[var(--mw-success-dim)] text-[var(--mw-success)] font-mono font-bold">4</span>
                      </div>
                      <div className="flex gap-1 px-2 py-1 border-b border-[var(--mw-divider)]">
                        {['All', 'Escrowed', 'Paid'].map((f, i) => (
                          <span key={f} className={`text-[7px] px-1.5 py-0.5 rounded font-mono ${i === 0 ? 'bg-[var(--mw-accent-dim)] text-[var(--mw-accent)] border border-[var(--mw-border)]' : 'text-[var(--mw-text-muted)] bg-[var(--mw-surface)]'}`}>{f}</span>
                        ))}
                      </div>
                      <div className="flex-1 overflow-hidden p-1.5 space-y-1">
                        {[
                          { user: 'gorav_research1', usdc: '350 USDT', fiat: '32,200 INR', status: 'Escrowed', sColor: `text-[var(--mw-purple)] bg-[var(--mw-purple-dim)]`, action: 'CONFIRM PAYMENT' },
                          { user: 'proto_network0', usdc: '196 USDT', fiat: '18,032 INR', status: 'Payment Sent', sColor: 'text-[var(--mw-warning)] bg-[var(--mw-warning-dim)]', action: 'RELEASE ESCROW' },
                          { user: 'alpha_trade', usdc: '88 USDT', fiat: '8,100 INR', status: 'Accepted', sColor: 'text-[var(--mw-info)] bg-[var(--mw-info-dim)]', action: 'LOCK ESCROW' },
                        ].map((o, i) => (
                          <div key={i} className="rounded-lg bg-[var(--mw-surface)] border border-[var(--mw-divider)] p-2 relative">
                            <div className="absolute top-1.5 left-1.5 w-1 h-1 rounded-full bg-[var(--mw-accent)]" />
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[8px] text-[var(--mw-text-secondary)] font-mono pl-2">{o.user}</span>
                              <span className={`text-[7px] px-1 py-0.5 rounded font-mono font-medium ${o.sColor}`}>{o.status}</span>
                            </div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[9px] text-[var(--mw-text-secondary)] font-mono font-medium">{o.usdc}</span>
                              <span className="text-[8px] text-[var(--mw-text-muted)] font-mono">{o.fiat}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="mw-btn-primary px-2 py-0.5 rounded text-[6px] font-bold font-mono tracking-wide">{o.action}</div>
                              <div className="w-4 h-4 rounded bg-[var(--mw-surface)] border border-[var(--mw-border)] flex items-center justify-center">
                                <MessageSquare className="w-2 h-2 text-[var(--mw-text-muted)]" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Panel 4: Activity / Leaderboard */}
                    <div className="w-[130px] border-l border-[var(--mw-divider)] flex flex-col">
                      <div className="px-2 py-1.5 border-b border-[var(--mw-divider)]">
                        <span className="text-[8px] font-bold text-[var(--mw-text-tertiary)] uppercase tracking-wider font-mono">Leaderboard</span>
                      </div>
                      <div className="flex-1 p-1.5 space-y-1 overflow-hidden">
                        {[
                          { rank: 1, name: 'shubh_trade', vol: '$48.2K', medal: 'text-yellow-400' },
                          { rank: 2, name: 'crypto_desk', vol: '$35.1K', medal: 'text-gray-300' },
                          { rank: 3, name: 'gorav_pay', vol: '$28.7K', medal: 'text-amber-600' },
                          { rank: 4, name: 'deep_finance', vol: '$22.0K', medal: 'text-[var(--mw-text-muted)]' },
                          { rank: 5, name: 'proto_net', vol: '$18.5K', medal: 'text-[var(--mw-text-muted)]' },
                        ].map((t) => (
                          <div key={t.rank} className="flex items-center gap-1.5 py-1 px-1.5 rounded bg-[var(--mw-surface)]">
                            <span className={`text-[8px] font-bold font-mono ${t.medal}`}>#{t.rank}</span>
                            <span className="text-[8px] text-[var(--mw-text-tertiary)] font-mono truncate flex-1">{t.name}</span>
                            <span className="text-[7px] text-[var(--mw-text-muted)] font-mono">{t.vol}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-[var(--mw-divider)]">
                        <div className="px-2 py-1.5">
                          <span className="text-[8px] font-bold text-[var(--mw-text-tertiary)] uppercase tracking-wider font-mono">Activity</span>
                        </div>
                        <div className="px-1.5 pb-1.5 space-y-1">
                          {[
                            { text: 'Order #BM-2604 completed', time: '2m', color: 'bg-[var(--mw-success)]' },
                            { text: 'New order from user', time: '5m', color: 'bg-[var(--mw-info)]' },
                            { text: 'Escrow locked', time: '8m', color: 'bg-[var(--mw-purple)]' },
                          ].map((a, i) => (
                            <div key={i} className="flex items-start gap-1">
                              <div className={`w-1 h-1 rounded-full mt-1 ${a.color}`} />
                              <div className="flex-1">
                                <p className="text-[7px] text-[var(--mw-text-muted)] leading-tight">{a.text}</p>
                                <p className="text-[6px] text-[var(--mw-text-muted)] font-mono">{a.time} ago</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Panel 5: Chat / Notifications */}
                    <div className="w-[110px] border-l border-[var(--mw-divider)] flex flex-col">
                      <div className="px-2 py-1.5 border-b border-[var(--mw-divider)] flex items-center justify-between">
                        <span className="text-[8px] font-bold text-[var(--mw-text-tertiary)] uppercase tracking-wider font-mono">Chat</span>
                        <span className="w-3 h-3 rounded-full bg-[var(--mw-accent-dim)] text-[7px] text-[var(--mw-accent)] font-bold flex items-center justify-center">2</span>
                      </div>
                      <div className="flex-1 p-1.5 space-y-1 overflow-hidden">
                        {[
                          { user: 'gorav_re...', msg: 'Payment sent check', unread: 2, online: true },
                          { user: 'proto_net...', msg: 'Hello, ready to trade', unread: 1, online: true },
                          { user: 'shubh_tr...', msg: 'Thanks confirmed', unread: 0, online: false },
                        ].map((c, i) => (
                          <div key={i} className="rounded-lg bg-[var(--mw-surface)] border border-[var(--mw-divider)] p-1.5">
                            <div className="flex items-center gap-1 mb-0.5">
                              <div className="relative">
                                <div className="w-4 h-4 rounded bg-[var(--mw-surface)] flex items-center justify-center text-[6px] text-[var(--mw-text-tertiary)]">{c.user.charAt(0).toUpperCase()}</div>
                                {c.online && <div className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--mw-success)] border border-[var(--mw-bg-secondary)]" />}
                              </div>
                              <span className="text-[7px] text-[var(--mw-text-secondary)] font-mono flex-1 truncate">{c.user}</span>
                              {c.unread > 0 && <span className="w-3 h-3 rounded-full bg-[var(--mw-accent-dim)] text-[6px] text-[var(--mw-accent)] font-bold flex items-center justify-center">{c.unread}</span>}
                            </div>
                            <p className="text-[6px] text-[var(--mw-text-muted)] truncate pl-5">{c.msg}</p>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-[var(--mw-divider)] p-1.5 space-y-1">
                        <div className="px-0.5 mb-0.5">
                          <span className="text-[7px] font-bold text-[var(--mw-text-muted)] uppercase tracking-wider font-mono">Alerts</span>
                        </div>
                        <div className="rounded bg-[var(--mw-info-dim)] border border-[var(--mw-info)]/10 p-1.5">
                          <p className="text-[6px] text-[var(--mw-info)]/60 leading-tight">New order received from crypto_trader01</p>
                        </div>
                        <div className="rounded bg-[var(--mw-success-dim)] border border-[var(--mw-success)]/10 p-1.5">
                          <p className="text-[6px] text-[var(--mw-success)]/60 leading-tight">Payment confirmed for #BM-2604</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom status bar */}
                  <div className="flex items-center justify-between px-3 py-1 bg-[var(--mw-bg-primary)] border-t border-[var(--mw-divider)]">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--mw-success)]" />
                      <span className="text-[7px] text-[var(--mw-text-muted)] font-mono">Connected</span>
                    </div>
                    <span className="text-[7px] text-[var(--mw-text-muted)] font-mono">Settle v1.0</span>
                  </div>
                </div>

                {/* Floating "Spread Control" card */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8, duration: 0.5 }}
                  className="absolute -top-4 -right-6 w-44 rounded-xl mw-glass p-3"
                  style={{ transform: 'rotateY(-4deg)' }}
                >
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="w-3 h-3 text-[var(--mw-accent)]" />
                    <span className="text-[9px] font-bold text-[var(--mw-accent)] uppercase tracking-wider">Spread Control</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[var(--mw-text-tertiary)]">+2.5% Spread</span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-[var(--mw-success)] font-mono">+2.5%</span>
                      <ChevronRight className="w-3 h-3 text-[var(--mw-text-muted)]" />
                    </div>
                  </div>
                </motion.div>

                {/* Floating notification pill */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.0, duration: 0.5 }}
                  className="absolute -bottom-3 -left-4 flex items-center gap-2 px-3 py-2 rounded-xl mw-glass"
                >
                  <div className="w-2 h-2 rounded-full bg-[var(--mw-success)] animate-pulse" />
                  <span className="text-[9px] text-[var(--mw-text-secondary)] font-mono">3 orders in progress</span>
                </motion.div>
              </div>
            </motion.div>
          </div>

          {/* Stats strip */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-16 pt-10 border-t border-[var(--mw-divider)]"
          >
            {stats.map((s, i) => (
              <div key={i} className="text-center">
                <div className="text-xl sm:text-2xl font-bold text-[var(--mw-text-primary)] mb-1 font-mono">
                  {s.value}
                </div>
                <div className="text-[11px] text-[var(--mw-text-muted)] uppercase tracking-wider">
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
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--mw-text-primary)] mb-3">
              How It Works
            </h2>
            <p className="text-sm text-[var(--mw-text-muted)]">
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
                className="relative group p-6 rounded-2xl bg-[var(--mw-surface)] border border-[var(--mw-border)] hover:border-[var(--mw-border-strong)] transition-all cursor-default"
              >
                <div className="absolute top-3 right-4 text-5xl font-black text-[var(--mw-surface)] select-none">
                  {i + 1}
                </div>
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-colors ${
                    hoveredStep === i
                      ? "bg-[var(--mw-accent-dim)] text-[var(--mw-accent)]"
                      : "bg-[var(--mw-surface)] text-[var(--mw-text-tertiary)]"
                  }`}
                >
                  {step.icon}
                </div>
                <h4 className="text-sm font-bold text-[var(--mw-text-primary)] mb-1.5">
                  {step.title}
                </h4>
                <p className="text-xs text-[var(--mw-text-muted)] leading-relaxed">
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
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--mw-text-primary)] mb-3">
              Built for Professionals
            </h2>
            <p className="text-sm text-[var(--mw-text-muted)]">
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
                className="group p-6 rounded-2xl bg-[var(--mw-surface)] border border-[var(--mw-border)] hover:border-[var(--mw-border-strong)] transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-[var(--mw-surface)] flex items-center justify-center mb-4 text-[var(--mw-text-tertiary)] group-hover:text-[var(--mw-accent)] group-hover:bg-[var(--mw-accent-dim)] transition-colors">
                  {f.icon}
                </div>
                <h4 className="text-sm font-bold text-[var(--mw-text-primary)] mb-1.5">
                  {f.title}
                </h4>
                <p className="text-xs text-[var(--mw-text-muted)] leading-relaxed">
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
              className="md:col-span-2 p-8 sm:p-10 rounded-3xl bg-[var(--mw-accent-dim)] border border-[var(--mw-border)]"
            >
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="w-5 h-5 text-[var(--mw-accent)]" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--mw-text-tertiary)]">
                  Earn More
                </span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-bold text-[var(--mw-text-primary)] mb-3 leading-tight">
                Set Your Own Spreads. <br className="hidden sm:block" />
                Keep 100% of Your Margin.
              </h3>
              <p className="text-sm text-[var(--mw-text-tertiary)] leading-relaxed max-w-md mb-8">
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
                    <div className="text-[var(--mw-text-tertiary)]">{item.icon}</div>
                    <span className="text-xs text-[var(--mw-text-secondary)]">{item.text}</span>
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
              className="p-8 rounded-3xl bg-[var(--mw-surface)] border border-[var(--mw-border)] flex flex-col items-center justify-center text-center"
            >
              <div className="w-16 h-16 rounded-2xl bg-[var(--mw-accent-dim)] flex items-center justify-center mb-5">
                <Wallet className="w-8 h-8 text-[var(--mw-accent)]" />
              </div>
              <h4 className="text-lg font-bold text-[var(--mw-text-primary)] mb-2">
                KYB Verified
              </h4>
              <p className="text-xs text-[var(--mw-text-muted)] mb-5 leading-relaxed">
                Complete verification to unlock full trading limits and earn user trust.
              </p>
              <div className="px-4 py-1.5 bg-[var(--mw-accent-dim)] text-[var(--mw-accent)] rounded-full text-[10px] font-bold uppercase tracking-widest">
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
            className="relative overflow-hidden p-10 sm:p-16 rounded-[32px] text-center bg-[var(--mw-bg-secondary)] border border-[var(--mw-border)]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.03),transparent)]" />
            <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--mw-text-primary)] mb-4 relative z-10">
              Ready to Start Earning?
            </h2>
            <p className="text-[var(--mw-text-tertiary)] text-sm sm:text-base mb-8 max-w-md mx-auto relative z-10">
              Join 1,200+ merchants already trading on Blip Money.
              Set up takes less than 5 minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 relative z-10">
              <button
                onClick={onGetStarted}
                className="w-full sm:w-auto px-10 py-4 bg-[var(--mw-text-primary)] text-[var(--mw-bg-primary)] rounded-2xl font-bold text-sm hover:opacity-90 transition-all"
              >
                Create Merchant Account
              </button>
              <button
                onClick={onSignIn}
                className="mw-btn-secondary w-full sm:w-auto px-10 py-4 rounded-2xl font-bold text-sm transition-all"
              >
                Sign In
              </button>
            </div>
          </motion.div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--mw-divider)] py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-[var(--mw-text-primary)] fill-[var(--mw-text-primary)]" />
            <span className="text-sm font-bold text-[var(--mw-text-primary)]">
              Blip <span className="italic font-normal text-[var(--mw-text-tertiary)]">money</span>
            </span>
          </div>
          <div className="flex gap-6 text-[11px] text-[var(--mw-text-muted)]">
            <a href="#" className="hover:text-[var(--mw-text-secondary)] transition-colors">Privacy</a>
            <a href="#" className="hover:text-[var(--mw-text-secondary)] transition-colors">Terms</a>
            <a href="#" className="hover:text-[var(--mw-text-secondary)] transition-colors">Risk Warning</a>
          </div>
          <p className="text-[11px] text-[var(--mw-text-muted)] font-mono">
            Blip Money v1.0
          </p>
        </div>
      </footer>
    </div>
  );
}
