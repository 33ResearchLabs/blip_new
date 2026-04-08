"use client";

import { motion } from "framer-motion";
import { Home, Activity, Zap, User, MessageCircle } from "lucide-react";
import type { Screen } from "./types";

interface BottomNavProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  maxW: string;
  notificationCount?: number;
  chatUnreadCount?: number;
}

const TABS = [
  { key: "home",    Icon: Home,          label: "Home" },
  { key: "trade",   Icon: Zap,           label: "Trade" },
  { key: "chats",   Icon: MessageCircle, label: "Inbox" },
  { key: "orders",  Icon: Activity,      label: "Activity" },
  { key: "profile", Icon: User,          label: "You" },
] as const;

export const BottomNav = ({ screen, setScreen, chatUnreadCount = 0 }: BottomNavProps) => (
  <div
    className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-110 px-3 bg-surface-base "
    style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)' }}
  >
    <div className="flex items-center justify-around px-4 pt-2.5 pb-1 rounded-2xl bg-surface-base/90 backdrop-blur-[20px] border border-border-subtle shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
      {TABS.map(({ key, Icon, label }) => {
        const on = (screen as string) === key;
        const badge = key === "chats" ? chatUnreadCount : 0;
        return (
          <motion.button
            key={key}
            whileTap={{ scale: 0.88 }}
            onClick={() => setScreen(key as Screen)}
            className="flex flex-col items-center gap-1 min-w-13"
          >
            <div className="relative flex items-center justify-center w-7 h-7">
              <Icon
                size={22}
                strokeWidth={on ? 2.4 : 1.6}
                className={on ? "text-text-primary" : "text-text-tertiary"}
              />
              {badge > 0 && (
                <span
                  className="absolute -top-0.5 -right-1 min-w-[14px] h-[14px] rounded-full flex items-center justify-center px-1 bg-accent border-2 border-surface-base"
                >
                  <span className="text-[8px] font-extrabold text-accent-text leading-none">
                    {badge > 9 ? "9+" : badge}
                  </span>
                </span>
              )}
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
