"use client";

import { memo, useMemo } from "react";
import {
  Bell,
  Shield,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  ShoppingBag,
  MessageCircle,
  Check,
  Info,
} from "lucide-react";
import type { Notification } from "@/types/merchant";

interface NotificationsPanelProps {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onSelectOrder: (orderId: string) => void;
  onOpenChat?: (orderId: string) => void;
}

interface GroupedNotification {
  latest: Notification;
  count: number;
  ids: string[];
}

// Type → visual treatment map. Keeps the JSX clean and consistent.
const TYPE_STYLES: Record<
  string,
  { bg: string; ring: string; icon: string }
> = {
  escrow:   { bg: 'bg-primary/[0.12]',     ring: 'ring-primary/25',     icon: 'text-primary' },
  payment:  { bg: 'bg-blue-500/[0.12]',    ring: 'ring-blue-500/25',    icon: 'text-blue-400' },
  complete: { bg: 'bg-emerald-500/[0.12]', ring: 'ring-emerald-500/25', icon: 'text-emerald-400' },
  message:  { bg: 'bg-purple-500/[0.12]',  ring: 'ring-purple-500/25',  icon: 'text-purple-400' },
  dispute:  { bg: 'bg-red-500/[0.12]',     ring: 'ring-red-500/25',     icon: 'text-red-400' },
  order:    { bg: 'bg-foreground/[0.06]',  ring: 'ring-foreground/15',  icon: 'text-foreground/60' },
  system:   { bg: 'bg-foreground/[0.06]',  ring: 'ring-foreground/15',  icon: 'text-foreground/50' },
};

function getStyle(type: string) {
  return TYPE_STYLES[type] ?? TYPE_STYLES.system;
}

function relativeTime(timestamp: number): string {
  const secAgo = Math.floor((Date.now() - timestamp) / 1000);
  if (secAgo < 60) return 'now';
  if (secAgo < 3600) return `${Math.floor(secAgo / 60)}m`;
  if (secAgo < 86400) return `${Math.floor(secAgo / 3600)}h`;
  return `${Math.floor(secAgo / 86400)}d`;
}

