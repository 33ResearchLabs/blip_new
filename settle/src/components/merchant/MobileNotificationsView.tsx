"use client";

import type { ReactElement } from "react";
import type { Notification } from "@/types/merchant";

const T = {
  text: "#f5f5f7",
  muted: "#86868b",
  muted2: "#aeaeb2",
  faint: "#5a5a60",
  hair: "rgba(255,255,255,0.09)",
  glass: "rgba(255,255,255,0.055)",
  mint: "#b8e9d4",
};

/* type → icon SVG + accent color */
const NT: Record<string, { icon: ReactElement; color: string }> = {
  order: {
    icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>,
    color: T.muted2,
  },
  escrow: {
    icon: <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/></svg>,
    color: T.mint,
  },
  payment: {
    icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>,
    color: "#7da0ff",
  },
  complete: {
    icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="m4 12.5 5 5L20 6.5"/></svg>,
    color: T.mint,
  },
  dispute: {
    icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5.5c0 4.3 3 7.3 7 8.5 4-1.2 7-4.2 7-8.5V6l-7-3Z"/></svg>,
    color: "#ff7a7e",
  },
  message: {
    icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-11.9 7.6L3 21l1.9-6.1A8.4 8.4 0 1 1 21 11.5Z"/></svg>,
    color: "#c48ae0",
  },
  warning: {
    icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17.4v.01"/></svg>,
    color: "#e2b770",
  },
  system: {
    icon: <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor"><path d="m12 2 2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z"/></svg>,
    color: T.mint,
  },
};

function relativeTime(timestamp: number): string {
  const sec = Math.floor((Date.now() - timestamp) / 1000);
  if (sec < 60) return "now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

interface NotifRowProps {
  n: Notification;
  onMarkRead: (id: string) => void;
  onSelectOrder: (orderId: string) => void;
  onAction?: () => void;
}

function NotifRow({ n, onMarkRead, onSelectOrder, onAction }: NotifRowProps) {
  const ty = NT[n.type] ?? NT.system;
  const isClickable = !!(n.orderId || onAction);
  const handleClick = () => {
    if (!n.read) onMarkRead(n.id);
    if (onAction) { onAction(); return; }
    if (n.orderId) onSelectOrder(n.orderId);
  };
  return (
    <div
      onClick={handleClick}
      style={{
        display: "flex", gap: 12, alignItems: "flex-start",
        padding: "12px 14px", borderRadius: 16, marginBottom: 4,
        cursor: isClickable ? "pointer" : "default",
        background: !n.read ? "rgba(255,255,255,0.045)" : "transparent",
        border: !n.read ? `1px solid ${T.hair}` : "1px solid transparent",
        transition: "background 0.15s",
      }}
    >
      {/* Icon disc */}
      <span style={{
        width: 34, height: 34, borderRadius: 11, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(255,255,255,0.04)", border: `1px solid ${T.hair}`,
        color: ty.color,
      }}>
        {ty.icon}
      </span>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, color: !n.read ? "#fff" : T.muted2, lineHeight: 1.3 }}>
          {n.message}
        </div>
        <div style={{ color: T.faint, fontSize: 11, fontWeight: 600, marginTop: 3 }}>
          {relativeTime(n.timestamp)}
        </div>
      </div>

      {/* Unread dot */}
      {!n.read && (
        <span style={{ width: 8, height: 8, borderRadius: 99, background: ty.color, flexShrink: 0, marginTop: 5 }} />
      )}
    </div>
  );
}

export interface MobileNotificationsViewProps {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onSelectOrder: (orderId: string) => void;
  onClose: () => void;
  onWelcomeTap?: () => void;
}

const WELCOME_MSG = "Welcome to Blip Markets — tap to see what's new";

export function MobileNotificationsView({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onSelectOrder,
  onClose,
  onWelcomeTap,
}: MobileNotificationsViewProps) {
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ color: T.muted2 }}>
              <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/>
              <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
            </svg>
            <span style={{ fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em", color: T.text }}>Notifications</span>
            {unread > 0 && (
              <span style={{
                minWidth: 20, height: 20, padding: "0 6px", borderRadius: 99,
                background: T.mint, color: "#08221a", fontSize: 11.5, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {unread}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ width: 34, height: 34, borderRadius: 999, background: T.glass, border: `1px solid ${T.hair}`, display: "flex", alignItems: "center", justifyContent: "center", color: T.muted2, cursor: "pointer" }}
          >
            <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onMarkAllRead}
            style={{ background: "none", border: "none", color: unread > 0 ? T.mint : T.faint, fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0 }}
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* List */}
      {notifications.length === 0 ? (
        <div style={{ textAlign: "center", paddingTop: 60 }}>
          <div style={{ width: 60, height: 60, borderRadius: 20, background: T.glass, border: `1px solid ${T.hair}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: T.muted }}>
            <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/>
              <path d="M13.7 21a2 2 0 0 1-3.4 0"/>
            </svg>
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.text }}>All clear</div>
          <div style={{ color: T.muted, fontSize: 13, fontWeight: 500, marginTop: 5 }}>No notifications yet.</div>
        </div>
      ) : (
        <div>
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 6px 6px" }}>
            Recent
          </div>
          {notifications.map((n) => (
            <NotifRow
              key={n.id}
              n={n}
              onMarkRead={onMarkRead}
              onSelectOrder={onSelectOrder}
              onAction={n.message === WELCOME_MSG ? onWelcomeTap : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
