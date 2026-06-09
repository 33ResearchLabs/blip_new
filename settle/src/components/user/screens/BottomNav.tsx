"use client";

import { motion } from "framer-motion";
import { Home, Activity, User, MessageCircle, Send } from "lucide-react";
import type { Screen } from "./types";

interface BottomNavProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  maxW: string;
  notificationCount?: number;
  chatUnreadCount?: number;
}

// Single source of truth for the user-app bottom nav. Layout:
//   Home · Activity · [ Trade FAB ] · Inbox · You
// The golden center FAB is the Trade action; "Rewards" lives in the top
// header now (per-screen), so the 4th slot here is Inbox (chats) with the
// unread badge. Flat-light bar so it reads as one continuous surface with
// the white content panels above it on every screen.
export const BottomNav = ({
  screen,
  setScreen,
  notificationCount = 0,
  chatUnreadCount = 0,
}: BottomNavProps) => {
  const inboxBadge = chatUnreadCount || notificationCount || 0;

  const tab = (key: Screen, label: string) => ({
    // Fixed width (not flex:1) so the bar can use `space-between` to spread the
    // tabs — with flex:1 every tab filled a fifth-of-the-bar column and the
    // icon centred inside it, leaving the Home and You icons ~60px in from the
    // edge. With `space-between` the first/last tabs sit against the bar's
    // padding edge, so the end-icon centre lands at (sidePadding + width/2)
    // from the frame edge. The four equal-width side tabs keep the centre FAB
    // perfectly centred.
    width: 44,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center" as const,
    gap: 5,
    background: "none",
    border: "none",
    cursor: "pointer",
    // Values mirror the light-theme tokens (#14151a = text-primary,
    // rgba(20,21,26,0.72) = text-secondary-strong). Kept as literals — not
    // var(--color-…) — because this bar is intentionally always-light
    // (hardcoded #f4f3f1 bg), so the theme-adapting var would flip to white
    // in dark mode and vanish on the light bar.
    color: screen === key ? "#14151a" : "rgba(20,21,26,0.72)",
    fontSize: 9.5,
    fontWeight: 700,
    padding: "4px 0",
  });

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50"
      style={{
        // Floating dock: a compact, lightly-rounded bar that hovers above the
        // bottom edge instead of a full-width bar glued to it. Centred + width-
        // capped so it reads as an intentional dock at every width — including
        // the wide tablet column, where a full bar looked sparse/mismatched.
        width: "min(420px, calc(100% - 28px))",
        // Sits just above the phone's gesture/nav bar (env safe-area) with a
        // small 4px float — tightened from 10px to shrink the gap between this
        // dock and the system navigation bar.
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 4px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        // Side padding keeps the Home / You end-tabs off the dock edge; the
        // FAB's -22 marginTop still lifts it above the dock's rounded top.
        padding: "8px 18px 10px",
        borderRadius: 20, // little-bit-rounded dock corners
        border: "1px solid rgba(20,21,26,0.08)",
        background: "#f4f3f1",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow:
          "0 10px 30px -8px rgba(0,0,0,0.22), 0 2px 8px -2px rgba(0,0,0,0.12)",
      }}
    >
      {/* Home */}
      <button onClick={() => setScreen("home")} style={tab("home", "Home")}>
        <Home size={20} strokeWidth={screen === "home" ? 2.4 : 1.8} />
        <span>Home</span>
      </button>

      {/* Activity */}
      <button onClick={() => setScreen("orders")} style={tab("orders", "Activity")}>
        <Activity size={20} strokeWidth={screen === "orders" ? 2.4 : 1.8} />
        <span>Activity</span>
      </button>

      {/* Center Trade FAB — natural width; the two equal-width tabs on each
          side keep it centred under `space-between`. */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={() => setScreen("trade")}
          aria-label="Trade"
          style={{
            width: 58,
            height: 58,
            borderRadius: 999,
            background: "#ffb02e",
            color: "#0b0b0d",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: -22,
            boxShadow: "0 10px 26px rgba(255,176,46,0.45)",
            flexShrink: 0,
          }}
        >
          <Send size={22} strokeWidth={2.2} />
        </motion.button>
      </div>

      {/* Inbox (chats) — carries the unread badge */}
      <button onClick={() => setScreen("chats")} style={tab("chats", "Inbox")}>
        <div style={{ position: "relative", display: "flex" }}>
          <MessageCircle size={20} strokeWidth={screen === "chats" ? 2.4 : 1.8} />
          {inboxBadge > 0 && (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -6,
                minWidth: 14,
                height: 14,
                padding: "0 4px",
                borderRadius: 999,
                background: "#0B0F14",
                border: "2px solid #f4f3f1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 8, fontWeight: 800, color: "#fff", lineHeight: 1 }}>
                {inboxBadge > 9 ? "9+" : inboxBadge}
              </span>
            </span>
          )}
        </div>
        <span>Inbox</span>
      </button>

      {/* You */}
      <button onClick={() => setScreen("profile")} style={tab("profile", "You")}>
        <User size={20} strokeWidth={screen === "profile" ? 2.4 : 1.8} />
        <span>You</span>
      </button>
    </div>
  );
};