export const NotificationsPanel = memo(function NotificationsPanel({
  notifications,
  onMarkRead,
  onSelectOrder,
  onOpenChat,
}: NotificationsPanelProps) {
  const groupedNotifications = useMemo(() => {
    const groups: GroupedNotification[] = [];
    const seen = new Map<string, number>();

    for (const notif of notifications) {
      const key = notif.message;
      const idx = seen.get(key);
      if (idx !== undefined) {
        groups[idx].count++;
        groups[idx].ids.push(notif.id);
        if (notif.timestamp > groups[idx].latest.timestamp) {
          groups[idx].latest = notif;
        }
      } else {
        seen.set(key, groups.length);
        groups.push({ latest: notif, count: 1, ids: [notif.id] });
      }
    }
    return groups;
  }, [notifications]);

  // Compute unread set once for the header counter + Mark-all-read button.
  const unreadIds = useMemo(
    () => notifications.filter((n) => !n.read).map((n) => n.id),
    [notifications],
  );
  const unreadCount = unreadIds.length;

  const markAllRead = () => {
    unreadIds.forEach((id) => onMarkRead(id));
  };

  return (
    <div style={{ height: '50%' }} className="flex flex-col border-b border-section-divider overflow-hidden shrink-0">
      <div className="flex flex-col h-full min-h-0">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="px-3 py-2 border-b border-section-divider">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-foreground/30" />
              <h2 className="text-[10px] font-bold text-foreground/60 font-mono tracking-wider uppercase">
                Notifications
              </h2>
            </div>

            <div className="flex items-center gap-1">
              {/* Unread badge */}
              {unreadCount > 0 && (
                <span className="text-[10px] bg-primary text-white font-bold px-1.5 py-0.5 rounded-full font-mono tabular-nums min-w-[20px] text-center shadow-sm shadow-primary/20">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}

              {/* Mark all read — only when unread > 0 */}
              {unreadCount > 0 && (
                <div className="group relative flex items-center">
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 px-1.5 py-1 rounded text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors"
                    title="Mark all notifications as read"
                    aria-label="Mark all notifications as read"
                  >
                    <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                    <span className="text-[9px] font-bold uppercase tracking-wider hidden sm:inline">
                      Read
                    </span>
                  </button>
                  <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-[180px] z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="block rounded-lg bg-foreground text-background text-[10.5px] font-medium px-2.5 py-1.5 leading-snug shadow-xl shadow-black/40">
                      Marks every notification as read. Items stay in the list — only the unread dot disappears.
                    </span>
                  </span>
                </div>
              )}

              {/* Info hint */}
              <div className="group relative flex items-center">
                <Info className="w-3 h-3 text-foreground/25 hover:text-foreground/50 cursor-help transition-colors" />
                <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-[200px] z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="block rounded-lg bg-foreground text-background text-[10.5px] font-medium px-2.5 py-1.5 leading-snug shadow-xl shadow-black/40">
                    <span className="block font-bold mb-0.5">Notifications</span>
                    Real-time alerts for orders, payments, escrow, disputes, and chats. Click any item to jump to the order.
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Notifications List ─────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-foreground/15">
              <div className="w-12 h-12 rounded-full bg-foreground/[0.03] border border-foreground/[0.06] flex items-center justify-center mb-3">
                <Bell className="w-5 h-5 opacity-40" />
              </div>
              <p className="text-[11px] font-medium text-foreground/40">All caught up</p>
              <p className="text-[10px] text-foreground/25 mt-0.5">New events will appear here</p>
            </div>
          ) : (
            groupedNotifications.map((group) => {
              const notif = group.latest;
              const hasUnread = group.ids.some((id) => notifications.find((n) => n.id === id && !n.read));
              const style = getStyle(notif.type);

              return (
                <button
                  key={group.ids[0]}
                  onClick={() => {
                    group.ids.forEach((id) => onMarkRead(id));
                    if (notif.orderId) {
                      if (notif.type === 'message' && onOpenChat) {
                        onOpenChat(notif.orderId);
                      } else {
                        onSelectOrder(notif.orderId);
                      }
                    }
                  }}
                  className={`group relative w-full text-left p-2.5 rounded-xl border overflow-hidden transition-all ${
                    hasUnread
                      ? 'bg-gradient-to-br from-primary/[0.04] to-transparent border-primary/15 hover:border-primary/35 hover:shadow-md hover:shadow-primary/[0.06]'
                      : 'bg-foreground/[0.015] border-foreground/[0.05] hover:border-foreground/[0.10] opacity-70 hover:opacity-100'
                  }`}
                >
                  {/* Unread accent stripe */}
                  {hasUnread && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-primary/80 to-primary/30 rounded-r" />
                  )}

                  <div className="flex items-start gap-2.5">
                    {/* Type icon — circular badge with subtle ring */}
                    <div className={`relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 ring-1 ${style.bg} ${style.ring}`}>
                      {notif.type === 'order' && <ShoppingBag className={`w-3.5 h-3.5 ${style.icon}`} strokeWidth={2.2} />}
                      {notif.type === 'escrow' && <Shield className={`w-3.5 h-3.5 ${style.icon}`} strokeWidth={2.2} />}
                      {notif.type === 'payment' && <DollarSign className={`w-3.5 h-3.5 ${style.icon}`} strokeWidth={2.2} />}
                      {notif.type === 'dispute' && <AlertTriangle className={`w-3.5 h-3.5 ${style.icon}`} strokeWidth={2.2} />}
                      {notif.type === 'complete' && <CheckCircle2 className={`w-3.5 h-3.5 ${style.icon}`} strokeWidth={2.2} />}
                      {notif.type === 'message' && <MessageCircle className={`w-3.5 h-3.5 ${style.icon}`} strokeWidth={2.2} />}
                      {notif.type === 'system' && <Bell className={`w-3.5 h-3.5 ${style.icon}`} strokeWidth={2.2} />}

                      {/* Group count badge */}
                      {group.count > 1 && (
                        <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 bg-foreground text-background text-[9px] font-extrabold rounded-full flex items-center justify-center ring-2 ring-background tabular-nums">
                          {group.count > 9 ? '9+' : group.count}
                        </span>
                      )}
                    </div>

                    {/* Content column */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <p className={`text-[11.5px] leading-snug line-clamp-2 ${
                          hasUnread ? 'text-foreground font-semibold' : 'text-foreground/55 font-normal'
                        }`}>
                          {notif.message}
                        </p>
                        <span className={`text-[9px] font-mono tabular-nums shrink-0 ${
                          hasUnread ? 'text-primary/70' : 'text-foreground/25'
                        }`}>
                          {relativeTime(notif.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Unread dot */}
                    {hasUnread && (
                      <div className="w-2 h-2 rounded-full bg-primary shadow-[0_0_6px_rgba(255,138,76,0.6)] shrink-0 mt-1.5" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});
