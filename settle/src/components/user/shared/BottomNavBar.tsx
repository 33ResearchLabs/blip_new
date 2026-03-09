"use client";

import { motion } from "framer-motion";
import { Home, Activity, ArrowUpRight, User } from "lucide-react";
import type { Screen } from "@/types/user";

const TABS: { id: Screen; Icon: typeof Home; label: string }[] = [
  { id: 'home', Icon: Home, label: 'Home' },
  { id: 'orders', Icon: Activity, label: 'Activity' },
  { id: 'send', Icon: ArrowUpRight, label: 'Pay' },
  { id: 'profile', Icon: User, label: 'You' },
];

interface BottomNavBarProps {
  active: string;
  onChange: (screen: Screen) => void;
  unreadCount?: number;
}

export default function BottomNavBar({ active, onChange, unreadCount = 0 }: BottomNavBarProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-[200] px-4 pb-4">
      <div
        className="flex items-center justify-around px-2 py-2.5 rounded-[28px]"
        style={{
          background: 'rgba(14,14,22,0.92)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {TABS.map(({ id, Icon, label }) => {
          const on = active === id;
          return (
            <motion.button
              key={id}
              whileTap={{ scale: 0.85 }}
              onClick={() => onChange(id)}
              className="relative flex flex-col items-center gap-1 px-5 py-1"
            >
              {on && (
                <motion.div
                  layoutId="user-nav-pill"
                  className="absolute inset-0 rounded-[18px]"
                  style={{ background: 'rgba(124,58,237,0.18)' }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <div className="relative">
                <Icon
                  size={19}
                  strokeWidth={on ? 2.5 : 1.5}
                  style={{ color: on ? '#a78bfa' : 'rgba(255,255,255,0.22)', position: 'relative' }}
                />
                {id === 'orders' && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[14px] h-3.5 bg-violet-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center px-1">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <span
                className="text-[8.5px] font-black uppercase tracking-wider relative"
                style={{ color: on ? '#a78bfa' : 'rgba(255,255,255,0.18)' }}
              >
                {label}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
