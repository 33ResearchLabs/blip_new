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
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center" as const,
    gap: 5,
    background: "none",
    border: "none",
    cursor: "pointer",
    color: screen === key ? "#14151a" : "rgba(20,21,26,0.35)",
    fontSize: 9.5,
    fontWeight: 700,
    padding: "4px 0",
  });

  return (
    <div
      className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full max-w-110"
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        // Honour the home-indicator / gesture-bar inset on notched devices,
        // but take the MAX of the inset and a base padding rather than summing
        // them — summing left a tall empty band between the tabs and the
        // phone's bottom nav on gesture-nav devices.
        padding: "8px 20px",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 14px)",
        borderTop: "1px solid rgba(20,21,26,0.07)",
        background: "#f4f3f1",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
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

      {/* Center Trade FAB */}
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
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
