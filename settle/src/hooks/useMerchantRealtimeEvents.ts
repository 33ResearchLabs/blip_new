"use client";

import { useMerchantStore } from "@/stores/merchantStore";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import type { Order, Notification } from "@/types/merchant";

interface UseMerchantRealtimeEventsParams {
  debouncedFetchOrders: () => void;
  debouncedFetchConversations: () => void;
  refreshBalance: () => void;
  addNotification: (type: Notification['type'], message: string, orderId?: string) => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  toast: any;
  setExtensionRequests: (fn: (prev: Map<string, any>) => Map<string, any>) => void;
}

export function useMerchantRealtimeEvents({
  debouncedFetchOrders,
  debouncedFetchConversations,
  refreshBalance,
  addNotification,
  playSound,
  toast,
  setExtensionRequests,
}: UseMerchantRealtimeEventsParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const orders = useMerchantStore(s => s.orders);
  const setOrders = useMerchantStore(s => s.setOrders);

  useRealtimeOrders({
    actorType: 'merchant',
    actorId: merchantId,
    onOrderCreated: (order) => {
      debouncedFetchOrders();
      debouncedFetchConversations();
      const isRelevant = order?.merchant_id === merchantId || order?.buyer_merchant_id === merchantId;
      if (isRelevant) {
        playSound('new_order');
        const typeLabel = order?.type === 'buy' ? 'Send' : 'Receive';
        const amt = order?.crypto_amount ? `${Number(order.crypto_amount).toLocaleString()} USDC` : '';
        const fiat = order?.fiat_amount ? `${Number(order.fiat_amount).toLocaleString()} AED` : '';
        addNotification('order', order ? `New ${typeLabel} order · ${amt}${fiat ? ` → ${fiat}` : ''}` : 'New order received', order?.id);
        toast.showOrderCreated(order ? `${typeLabel} ${order.crypto_amount} USDC for ${order.fiat_amount} AED` : undefined);
      }
    },
    onOrderStatusUpdated: (orderId, newStatus, _previousStatus, extra?: { buyerMerchantId?: string; merchantId?: string }) => {
      if (newStatus === 'accepted' && extra?.buyerMerchantId) {
        setOrders((prev: Order[]) => prev.map(o => o.id === orderId ? { ...o, buyerMerchantId: extra.buyerMerchantId, minimalStatus: 'accepted' } : o));
      }
      debouncedFetchOrders();
      debouncedFetchConversations();
      const matchedOrder = orders.find(o => o.id === orderId);
      const isRelevantOrder = () => matchedOrder && (matchedOrder.orderMerchantId === merchantId || matchedOrder.buyerMerchantId === merchantId);
      const amt = matchedOrder ? `${matchedOrder.amount.toLocaleString()} USDC` : '';
      const usr = matchedOrder?.user || '';
      const desc = amt ? (usr ? `${amt} · ${usr}` : amt) : '';

      if (newStatus === 'payment_sent') {
        addNotification('payment', desc ? `Payment marked sent · ${desc}` : 'Payment sent for order', orderId);
        playSound('notification');
        toast.showPaymentSent(orderId);
      } else if (newStatus === 'escrowed') {
        addNotification('escrow', amt ? `Escrow locked · ${amt} secured` : 'Escrow locked on order', orderId);
        playSound('notification');
        toast.showEscrowLocked();
      } else if (newStatus === 'completed') {
        addNotification('complete', desc ? `Trade completed! ${desc}` : 'Trade completed!', orderId);
        playSound('order_complete');
        toast.showTradeComplete();
        refreshBalance();
      } else if (newStatus === 'disputed') {
        addNotification('dispute', desc ? `Dispute opened · ${desc}` : 'Dispute opened on order', orderId);
        playSound('error');
        toast.showDisputeOpened(orderId);
      } else if (newStatus === 'cancelled' && isRelevantOrder()) {
        addNotification('system', desc ? `Order cancelled · ${desc}` : 'Order cancelled', orderId);
        playSound('error');
        toast.showOrderCancelled();
      } else if (newStatus === 'expired' && isRelevantOrder()) {
        addNotification('system', amt ? `Order expired · ${amt} timed out` : 'Order expired', orderId);
        toast.showOrderExpired();
      } else if (newStatus === 'accepted' && isRelevantOrder() && matchedOrder?.isMyOrder) {
        addNotification('order', desc ? `Your order accepted · ${desc}` : 'Your order has been accepted!', orderId);
        playSound('notification');
        toast.show({ type: 'order', title: 'Order Accepted!', message: 'Someone accepted your order!' });
      } else if (newStatus === 'payment_confirmed') {
        addNotification('payment', amt ? `Payment confirmed · ${amt} · Ready to release` : 'Payment confirmed!', orderId);
        playSound('notification');
        toast.show({ type: 'payment', title: 'Payment Confirmed', message: 'Payment has been confirmed. Ready to release.' });
      }
    },
    onExtensionRequested: (data) => {
      if (data.requestedBy === 'user') {
        setExtensionRequests(prev => {
          const m = new Map(prev);
          m.set(data.orderId, {
            requestedBy: data.requestedBy,
            extensionMinutes: data.extensionMinutes,
            extensionCount: data.extensionCount,
            maxExtensions: data.maxExtensions,
          });
          return m;
        });
        addNotification('system', `User requested ${data.extensionMinutes}min extension`, data.orderId);
        playSound('notification');
        toast.showExtensionRequest('User', data.extensionMinutes);
      }
    },
    onExtensionResponse: (data) => {
      setExtensionRequests(prev => {
        const m = new Map(prev);
        m.delete(data.orderId);
        return m;
      });
      if (data.accepted) {
        addNotification('system', 'Extension accepted', data.orderId);
        debouncedFetchOrders();
        toast.show({ type: 'system', title: 'Extension Accepted', message: 'Time has been extended' });
      } else {
        addNotification('system', `Extension declined - order ${data.newStatus || 'updated'}`, data.orderId);
        debouncedFetchOrders();
        toast.showWarning('Extension request was declined');
      }
    },
    onPriceUpdate: (data) => {
      window.dispatchEvent(new CustomEvent("corridor-price-update", { detail: data }));
    },
    onNotification: (data) => {
      if (data.type === 'compliance_message') {
        addNotification('dispute', `📋 ${data.senderName}: ${data.content}`, data.orderId);
        playSound('notification');
        debouncedFetchOrders();
        // Dispatch event so page.tsx can open the order chat directly
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('open-order-chat', { detail: { orderId: data.orderId } }));
        }
      }
    },
  });
}
