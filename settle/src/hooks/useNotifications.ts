"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { Notification } from "@/types/merchant";

export function useNotifications(merchantId: string | null, isLoggedIn: boolean) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const markNotificationRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  // Batched notification helper — coalesces rapid-fire events into one state update
  const notifQueueRef = useRef<Notification[]>([]);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addNotification = useCallback((type: Notification['type'], message: string, orderId?: string) => {
    notifQueueRef.current.push({
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      message,
      timestamp: Date.now(),
      read: false,
      orderId,
    });
    if (!notifTimerRef.current) {
      notifTimerRef.current = setTimeout(() => {
        const batch = notifQueueRef.current;
        notifQueueRef.current = [];
        notifTimerRef.current = null;
        if (batch.length > 0) {
          setNotifications(prev => [...batch.reverse(), ...prev].slice(0, 50));
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

      fetch(`/api/merchant/notifications?merchantId=${merchantId}&limit=50`)
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
            };
            const buildHistoryMsg = (n: any): string => {
              const amt = n.crypto_amount ? `${parseFloat(n.crypto_amount).toLocaleString()} USDC` : '';
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
            }));
            setNotifications(prev => [...prev, ...history]);
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
  };
}
