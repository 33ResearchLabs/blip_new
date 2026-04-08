"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, Zap, Lock, DollarSign, AlertTriangle, CheckCircle2, MessageCircle, Shield, Activity } from "lucide-react";
import { BottomNav } from "./BottomNav";
import { FilterDropdown, type FilterOption } from "./ui";
import type { Screen } from "./types";

type TimeFilter = 'today' | '7d' | '30d' | 'all';

const TIME_FILTER_OPTIONS: ReadonlyArray<FilterOption<TimeFilter>> = [
  { key: 'today', label: 'Today' },
  { key: '7d',    label: '7 Days' },
  { key: '30d',   label: '30 Days' },
  { key: 'all',   label: 'All' },
];

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

// Icons use the semantic tokens (success / warning / error / info) plus the
// neutral text-text-secondary for "message" — no off-palette hexes.
function getNotifIcon(type: string) {
  switch (type) {
    case 'order':    return <Zap          size={16} className="text-warning" />;
    case 'escrow':   return <Lock         size={16} className="text-info" />;
    case 'payment':  return <DollarSign   size={16} className="text-success" />;
    case 'dispute':  return <AlertTriangle size={16} className="text-error" />;
    case 'complete': return <CheckCircle2 size={16} className="text-success" />;
    case 'message':  return <MessageCircle size={16} className="text-text-secondary" />;
    case 'warning':  return <AlertTriangle size={16} className="text-warning" />;
    case 'action':   return <Shield       size={16} className="text-warning" />;
    default:         return <Bell         size={16} className="text-text-tertiary" />;
  }
}

// Tinted card background per type, all from the semantic palette.
function getNotifBgClass(type: string) {
  switch (type) {
    case 'order':
    case 'warning':
    case 'action':   return 'bg-warning-dim';
    case 'escrow':   return 'bg-surface-card'; // info-dim not in palette → neutral
    case 'payment':
    case 'complete': return 'bg-success-dim';
    case 'dispute':  return 'bg-error-dim';
    case 'message':
    default:         return 'bg-surface-card';
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
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today');

  const filteredNotifications = (() => {
    if (timeFilter === 'all') return notifications;
    const now = Date.now();
    const cutoff = timeFilter === 'today' ? now - 86400000 : timeFilter === '7d' ? now - 7 * 86400000 : now - 30 * 86400000;
    return notifications.filter(n => n.timestamp >= cutoff);
  })();

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase mb-1">Updates</p>
            <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">Notifications</p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="px-3 py-1.5 rounded-full bg-surface-hover border border-border-subtle"
            >
              <span className="text-[11px] font-semibold text-text-secondary">Mark all read</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Tabs + Time Filter (single row) ── */}
      <div className="px-5 pb-2 flex items-center gap-2 shrink-0">
        <button
          onClick={() => setActiveTab('alerts')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all ${
            activeTab === 'alerts'
              ? 'bg-accent text-accent-text'
              : 'bg-surface-hover text-text-tertiary'
          }`}
        >
          <Bell size={13} strokeWidth={2.2} />
          <span className="text-[12px] font-bold">Alerts</span>
          {unreadCount > 0 && (
            <span className="text-[10px] font-extrabold min-w-4.5 text-center bg-error-dim text-error rounded-[10px] px-1.25 py-px">
              {unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={() => { setActiveTab('activity'); setScreen('orders'); }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full transition-all bg-surface-hover text-text-tertiary"
        >
          <Activity size={13} strokeWidth={2.2} />
          <span className="text-[12px] font-bold">Orders</span>
        </button>

        {/* Time filter — collapsed dropdown on the right */}
        <FilterDropdown
          className="ml-auto"
          ariaLabel="Time range filter"
          value={timeFilter}
          onChange={setTimeFilter}
          options={TIME_FILTER_OPTIONS}
        />
      </div>

      {/* ── Notification List ── */}
      <div className="flex-1 px-5 pt-2 pb-24 overflow-y-auto scrollbar-hide">
        {filteredNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4 bg-surface-card border border-border-subtle">
              <Bell size={22} className="text-text-quaternary" />
            </div>
            <p className="text-[18px] font-extrabold tracking-[-0.02em] text-text-primary mb-1.5">No notifications</p>
            <p className="text-[13px] font-medium text-text-tertiary">You&apos;re all caught up</p>
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
                className={`w-full rounded-[18px] p-3.5 flex items-start gap-3 text-left border ${
                  notif.read
                    ? 'bg-surface-card border-border-subtle'
                    : `${getNotifBgClass(notif.type)} border-border-medium`
                }`}
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 bg-surface-hover">
                  {getNotifIcon(notif.type)}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className={`text-[14px] tracking-[-0.01em] text-text-primary ${notif.read ? 'font-medium' : 'font-bold'}`}>
                      {notif.title}
                    </p>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {!notif.read && (
                        <div className="w-2 h-2 rounded-full bg-info" />
                      )}
                      <p className="text-[10px] font-medium text-text-tertiary">
                        {formatTimeAgo(notif.timestamp)}
                      </p>
                    </div>
                  </div>
                  <p className={`text-[13px] font-normal overflow-hidden text-ellipsis whitespace-nowrap ${
                    notif.read ? 'text-text-tertiary' : 'text-text-secondary'
                  }`}>
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
