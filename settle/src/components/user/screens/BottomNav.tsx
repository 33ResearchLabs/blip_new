"use client";

import { motion } from "framer-motion";
import { Home, Zap, User, HelpCircle } from "lucide-react";
import type { Screen } from "./types";

interface BottomNavProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  maxW?: string;
  notificationCount?: number;
}

const TABS = [
  { key: "home",    Icon: Home,        label: "Home" },
  { key: "trade",   Icon: Zap,         label: "Trade" },
  { key: "support", Icon: HelpCircle,  label: "Support" },
  { key: "profile", Icon: User,        label: "You" },
] as const;

export const BottomNav = ({ screen, setScreen }: BottomNavProps) => (
  <div
    className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-110 px-3"
    style={{
      // Honor the device's home-indicator inset, but no extra floor — keeps
      // the nav glued to the bottom edge on devices without a chin.
      paddingBottom: 'env(safe-area-inset-bottom, 6px)',
      paddingTop: 6,
      // Transparent wrapper — the pill below carries its own bg + shadow, so
      // there's no white slab below the pill bleeding into the dark page.
      background: 'transparent',
    }}
  >
    <div
      className="flex items-center justify-around px-4 pt-2.5 pb-1"
      style={{
        // Off-white so the pill never disappears against the white Transactions
        // panel above; subtle blur + stronger shadow give a clear floating edge.
        background: 'rgba(244,246,250,0.98)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRadius: 18,
        border: '1px solid rgba(15,23,42,0.10)',
        boxShadow:
          '0 -2px 12px -4px rgba(15,23,42,0.10), 0 12px 32px -10px rgba(15,23,42,0.28), 0 4px 10px -4px rgba(15,23,42,0.16)',
      }}
    >
      {TABS.map(({ key, Icon, label }) => {
        const on = (screen as string) === key;
        const badge = 0;
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
