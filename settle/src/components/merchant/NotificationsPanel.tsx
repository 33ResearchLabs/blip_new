"use client";

import { memo } from "react";
import { Bell, Shield, DollarSign, AlertTriangle, CheckCircle2, ShoppingBag } from "lucide-react";
import type { Notification } from "@/types/merchant";

interface NotificationsPanelProps {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onSelectOrder: (orderId: string) => void;
}

export const NotificationsPanel = memo(function NotificationsPanel({
  notifications,
  onMarkRead,
  onSelectOrder,
}: NotificationsPanelProps) {
  return (
    <div style={{ maxHeight: '50%' }} className="flex flex-col border-b border-white/[0.04] overflow-hidden shrink-0">
      <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="px-3 py-2 border-b border-white/[0.04]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-white/30" />
              <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
                Notifications
              </h2>
            </div>
            {notifications.filter(n => !n.read).length > 0 && (
              <span className="text-[10px] border border-orange-500/30 text-orange-400 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
                {notifications.filter(n => !n.read).length}
              </span>
            )}
          </div>
        </div>

        {/* Notifications List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/15">
              <Bell className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-[10px] font-mono">No notifications</p>
            </div>
          ) : (
            <div className="space-y-1">
              {notifications.map((notif) => {
                const secAgo = Math.floor((Date.now() - notif.timestamp) / 1000);
                const relTime = secAgo < 60 ? 'Just now'
                  : secAgo < 3600 ? `${Math.floor(secAgo / 60)}m ago`
                  : secAgo < 86400 ? `${Math.floor(secAgo / 3600)}h ago`
                  : `${Math.floor(secAgo / 86400)}d ago`;

                return (
                  <div
                    key={notif.id}
                    onClick={() => {
                      onMarkRead(notif.id);
                      if (notif.orderId) onSelectOrder(notif.orderId);
                    }}
                    className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                      !notif.read
                        ? 'bg-white/[0.03] border-white/[0.08] hover:border-white/[0.12]'
                        : 'bg-transparent border-white/[0.04] hover:border-white/[0.08]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                        notif.type === 'escrow' ? 'bg-orange-500/10' :
                        notif.type === 'dispute' ? 'bg-red-500/10' :
                        notif.type === 'complete' ? 'bg-emerald-500/10' :
                        notif.type === 'payment' ? 'bg-blue-500/10' :
                        'bg-white/[0.04]'
                      }`}>
                        {notif.type === 'order' && <ShoppingBag className="w-3 h-3 text-white/40" />}
                        {notif.type === 'escrow' && <Shield className="w-3 h-3 text-orange-400/60" />}
                        {notif.type === 'payment' && <DollarSign className="w-3 h-3 text-blue-400/60" />}
                        {notif.type === 'dispute' && <AlertTriangle className="w-3 h-3 text-red-400" />}
                        {notif.type === 'complete' && <CheckCircle2 className="w-3 h-3 text-emerald-400/60" />}
                        {notif.type === 'system' && <Bell className="w-3 h-3 text-white/40" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[11px] leading-tight ${!notif.read ? 'text-white/80 font-medium' : 'text-white/50'}`}>
                          {notif.message}
                        </p>
                        <span className="text-[9px] text-white/25 font-mono">{relTime}</span>
                      </div>
                      {!notif.read && (
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-400 flex-shrink-0" />
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
