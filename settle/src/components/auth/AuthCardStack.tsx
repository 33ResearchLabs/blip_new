"use client";

import { motion } from "framer-motion";

interface AuthCardStackProps {
  variant?: "merchant" | "user";
  className?: string;
}

const ease = [0.16, 1, 0.3, 1] as const;

export default function AuthCardStack({
  variant = "user",
  className = "",
}: AuthCardStackProps) {
  return (
    <div className={`relative w-[460px] h-[420px] ${className}`}>
      {/* ── Main phone-frame card (center, largest) ── */}
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.9, ease }}
        className="absolute left-[95px] top-[0px] z-20 w-[250px] h-[420px] rounded-[28px] overflow-hidden border border-foreground/[0.08] bg-surface-card shadow-[0_24px_80px_-16px_rgba(0,0,0,0.25)] dark:shadow-[0_24px_80px_-16px_rgba(0,0,0,0.6)]"
      >
        {/* Phone notch */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-20 h-1.5 bg-foreground/10 rounded-full" />
        </div>

        <div className="px-4 pt-1 pb-14">
          {/* Greeting + Notification */}
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[8px] text-foreground/40">
                Welcome back
              </div>
              <div className="text-[11px] font-semibold text-foreground">
                Gaurav 👋
              </div>
            </div>
            <div className="relative">
              <div className="w-6 h-6 rounded-full bg-foreground/[0.07]" />
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-foreground rounded-full text-[6px] text-background flex items-center justify-center">
                2
              </div>
            </div>
          </div>

          {/* Balance */}
          <div className="mb-3">
            <div className="text-[9px] text-foreground/40 mb-1">
              Total Balance
            </div>
            <div className="text-[24px] font-bold text-foreground leading-none">
              $12,847
              <span className="text-[12px] text-foreground/30">
                .00
              </span>
            </div>
            <div className="text-[8px] text-green-500 mt-1">
              ▲ +4.2% this week
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {["Send", "Receive", "Swap", "Earn"].map((action, i) => (
              <div
                key={i}
                className="flex flex-col items-center justify-center py-2 rounded-lg bg-foreground/[0.05]"
              >
                <div className="w-4 h-4 rounded-full bg-foreground/[0.15] mb-1" />
                <div className="text-[7px] text-foreground/60">
                  {action}
                </div>
              </div>
            ))}
          </div>

          {/* Mini chart — uses semantic foreground color so bars are visible
              on every theme (dark, light, navy, emerald, orchid, etc.) */}
          <div className="flex items-end gap-[3px] h-10 mb-3">
            {[25, 40, 35, 55, 45, 70, 50, 85, 60, 75, 65, 90].map((h, i) => (
              <div
                key={i}
                className={`flex-1 rounded-t-[2px] ${i >= 9 ? 'bg-foreground/60' : 'bg-foreground/[0.08]'}`}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>

          {/* Portfolio Split */}
          <div className="mb-3">
            <div className="text-[8px] text-foreground/40 mb-1">
              Portfolio
            </div>
            <div className="flex justify-between text-[9px] font-medium text-foreground">
              <span>USDT 45%</span>
              <span>BTC 30%</span>
              <span>USDC 25%</span>
            </div>
          </div>

          {/* Transactions */}
          <div className="space-y-2">
            {[
              { flag: "🇦🇪", pair: "USDT → AED", amount: "$2,500", status: "Settled" },
              { flag: "🇳🇬", pair: "BTC → NGN", amount: "₦2.8M", status: "Pending" },
              { flag: "🇮🇳", pair: "USDC → INR", amount: "₹42,000", status: "Settled" },
            ].map((tx, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5 border-b border-foreground/[0.05] last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs">{tx.flag}</span>
                  <div>
                    <div className="text-[9px] font-medium text-foreground">{tx.pair}</div>
                    <div className="text-[7px] text-foreground/30">{tx.status}</div>
                  </div>
                </div>
                <div className="text-[9px] font-semibold text-foreground">{tx.amount}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom nav */}
        <div className="absolute bottom-0 inset-x-0 flex justify-center pb-2 pt-1.5 border-t border-foreground/[0.05] bg-surface-card">
          <div className="flex gap-8 text-[7px] text-foreground/40">
            <div className="text-foreground">Home</div>
            <div>Markets</div>
            <div>Rewards</div>
            <div>Profile</div>
          </div>
        </div>
      </motion.div>

      {/* ── Small card: Transaction confirmed (top-left) ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.8, ease }}
        className="absolute -left-20 top-10 z-10 w-[190px] rounded-2xl overflow-hidden border border-white/15 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.3)]"
        style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)" }}
      >
        <div className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <span className="text-[10px] font-semibold text-white/90">Payment Confirmed</span>
          </div>
          <div className="text-xl font-bold text-white">$2,500.00</div>
          <div className="text-[9px] text-white/60 mt-1">USDT → AED</div>
          <div className="mt-3 space-y-1 text-[8px] text-white/70">
            <div className="flex justify-between"><span>Network</span><span className="font-medium text-white/90">TRC20</span></div>
            <div className="flex justify-between"><span>Wallet</span><span className="font-medium text-white/90">0x4f...9a21</span></div>
            <div className="flex justify-between"><span>Txn ID</span><span className="font-medium text-white/90">#BLP9821</span></div>
          </div>
          <div className="flex items-center gap-1.5 mt-3">
            <div className="w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
            <span className="text-[8px] text-white/50">Settled in 0.8s</span>
          </div>
          <div className="text-[7px] text-white/40 mt-2 text-right">2 mins ago</div>
        </div>
      </motion.div>

      {/* ── Small card: Rewards (left side) ── */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.8, ease }}
        className="absolute -left-[30px] top-[220px] z-30 w-[185px] rounded-xl overflow-hidden border border-white/15 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.3)]"
        style={{ background: "linear-gradient(135deg, #111 0%, #444 100%)" }}
      >
        <div className="p-3 relative">
          <div className="flex items-center justify-between mb-1">
            <div className="text-[8px] font-bold uppercase tracking-[0.15em] text-white/60">Blip Rewards</div>
            <div className="text-[7px] px-2 py-[2px] rounded-full bg-white/20 text-white/90">🏆 Gold</div>
          </div>
          <div className="text-2xl font-bold text-white leading-none">+200</div>
          <div className="text-[8px] text-white/80 mt-1">Welcome Bonus</div>
          <div className="flex items-center justify-between mt-2 text-[8px] text-white/70">
            <span>⚡ +120 XP</span><span>1.5x Boost</span>
          </div>
          <div className="flex items-center justify-between mt-1 text-[8px] text-white/70">
            <span>🔥 3 Day Streak</span><span>Rank #124</span>
          </div>
          <div className="flex justify-between mt-2 text-[7px] text-white/60">
            <span>Level Progress</span><span>35%</span>
          </div>
          <div className="mt-1 w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
            <div className="w-[35%] h-full bg-white/80 rounded-full transition-all duration-700" />
          </div>
          <div className="mt-3 h-[1px] bg-white/15" />
          <div className="flex items-center justify-between mt-2 text-[7px] text-white/60">
            <span>Total: 3,420 pts</span><span>2 mins ago</span>
          </div>
          <button className="mt-2 w-full text-[8px] py-1 rounded-md bg-white/20 text-white font-semibold hover:bg-white/30 transition">
            View Rewards →
          </button>
        </div>
      </motion.div>

      {/* ── Floating badge: Wallet connected (top-right) ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.6, duration: 0.6, ease }}
        className="absolute right-[10px] top-[10px] z-30"
      >
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-card border border-foreground/[0.08] shadow-[0_4px_20px_-4px_rgba(0,0,0,0.12)]">
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-[9px] font-semibold text-foreground/70">Wallet Connected</span>
        </div>
      </motion.div>

      {/* ── Floating emoji (top-left corner) ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.7, duration: 0.5, type: "spring", bounce: 0.5 }}
        className="absolute left-[40px] top-[90px] z-10"
      >
        <div className="w-9 h-9 rounded-full bg-surface-card border border-foreground/[0.08] shadow-[0_4px_16px_-4px_rgba(0,0,0,0.12)] flex items-center justify-center text-base">
          ⚡
        </div>
      </motion.div>

      {/* ── Circular Blip token icon ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.65, duration: 0.6, type: "spring", bounce: 0.4 }}
        className="absolute right-[15px] top-[240px] z-30"
      >
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-foreground to-foreground/70 border-[3px] border-surface-card shadow-[0_8px_24px_-4px_rgba(0,0,0,0.25)] flex items-center justify-center">
          <span className="text-background font-bold text-xs">B</span>
        </div>
      </motion.div>

      {/* ── Small card: Privacy shield (right side) ── */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.55, duration: 0.7, ease }}
        className="absolute right-0 top-[120px] z-30 w-[130px] rounded-xl bg-surface-card border border-foreground/[0.08] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.15)] overflow-hidden"
      >
        <div className="p-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-5 h-5 rounded-lg flex items-center justify-center"
              style={{ background: variant === "merchant" ? "rgba(139, 92, 246, 0.1)" : "rgba(59, 130, 246, 0.1)" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke={variant === "merchant" ? "#8b5cf6" : "#3b82f6"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <span className="text-[8px] font-semibold text-foreground/70">Encrypted</span>
          </div>
          <div className="text-[7px] text-foreground/40 leading-relaxed">
            Zero-knowledge proofs protect every transaction
          </div>
        </div>
      </motion.div>

      {/* ── Heart reaction ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8, duration: 0.5, type: "spring", bounce: 0.5 }}
        className="absolute right-[40px] top-[300px] z-30"
      >
        <div className="w-8 h-8 rounded-full bg-rose-500 shadow-[0_4px_16px_-4px_rgba(244,63,94,0.5)] flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="none">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </div>
      </motion.div>
    </div>
  );
}
