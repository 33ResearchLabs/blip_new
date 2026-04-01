"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, Zap, Lock, DollarSign, AlertTriangle, CheckCircle2, MessageCircle, Shield, Activity } from "lucide-react";
import { BottomNav } from "./BottomNav";
import type { Screen } from "./types";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

function getNotifIcon(type: string) {
  switch (type) {
    case 'order': return <Zap size={16} color="#f97316" />;
    case 'escrow': return <Lock size={16} color="#3b82f6" />;
    case 'payment': return <DollarSign size={16} color="#10b981" />;
    case 'dispute': return <AlertTriangle size={16} color="#ef4444" />;
    case 'complete': return <CheckCircle2 size={16} color="#10b981" />;
    case 'message': return <MessageCircle size={16} color="#a855f7" />;
    case 'warning': return <AlertTriangle size={16} color="#f59e0b" />;
    case 'action': return <Shield size={16} color="#f97316" />;
    default: return <Bell size={16} color="rgba(255,255,255,0.4)" />;
  }
}

function getNotifBg(type: string) {
  switch (type) {
    case 'order': return 'rgba(249,115,22,0.08)';
    case 'escrow': return 'rgba(59,130,246,0.08)';
    case 'payment': return 'rgba(16,185,129,0.08)';
    case 'dispute': return 'rgba(239,68,68,0.08)';
    case 'complete': return 'rgba(16,185,129,0.08)';
    case 'message': return 'rgba(168,85,247,0.08)';
    case 'warning': return 'rgba(245,158,11,0.08)';
    default: return 'rgba(255,255,255,0.04)';
  }
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export interface NotificationsScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  unreadCount: number;
  maxW: string;
}

export const NotificationsScreen = ({
  screen,
  setScreen,
  notifications,
  onMarkRead,
  onMarkAllRead,
  unreadCount,
  maxW,
}: NotificationsScreenProps) => {
  const [activeTab, setActiveTab] = useState<'alerts' | 'activity'>('alerts');
  const [timeFilter, setTimeFilter] = useState<'today' | '7d' | '30d' | 'all'>('today');

  const filteredNotifications = (() => {
    if (timeFilter === 'all') return notifications;
    const now = Date.now();
    const cutoff = timeFilter === 'today' ? now - 86400000 : timeFilter === '7d' ? now - 7 * 86400000 : now - 30 * 86400000;
    return notifications.filter(n => n.timestamp >= cutoff);
  })();

  return (
    <div className="flex flex-col h-dvh overflow-hidden" style={{ background: '#060606' }}>

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 4 }}>Updates</p>
            <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.03em', color: '#fff', lineHeight: 1 }}>Notifications</p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>Mark all read</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Tabs ── */}
      <div className="px-5 pb-2 flex gap-2 shrink-0">
        <button
          onClick={() => setActiveTab('alerts')}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all"
          style={activeTab === 'alerts'
            ? { background: '#fff', color: '#000' }
            : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }
          }
        >
          <Bell size={13} strokeWidth={2.2} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>Alerts</span>
          {unreadCount > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 800, minWidth: 18, textAlign: 'center',
              background: activeTab === 'alerts' ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
              color: '#ef4444', borderRadius: 10, padding: '1px 5px',
            }}>
              {unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => { setActiveTab('activity'); setScreen('orders'); }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}
        >
          <Activity size={13} strokeWidth={2.2} />
          <span style={{ fontSize: 12, fontWeight: 700 }}>Orders</span>
        </button>
      </div>

      {/* ── Time Filter ── */}
      <div className="px-5 pb-2 flex gap-1.5 shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {([
          { key: 'today' as const, label: 'Today' },
          { key: '7d' as const, label: '7 Days' },
          { key: '30d' as const, label: '30 Days' },
          { key: 'all' as const, label: 'All' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTimeFilter(key)}
            className="shrink-0 px-3 py-1 rounded-full transition-all"
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
              background: timeFilter === key ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.03)',
              color: timeFilter === key ? '#fff' : 'rgba(255,255,255,0.3)',
              border: `1px solid ${timeFilter === key ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Notification List ── */}
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Bell size={22} color="rgba(255,255,255,0.2)" />
            </div>
            <p style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: '#fff', marginBottom: 6 }}>No notifications</p>
            <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.3)' }}>You're all caught up</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredNotifications.map((notif, i) => (
              <motion.button
                key={notif.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onMarkRead(notif.id)}
                className="w-full rounded-[18px] p-3.5 flex items-start gap-3 text-left"
                style={{
                  background: notif.read ? 'rgba(255,255,255,0.02)' : getNotifBg(notif.type),
                  border: `1px solid ${notif.read ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)'}`,
                }}
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {getNotifIcon(notif.type)}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p style={{ fontSize: 14, fontWeight: notif.read ? 500 : 700, color: '#fff', letterSpacing: '-0.01em' }}>
                      {notif.title}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {!notif.read && (
                        <div className="w-2 h-2 rounded-full" style={{ background: '#3b82f6' }} />
                      )}
                      <p style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.3)' }}>
                        {formatTimeAgo(notif.timestamp)}
                      </p>
                    </div>
                  </div>
                  <p style={{
                    fontSize: 13, fontWeight: 400,
                    color: notif.read ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.5)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {notif.message}
                  </p>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} notificationCount={unreadCount} />
    </div>
  );
};
