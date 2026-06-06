"use client";

import { motion } from "framer-motion";
import {
  Home,
  Activity,
  MessageCircle,
  User,
  Send,
  Bell,
  Gift,
  HelpCircle,
  Wallet,
} from "lucide-react";
import type { Screen } from "@/components/user/screens/types";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { formatCrypto } from "@/lib/format";

interface DesktopSidebarProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  userName: string;
  userAvatar: string | null;
  userId: string | null;
  userBalance?: number;
  notificationCount?: number;
  chatUnreadCount?: number;
}

interface NavItem {
  key: Screen;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

export function DesktopSidebar({
  screen,
  setScreen,
  userName,
  userAvatar,
  userId,
  userBalance,
  notificationCount = 0,
  chatUnreadCount = 0,
}: DesktopSidebarProps) {
  const navItems: NavItem[] = [
    { key: "home", label: "Home", icon: <Home size={18} strokeWidth={1.9} /> },
    { key: "trade", label: "Trade", icon: <Send size={18} strokeWidth={1.9} /> },
    { key: "orders", label: "Activity", icon: <Activity size={18} strokeWidth={1.9} /> },
    {
      key: "chats",
      label: "Inbox",
      icon: <MessageCircle size={18} strokeWidth={1.9} />,
      badge: chatUnreadCount || notificationCount,
    },
    { key: "wallet", label: "Wallet", icon: <Wallet size={18} strokeWidth={1.9} /> },
    { key: "rewards", label: "Rewards", icon: <Gift size={18} strokeWidth={1.9} /> },
    { key: "notifications", label: "Notifications", icon: <Bell size={18} strokeWidth={1.9} />, badge: notificationCount },
    { key: "support", label: "Support", icon: <HelpCircle size={18} strokeWidth={1.9} /> },
    { key: "profile", label: "Profile", icon: <User size={18} strokeWidth={1.9} /> },
  ];

  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        background: "#0d1017",
        borderRight: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        flexDirection: "column",
        padding: "24px 0 16px",
        height: "100vh",
        position: "sticky",
        top: 0,
        overflowY: "auto",
      }}
    >
      {/* Logo / wordmark */}
      <div style={{ padding: "0 20px 28px" }}>
        <span
          style={{
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: "-0.5px",
            color: "#ffb02e",
            fontFamily: "Manrope, sans-serif",
          }}
        >
          blip
        </span>
      </div>

      {/* Balance pill */}
      {typeof userBalance === "number" && (
        <div
          style={{
            margin: "0 12px 20px",
            padding: "12px 14px",
            background: "rgba(255,176,46,0.08)",
            borderRadius: 12,
            border: "1px solid rgba(255,176,46,0.15)",
          }}
        >
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 3 }}>
            Balance
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>
            {formatCrypto(userBalance)} <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontWeight: 500 }}>USDT</span>
          </div>
        </div>
      )}

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "0 8px" }}>
        {navItems.map((item) => {
          const active = screen === item.key;
          return (
            <motion.button
              key={item.key}
              whileTap={{ scale: 0.97 }}
              onClick={() => setScreen(item.key)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 10,
                border: "none",
                cursor: "pointer",
                background: active ? "rgba(255,255,255,0.07)" : "transparent",
                color: active ? "#fff" : "rgba(255,255,255,0.5)",
                fontSize: 13.5,
                fontWeight: active ? 700 : 500,
                textAlign: "left",
                marginBottom: 2,
                position: "relative",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              {/* Active indicator bar */}
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "20%",
                    height: "60%",
                    width: 3,
                    borderRadius: 999,
                    background: "#ffb02e",
                  }}
                />
              )}
              <span style={{ opacity: active ? 1 : 0.7 }}>{item.icon}</span>
              <span>{item.label}</span>
              {!!item.badge && (
                <span
                  style={{
                    marginLeft: "auto",
                    minWidth: 18,
                    height: 18,
                    padding: "0 5px",
                    borderRadius: 999,
                    background: "#ffb02e",
                    color: "#0b0b0d",
                    fontSize: 10,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {item.badge > 9 ? "9+" : item.badge}
                </span>
              )}
            </motion.button>
          );
        })}
      </nav>

      {/* Profile mini-card at bottom */}
      <button
        onClick={() => setScreen("profile")}
        style={{
          margin: "8px 8px 0",
          padding: "10px 12px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.06)",
          background: screen === "profile" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          color: "rgba(255,255,255,0.75)",
        }}
      >
        <UserAvatar name={userName} avatarUrl={userAvatar} size={30} />
        <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {userName || "You"}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>View profile</div>
        </div>
      </button>
    </aside>
  );
}
