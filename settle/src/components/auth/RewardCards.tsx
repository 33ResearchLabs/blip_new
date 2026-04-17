"use client";

import { motion } from "framer-motion";

const rewards = [
  {
    icon: "⚡",
    title: "Get Early Access",
    points: "+100",
    unit: "pts",
    sub: "Join waitlist",
    desc: "Unlock features before everyone else",
  },
  {
    icon: "💰",
    title: "Earn Rewards",
    points: "+200",
    unit: "pts / Referral",
    sub: "Refer friends",
    desc: "Invite others to join blip & boost your score",
  },
  {
    icon: "🚀",
    title: "Level Up Faster",
    points: "+50 to 300",
    unit: "pts / Task",
    sub: "",
    desc: "Successfully complete tasks for extra XP — secure, trading, & earn bigpoints",
  },
];

export function RewardCards() {
  return (
    <div className="grid grid-cols-3 gap-3 w-full mt-8 px-2">
      {rewards.map((card, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 + i * 0.1, duration: 0.5 }}
          className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 relative overflow-hidden"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-base">{card.icon}</span>
            <h4 className="text-[13px] font-bold text-foreground">{card.title}</h4>
          </div>
          <div className="flex items-baseline gap-1 mb-1">
            <span className="text-xl font-bold text-foreground">{card.points}</span>
            <span className="text-[11px] text-foreground/40">{card.unit}</span>
          </div>
          {card.sub && (
            <p className="text-[11px] font-medium text-foreground/60 mb-0.5">{card.sub}</p>
          )}
          <p className="text-[10px] text-foreground/30 leading-relaxed">{card.desc}</p>
        </motion.div>
      ))}
    </div>
  );
}
