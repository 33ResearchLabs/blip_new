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
    className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-110 px-3"
    style={{
      paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)',
      // ── Always white nav with dark buttons, regardless of theme
      background: '#ffffff',
    }}
  >
    <div
      className="flex items-center justify-around px-4 pt-2.5 pb-1"
      style={{
        background: 'rgba(255,255,255,0.96)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderRadius: 18,
        border: '1px solid rgba(15,23,42,0.06)',
        boxShadow: '0 8px 28px -8px rgba(15,23,42,0.18), 0 2px 6px -2px rgba(15,23,42,0.10)',
      }}
    >
      {TABS.map(({ key, Icon, label }) => {
        const on = (screen as string) === key;
        const badge = key === "chats" ? chatUnreadCount : 0;
        const iconColor = on ? '#0B0F14' : 'rgba(15,23,42,0.45)';
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
                style={{ color: iconColor }}
              />
              {badge > 0 && (
                <span
                  className="absolute -top-0.5 -right-1 flex items-center justify-center"
                  style={{
                    minWidth: 14, height: 14, padding: '0 4px', borderRadius: 999,
                    background: '#0B0F14', border: '2px solid #ffffff',
                  }}
                >
                  <span style={{ fontSize: 8, fontWeight: 800, color: '#ffffff', lineHeight: 1 }}>
                    {badge > 9 ? "9+" : badge}
                  </span>
                </span>
              )}
              {on && (
                <motion.div
                  layoutId="nav-indicator"
                  className="absolute -bottom-1 w-1 h-1 rounded-full"
                  style={{ background: '#0B0F14' }}
                />
              )}
            </div>
            <span
              style={{
                fontSize: 9,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                fontWeight: on ? 800 : 600,
                color: iconColor,
              }}
            >
              {label}
            </span>
          </motion.button>
        );
      })}
    </div>
  </div>
);
