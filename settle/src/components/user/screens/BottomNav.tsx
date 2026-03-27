"use client";

import { motion } from "framer-motion";
import { Home, Activity, Zap, User, MessageCircle } from "lucide-react";
import type { Screen } from "./types";

interface BottomNavProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  maxW: string;
}

const TABS = [
  { key: "home",    Icon: Home,          label: "Home" },
  { key: "trade",   Icon: Zap,           label: "Trade" },
  { key: "chats",   Icon: MessageCircle, label: "Inbox" },
  { key: "orders",  Icon: Activity,      label: "Activity" },
  { key: "profile", Icon: User,          label: "You" },
] as const;

export const BottomNav = ({ screen, setScreen }: BottomNavProps) => (
  <div className="fixed bottom-0 left-0 right-0 z-50 border-t"
    style={{ background: '#080810', borderColor: 'rgba(255,255,255,0.07)', paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}>
    <div className="flex items-center justify-around px-4 pt-2.5 pb-1" style={{ maxWidth: 430, margin: '0 auto' }}>
      {TABS.map(({ key, Icon, label }) => {
        const on = (screen as string) === key;
        return (
          <motion.button key={key} whileTap={{ scale: 0.88 }}
            onClick={() => setScreen(key as Screen)}
            className="flex flex-col items-center gap-1" style={{ minWidth: 52 }}>
            <Icon size={22} strokeWidth={on ? 2.4 : 1.6} style={{ color: on ? '#fff' : 'rgba(255,255,255,0.3)' }} />
            <span className={`text-[9px] tracking-[0.05em] uppercase ${on ? "font-black text-white" : "font-medium"}`}
              style={{ color: on ? '#fff' : 'rgba(255,255,255,0.3)' }}>
              {label}
            </span>
          </motion.button>
        );
      })}
    </div>
  </div>
);
