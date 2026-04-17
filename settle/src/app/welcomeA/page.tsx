"use client";

import { motion, type Variants } from "framer-motion";
import Link from "next/link";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.12, duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  }),
};

const stats = [
  { value: "+ 1,200+", label: "ACTIVE MERCHANTS" },
  { value: "+ 2.4M+", label: "TRADES COMPLETED" },
  { value: "3.5 min", label: "AVG. SETTLEMENT" },
  { value: "99.9%", label: "PLATFORM UPTIME" },
];

/* ─── Dashboard Mockup ─── */
function DashboardMockup() {
  return (
    <div className="relative" style={{ paddingRight: 220, paddingTop: 10 }}>
      {/* Main card */}
      <div className="rounded-2xl overflow-hidden bg-[#0c0c0c] border border-white/[0.06]" style={{ width: 560, boxShadow: "0 30px 80px rgba(0,0,0,0.55)" }}>
        {/* Title bar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.06]">
          <div className="flex gap-1.5">
            <div className="w-[9px] h-[9px] rounded-full bg-[rgba(255,86,92,0.7)]" />
            <div className="w-[9px] h-[9px] rounded-full bg-[rgba(254,190,46,0.7)]" />
            <div className="w-[9px] h-[9px] rounded-full bg-[rgba(39,202,78,0.7)]" />
          </div>
          <div className="flex items-center gap-1.5 ml-3">
            <svg className="w-3.5 h-3.5 fill-white" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            <span className="text-[11px] font-semibold text-white/90">Blip money</span>
          </div>
          <div className="flex items-center gap-1.5 ml-3">
            <div className="w-3 h-3 rounded bg-white/[0.06]" />
            <span className="text-[9px] text-white/[0.15]">Trades</span>
          </div>
          <div className="ml-auto flex items-center gap-4 text-[10px]">
            <span className="text-white/50">Dashboard</span>
            <span className="text-white/[0.15]">Wallet</span>
            <span className="text-white/[0.15]">Settings</span>
          </div>
        </div>

        {/* Body */}
        <div className="flex" style={{ height: 390 }}>
          {/* Left sidebar */}
          <div className="w-[150px] shrink-0 p-3.5 flex flex-col border-r border-white/[0.06]">
            <p className="text-[7px] uppercase tracking-widest text-white/30">P2P Marketplace Balance</p>
            <p className="text-[30px] font-bold leading-none mt-1.5 text-white">5,150</p>
            <p className="text-[10px] mt-0.5 text-white/30">USDT</p>

            <div className="flex gap-1 mt-3">
              <span className="text-[7px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/50">Ledger</span>
              <span className="text-[7px] px-1.5 py-0.5 rounded border border-white/[0.06] text-white/30">Reserves</span>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <p className="text-[20px] font-semibold leading-none text-white/90">92.15</p>
                <p className="text-[8px] mt-0.5 text-white/[0.15]">INR / USDT</p>
              </div>
              <div>
                <p className="text-[20px] font-semibold leading-none text-white/90">196</p>
                <p className="text-[8px] mt-0.5 text-white/[0.15]">USST</p>
              </div>
            </div>

            <div className="mt-auto flex gap-1 pt-2.5 border-t border-white/[0.06]">
              {["Past", "Desk", "Order", "Order"].map((l, i) => (
                <div key={i} className="flex-1 text-center text-white/[0.15]">
                  <div className="w-4 h-4 mx-auto rounded bg-white/[0.03]" />
                  <span className="text-[6px] leading-none mt-0.5 block">{l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Center columns */}
          <div className="flex-1 p-3 flex flex-col min-w-0">
            <div className="flex gap-2.5 flex-1 min-h-0 overflow-hidden">
              {/* PENDING */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[9px] uppercase tracking-wider font-bold text-white/30">Pending</p>
                  <svg className="w-3 h-3 text-white/[0.15]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                </div>
                <div className="space-y-1.5 flex-1 overflow-hidden">
                  {[
                    { name: "grafix_tradeR1", amt: "200 USDT", rate: "20,610 MIE", tag: "R$ 1E" },
                    { name: "shuka_trade", amt: "100 USDT", rate: "22,130 MIE", tag: "R$ SE" },
                    { name: "alpha_trade", amt: "200 USDT", rate: "20,460 MIE", tag: "" },
                    { name: "shuha_trade", amt: "150 USDT", rate: "20,650 MIE", tag: "" },
                    { name: "shuha_trade", amt: "150 USDT", rate: "20,550 MIE", tag: "" },
                  ].map((o, i) => (
                    <div key={i} className="rounded-md px-2 py-1.5 bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] font-medium text-white/50">{o.name}</span>
                        <span className="text-[7px] text-white/[0.15]">{o.tag}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[7px] text-white/30">Buy · {o.amt} · Out. {o.rate}</span>
                        <span className="text-[6px] uppercase font-bold tracking-wide rounded px-1.5 py-[2px] bg-white/[0.06] text-white/50">Accept</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* IN PROGRESS */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <p className="text-[9px] uppercase tracking-wider font-bold text-white/30">In Progress</p>
                  <div className="flex gap-0.5 ml-auto">
                    <span className="text-[6px] px-1 py-[2px] rounded bg-white/[0.06] text-white/30">All</span>
                    <span className="text-[6px] px-1 py-[2px] rounded bg-white/[0.08] text-white/60">Accepted</span>
                    <span className="text-[6px] px-1 py-[2px] rounded bg-white/[0.06] text-white/30">P. Paid</span>
                  </div>
                </div>
                <div className="space-y-1.5 flex-1 overflow-hidden">
                  {[
                    { name: "gnav_resmonra1", status: "Reserved", sColor: "#c9a456", amt: "300 USDT", rate: "23,520 MIE", badge: "Escrowed Packer", bColor: "#2d7a4f" },
                    { name: "paolo_networkd", status: "Reserved", sColor: "#c9a456", amt: "196 USDT", rate: "19,527 MIE", badge: "Escrowed Escrow", bColor: "#2d7a4f" },
                    { name: "deep_finance", status: "Accepted", sColor: "#4ade80", amt: "390 USDT", rate: "18,720 MIE", badge: "Amco Syn1ck", bColor: "#3b82a0" },
                  ].map((o, i) => (
                    <div key={i} className="rounded-md px-2 py-1.5 bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex items-center justify-between">
                        <span className="text-[8px] font-medium text-white/50">{o.name}</span>
                        <span className="text-[7px] font-semibold" style={{ color: o.sColor }}>{o.status}</span>
                      </div>
                      <div className="text-[7px] text-white/30 mt-0.5">{o.amt} · {o.rate}</div>
                      <div className="mt-1">
                        <span className="text-[6px] font-medium rounded px-1.5 py-[2px]" style={{ background: `${o.bColor}30`, color: o.bColor }}>{o.badge}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom bar */}
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/[0.06]">
              <span className="text-[9px] rounded-md px-3.5 py-1 font-semibold bg-white/[0.06] text-white/50">BUY</span>
              <span className="text-[9px] rounded-md px-3.5 py-1 bg-white/[0.03] text-white/30">SELL</span>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="w-[6px] h-[6px] rounded-full animate-pulse bg-white/40" />
                <span className="text-[8px] text-white/30">3 orders in progress</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating: Spread Control */}
      <div className="absolute rounded-xl p-3 bg-[#131313] border border-white/[0.06]" style={{ top: -2, right: 16, width: 195, boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}>
        <div className="flex items-center gap-1.5 mb-2">
          <svg className="w-3.5 h-3.5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">Spread Control</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-white/90">+2.5% Spread</span>
          <span className="text-[11px] text-white/30">+2.5%</span>
        </div>
      </div>

      {/* Floating: Leaderboard + Activity */}
      <div className="absolute rounded-xl p-3 bg-[#131313] border border-white/[0.06]" style={{ top: 60, right: 0, width: 215, boxShadow: "0 20px 60px rgba(0,0,0,0.7)" }}>
        <p className="text-[9px] uppercase tracking-wider font-bold text-white/30 mb-2.5">Leaderboard</p>
        <div className="space-y-2.5">
          {[
            { rank: 1, name: "nasha_trade", sub: "performance rank (gpt)", vol: "4,851", sv: "5,101" },
            { rank: 2, name: "pyexz_network", sub: "cryptoalpha chart (gpt)", vol: "29,959", sv: "3,101" },
            { rank: 3, name: "deep_finance", sub: "leverage play", vol: "-389", sv: "3,101" },
          ].map((t) => (
            <div key={t.rank} className="flex items-start gap-1.5">
              <span className="text-[9px] font-bold mt-0.5 w-5 shrink-0 text-white/50">+ {t.rank}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-semibold truncate text-white/50">{t.name}</p>
                <p className="text-[6px] truncate text-white/[0.15]">{t.sub}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[9px] font-semibold text-white/50">{t.vol}</p>
                <p className="text-[6px] text-white/[0.15]">{t.sv}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Activity 1 */}
        <div className="mt-2.5 pt-2.5 border-t border-white/[0.06]">
          <p className="text-[9px] uppercase tracking-wider font-bold text-white/30 mb-2">Activity</p>
          <div className="space-y-1.5">
            {[
              { text: "Orders FIRE US Balances", time: "1:20" },
              { text: "Orders FIRE, trading free offerstack", time: "5:35" },
              { text: "DUSR/FARE, sorted combined", time: "6:30" },
            ].map((a, i) => (
              <div key={i} className="flex items-start gap-1">
                <span className="text-[7px] mt-0.5 text-white/[0.15]">*</span>
                <p className="text-[7px] flex-1 leading-snug text-white/[0.15]">{a.text}</p>
                <span className="text-[6px] shrink-0 text-white/[0.15]">{a.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Activity 2 */}
        <div className="mt-2.5 pt-2.5 border-t border-white/[0.06]">
          <p className="text-[9px] uppercase tracking-wider font-bold text-white/30 mb-2">Activity</p>
          <div className="space-y-1.5">
            {[
              { text: "SUS/FARE, Ch04 connected", badge: "HO STATUS", bColor: "#4ade80" },
              { text: "DUSR/FARE, Ch035 formatted", badge: "Barriers Covered", bColor: "#c9a456" },
              { text: "DUSR, Rsona, trading formatted", badge: null as string | null, sub: "7 card loss detected" },
            ].map((a, i) => (
              <div key={i} className="flex items-start gap-1">
                <span className="text-[7px] mt-0.5 text-white/[0.15]">*</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[7px] leading-snug text-white/[0.15]">{a.text}</p>
                  {a.badge && (
                    <span className="text-[5px] font-medium rounded px-1 py-[1px] mt-0.5 inline-block" style={{ background: `${a.bColor}25`, color: a.bColor }}>{a.badge}</span>
                  )}
                  {a.sub && <p className="text-[6px] mt-0.5 text-white/[0.15]">{a.sub}</p>}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[6px] mt-2 text-right text-white/[0.15]">Sentilo v1.1</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─── */
export default function WelcomeA() {
  return (
    <div className="welcome-scope min-h-screen flex flex-col relative overflow-x-clip bg-[#060606] text-white">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full blur-[160px] bg-white/[0.04]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] h-[350px] rounded-full blur-[200px] bg-white/[0.015]" />
      </div>

      {/* Header */}
      <motion.header custom={0} variants={fadeUp} initial="hidden" animate="show" className="relative z-20 flex items-center justify-between px-8 lg:px-16 py-5">
        <div className="flex items-center gap-2.5">
          <svg className="w-7 h-7 fill-white" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          <span className="text-xl leading-none">
            <span className="font-bold text-white">Blip</span>{" "}
            <span className="italic text-white/80">money</span>
          </span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/merchant/login?tab=signin" className="text-[14px] font-medium text-white/50">Sign In</Link>
          <Link href="/merchant/login?tab=register" className="text-[14px] font-semibold px-6 py-2.5 rounded-full bg-white text-[#060606]">Get Started</Link>
        </div>
      </motion.header>

      {/* Hero */}
      <div className="relative z-10 flex-1 flex items-center px-8 lg:px-16 py-12 lg:py-0 overflow-visible">
        <div className="w-full max-w-[1400px] mx-auto flex flex-col lg:flex-row items-center gap-12 lg:gap-16 overflow-visible">
          {/* Left copy */}
          <div className="flex-shrink-0 w-full lg:w-[460px]">
            <motion.div custom={1} variants={fadeUp} initial="hidden" animate="show">
              <span className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full text-[11px] font-bold uppercase tracking-[0.12em] text-white/50 border border-white/[0.06] bg-white/[0.03]">
                <svg className="w-4 h-4 text-white/[0.15]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                For Liquidity Providers
              </span>
            </motion.div>

            <motion.h1 custom={2} variants={fadeUp} initial="hidden" animate="show" className="text-[56px] lg:text-[76px] font-bold leading-[1.02] tracking-tight mt-8 text-white">
              Own the Flow<br />of Money
            </motion.h1>

            <motion.p custom={3} variants={fadeUp} initial="hidden" animate="show" className="text-[17px] leading-[1.6] mt-6 max-w-[420px] text-white/50">
              Launch your P2P desk, control spreads, and earn on every transaction. Powered by on-chain escrow and real-time settlement.
            </motion.p>

            <motion.div custom={4} variants={fadeUp} initial="hidden" animate="show" className="flex items-center gap-4 mt-10">
              <Link href="/merchant/login?tab=register">
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="px-7 py-3.5 rounded-xl text-[15px] font-bold bg-white text-[#060606]">
                  Start Your Desk
                </motion.button>
              </Link>
              <Link href="/merchant/login?tab=signin">
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="px-7 py-3.5 rounded-xl text-[15px] font-bold border border-white/[0.12] bg-white/[0.03] text-white">
                  Login to Dashboard
                </motion.button>
              </Link>
            </motion.div>
          </div>

          {/* Right: mockup — scaled via CSS var */}
          <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show" className="flex-1 relative hidden lg:block" style={{ minHeight: 480 }}>
            <div style={{ position: "absolute", top: "50%", right: 0, transformOrigin: "right center", transform: "translateY(-50%) scale(var(--mockup-scale, 0.78))" }}>
              <DashboardMockup />
            </div>
          </motion.div>
        </div>
      </div>

      {/* Stats */}
      <motion.div custom={5} variants={fadeUp} initial="hidden" animate="show" className="relative z-10 border-t border-white/[0.06]">
        <div className="max-w-[1400px] mx-auto px-8 lg:px-16 py-16">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-[38px] lg:text-[46px] font-bold leading-none tracking-tight text-white">{s.value}</p>
                <p className="text-[11px] uppercase tracking-[0.15em] font-semibold mt-3 text-white/30">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
