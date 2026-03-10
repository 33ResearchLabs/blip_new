"use client";

import { motion } from "framer-motion";
import { Wallet, Activity, Zap, User } from "lucide-react";
import type { Screen } from "./types";

interface BottomNavProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  maxW: string;
}

export const BottomNav = ({ screen, setScreen, maxW }: BottomNavProps) => (
  <div className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-5">
    <div className={`${maxW} mx-auto`}>
      <div className="flex items-center justify-around px-2 py-2.5 rounded-[28px]"
        style={{ background: 'rgba(14,14,22,0.92)', backdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {([
          { key: "home",   icon: Wallet,   label: "Home" },
          { key: "orders", icon: Activity, label: "Activity" },
          { key: "trade",  icon: Zap,      label: "Trade" },
          { key: "profile",icon: User,     label: "You" },
        ] as const).map(({ key, icon: Icon, label }) => {
          const on = (screen as string) === key;
          return (
            <motion.button key={key} whileTap={{ scale: 0.85 }} onClick={() => setScreen(key as Screen)}
              className="relative flex flex-col items-center gap-1 px-5 py-1">
              {on && (
                <motion.div layoutId="blip-nav-pill" className="absolute inset-0 rounded-[18px]"
                  style={{ background: 'rgba(124,58,237,0.18)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
              )}
              <Icon size={19} strokeWidth={on ? 2.5 : 1.5} style={{ color: on ? '#a78bfa' : 'rgba(255,255,255,0.22)', position: 'relative' }} />
              <span className="text-[8.5px] font-black uppercase tracking-wider relative z-10"
                style={{ color: on ? '#a78bfa' : 'rgba(255,255,255,0.18)' }}>
                {label}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  </div>
);
