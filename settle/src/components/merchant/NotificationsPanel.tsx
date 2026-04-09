"use client";

import { memo, useMemo } from "react";
import { Bell, Shield, DollarSign, AlertTriangle, CheckCircle2, ShoppingBag, MessageCircle } from "lucide-react";
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
  return (
    <div style={{ height: '50%' }} className="flex flex-col border-b border-section-divider overflow-hidden shrink-0">
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="px-3 py-2 border-b border-section-divider">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-foreground/30" />
              <h2 className="text-[10px] font-bold text-foreground/60 font-mono tracking-wider uppercase">
                Notifications
              </h2>
            </div>
            {groupedNotifications.filter(g => g.ids.some(id => notifications.find(n => n.id === id && !n.read))).length > 0 && (
              <span className="text-[10px] bg-primary text-white font-bold px-1.5 py-0.5 rounded-full font-mono tabular-nums min-w-[20px] text-center">
                {groupedNotifications.filter(g => g.ids.some(id => notifications.find(n => n.id === id && !n.read))).length}
              </span>
            )}
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-foreground/15">
              <Bell className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-[10px] font-mono">No notifications</p>
            </div>
          ) : (
            <div className="space-y-1">
              {groupedNotifications.map((group) => {
                const notif = group.latest;
                const secAgo = Math.floor((Date.now() - notif.timestamp) / 1000);
                const relTime = secAgo < 60 ? 'Just now'
                  : secAgo < 3600 ? `${Math.floor(secAgo / 60)}m ago`
                  : secAgo < 86400 ? `${Math.floor(secAgo / 3600)}h ago`
                  : `${Math.floor(secAgo / 86400)}d ago`;
                const hasUnread = group.ids.some(id => notifications.find(n => n.id === id && !n.read));

                return (
                  <div
                    key={group.ids[0]}
                    onClick={() => {
                      group.ids.forEach(id => onMarkRead(id));
                      if (notif.orderId) {
                        if (notif.type === 'message' && onOpenChat) {
                          onOpenChat(notif.orderId);
                        } else {
                          onSelectOrder(notif.orderId);
                        }
                      }
                    }}
                    className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                      hasUnread
                        ? 'bg-foreground/[0.03] border-foreground/[0.08] hover:border-border-strong'
                        : 'bg-transparent border-foreground/[0.04] hover:border-foreground/[0.08]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                        notif.type === 'escrow' ? 'bg-primary/10' :
                        notif.type === 'dispute' ? 'bg-red-500/10' :
                        notif.type === 'complete' ? 'bg-emerald-500/10' :
                        notif.type === 'payment' ? 'bg-blue-500/10' :
                        notif.type === 'message' ? 'bg-purple-500/10' :
                        'bg-foreground/[0.04]'
                      }`}>
                        {notif.type === 'order' && <ShoppingBag className="w-3 h-3 text-foreground/40" />}
                        {notif.type === 'escrow' && <Shield className="w-3 h-3 text-primary/60" />}
                        {notif.type === 'payment' && <DollarSign className="w-3 h-3 text-blue-400/60" />}
                        {notif.type === 'dispute' && <AlertTriangle className="w-3 h-3 text-red-400" />}
                        {notif.type === 'complete' && <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />}
                        {notif.type === 'message' && <MessageCircle className="w-3 h-3 text-purple-400/60" />}
                        {notif.type === 'system' && <Bell className="w-3 h-3 text-foreground/40" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[11px] leading-tight ${hasUnread ? 'text-foreground/80 font-medium' : 'text-foreground/50'}`}>
                          {notif.message}
                        </p>
                        <span className="text-[9px] text-foreground/25 font-mono">{relTime}</span>
                      </div>
                      {group.count > 1 && (
                        <span className="text-[9px] font-mono text-foreground/30 bg-foreground/[0.06] px-1.5 py-0.5 rounded-full flex-shrink-0">
                          x{group.count}
                        </span>
                      )}
                      {hasUnread && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
