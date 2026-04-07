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
  <div
    className="fixed bottom-0 left-0 right-0 z-50 bg-surface-base/85 backdrop-blur-[20px] border-t border-border-subtle"
    style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
  >
    <div className="flex items-center justify-around px-4 pt-2.5 pb-1 max-w-[430px] mx-auto">
      {TABS.map(({ key, Icon, label }) => {
        const on = (screen as string) === key;
        return (
          <motion.button
            key={key}
            whileTap={{ scale: 0.88 }}
            onClick={() => setScreen(key as Screen)}
            className="flex flex-col items-center gap-1 min-w-[52px]"
          >
            <div className="relative flex items-center justify-center w-7 h-7">
              <Icon
                size={22}
                strokeWidth={on ? 2.4 : 1.6}
                className={on ? "text-text-primary" : "text-text-tertiary"}
              />
              {on && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -bottom-1 w-1 h-1 rounded-full bg-text-primary"
                />
              )}
            </div>
            <span
              className={`text-[9px] tracking-[0.05em] uppercase ${
                on ? "font-bold text-text-primary" : "font-medium text-text-tertiary"
              }`}
            >
              {label}
            </span>
          </motion.button>
        );
      })}
    </div>
  </div>
);
