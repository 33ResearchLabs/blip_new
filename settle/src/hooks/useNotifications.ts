"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { Notification } from "@/types/merchant";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { milestoneDedupeKey, eventTypeToStatus } from '@/lib/notifications/notificationKey';

// Effective dedup identity for a panel notification: prefer the stable
// per-transition milestone key (collapses optimistic + realtime + history
// copies that are worded differently); otherwise fall back to the legacy
// content key so transient/non-lifecycle notifications keep their old behavior.
const notifDedupeKey = (n: Pick<Notification, 'orderId' | 'type' | 'message' | 'dedupeKey'>) =>
  n.dedupeKey ?? `${n.orderId || ''}|${n.type}|${n.message}`;

export function useNotifications(merchantId: string | null, isLoggedIn: boolean) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  // Bulk mark — used by the "Mark all read" affordance in the notifications
  // overlays. Skips the state update when nothing is unread to avoid an
  // unnecessary re-render.
  const markAllNotificationsRead = useCallback(() => {
    setNotifications(prev => {
      if (!prev.some(n => !n.read)) return prev;
      return prev.map(n => (n.read ? n : { ...n, read: true }));
    });
  }, []);

  // Drop sticky warnings (e.g. 5-min expiry) for a trade once it has settled.
  // Call from status-change handlers when a trade hits completed / cancelled /
  // expired / disputed so the warning toast doesn't linger after the work is
  // done.
  const dismissStickyForOrder = useCallback((orderId: string) => {
    setNotifications(prev => {
      if (!prev.some(n => n.orderId === orderId && n.sticky)) return prev;
      return prev.filter(n => !(n.orderId === orderId && n.sticky));
    });
  }, []);

  // Batched notification helper — coalesces rapid-fire events into one state update
  const notifQueueRef = useRef<Notification[]>([]);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addNotification = useCallback((
    type: Notification['type'],
    message: string,
    orderId?: string,
    opts?: { sticky?: boolean; priority?: 'high' | 'normal'; status?: string },
  ) => {
    notifQueueRef.current.push({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      message,
      timestamp: Date.now(),
      read: false,
      orderId,
      sticky: opts?.sticky,
      priority: opts?.priority,
      // Stable milestone key (when this is a lifecycle event) so the optimistic
      // and realtime copies of the same transition collapse despite different
      // wording. milestoneDedupeKey returns null for transient messages.
      dedupeKey: milestoneDedupeKey(orderId, opts?.status) ?? undefined,
    });
    if (!notifTimerRef.current) {
      notifTimerRef.current = setTimeout(() => {
        const batch = notifQueueRef.current;
        notifQueueRef.current = [];
        notifTimerRef.current = null;
        if (batch.length > 0) {
          setNotifications(prev => {
            // Dedupe within the batch + against existing. Lifecycle events use a
            // stable (orderId, milestone) key so optimistic + realtime copies of
            // the same transition collapse despite different wording; everything
            // else falls back to the (orderId, type, message) content key.
            const seenKeys = new Set(prev.map(notifDedupeKey));
            const fresh: Notification[] = [];
            for (const n of batch.reverse()) {
              const key = notifDedupeKey(n);
              if (seenKeys.has(key)) continue;
              seenKeys.add(key);
              fresh.push(n);
            }
            if (fresh.length === 0) return prev;
            return [...fresh, ...prev].slice(0, 50);
          });
        }
      }, 200);
    }
  }, []);

  // Load notification history from DB on login
  const hasShownWelcome = useRef(false);
  useEffect(() => {
    if (merchantId && isLoggedIn && !hasShownWelcome.current) {
      hasShownWelcome.current = true;
      addNotification('system', 'Welcome back! You are now online.');

      fetchWithAuth(`/api/merchant/notifications?merchantId=${merchantId}&limit=50`)
        .then(res => res.json())
        .then(data => {
          if (data.notifications?.length) {
            const eventTypeMap: Record<string, Notification['type']> = {
              ORDER_CREATED: 'order',
              ORDER_ACCEPTED: 'order',
              ORDER_ESCROWED: 'escrow',
              ORDER_PAYMENT_SENT: 'payment',
              ORDER_PAYMENT_CONFIRMED: 'payment',
              ORDER_COMPLETED: 'complete',
              ORDER_CANCELLED: 'system',
              ORDER_EXPIRED: 'system',
              ORDER_DISPUTED: 'dispute',
              APPEAL_OPENED: 'dispute',
              APPEAL_PROPOSED: 'dispute',
            };
            const buildHistoryMsg = (n: any): string => {
              const amt = n.crypto_amount ? `${parseFloat(n.crypto_amount).toLocaleString()} USDT` : '';
              const fiat = n.fiat_amount ? `${parseFloat(n.fiat_amount).toLocaleString()} AED` : '';
              const user = n.user_name || '';
              const typeLabel = n.order_type === 'buy' ? 'Sell' : 'Buy';
              switch (n.event_type) {
                case 'ORDER_CREATED': return `New ${typeLabel} order · ${amt}${fiat ? ` → ${fiat}` : ''}`;
                case 'ORDER_ACCEPTED': return `Order accepted · ${amt}${user ? ` · ${user}` : ''}`;
                case 'ORDER_ESCROWED': return `Escrow locked · ${amt} secured`;
                case 'ORDER_PAYMENT_SENT': return `Payment marked sent · ${amt}${user ? ` · ${user}` : ''}`;
                case 'ORDER_PAYMENT_CONFIRMED': return `Payment confirmed · ${amt} · Ready to release`;
                case 'ORDER_COMPLETED': return `Trade completed! ${amt}${fiat ? ` → ${fiat}` : ''}`;
                case 'ORDER_CANCELLED': return `Order cancelled · ${amt}${user ? ` · ${user}` : ''}`;
                case 'ORDER_EXPIRED': return `Order expired · ${amt} timed out`;
                case 'ORDER_DISPUTED': return `Dispute opened · ${amt}${user ? ` · ${user}` : ''}`;
                case 'APPEAL_OPENED': return `Appeal raised · ${amt}${user ? ` · ${user}` : ''}`;
                case 'APPEAL_PROPOSED': return `Resolution proposed · ${amt}${user ? ` · ${user}` : ''}`;
                default: return n.event_type;
              }
            };
            const history = data.notifications.map((n: any) => ({
              id: `db-${n.id}`,
              type: eventTypeMap[n.event_type] || 'system',
              message: buildHistoryMsg(n),
              timestamp: new Date(n.created_at).getTime(),
              read: true,
              orderId: n.order_id,
              // Same milestone key as the realtime/optimistic paths so a reload
              // doesn't append a duplicate card for an event already in the panel.
              dedupeKey: milestoneDedupeKey(n.order_id, eventTypeToStatus(n.event_type)) ?? undefined,
            }));
            // Dedupe by id (e.g. db-${n.id}) AND by milestone/content key so a
            // remount + history refetch can't append the same items twice, and a
            // real-time notification already in state for the same event won't
            // get a stale "read: true" copy appended either.
            setNotifications(prev => {
              const seenIds = new Set(prev.map(n => n.id));
              const seenKeys = new Set(prev.map(notifDedupeKey));
              const dedup = history.filter((n: Notification) => {
                if (seenIds.has(n.id)) return false;
                const key = notifDedupeKey(n);
                if (seenKeys.has(key)) return false;
                seenKeys.add(key);
                return true;
              });
              if (dedup.length === 0) return prev;
              return [...prev, ...dedup];
            });
          }
        })
        .catch(() => {});
    }
  }, [merchantId, isLoggedIn, addNotification]);

  return {
    notifications,
    setNotifications,
    addNotification,
    markNotificationRead,
    markAllNotificationsRead,
    dismissStickyForOrder,
  };
}
