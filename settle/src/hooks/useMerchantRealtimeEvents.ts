"use client";

import { useMerchantStore } from "@/stores/merchantStore";
import { useRealtimeOrders } from "@/hooks/useRealtimeOrders";
import type { Order, Notification } from "@/types/merchant";
import { stageMessage } from "@/lib/notifications/notificationCopy";
import { isDuplicateRealtimeEvent } from "@/lib/notifications/realtimeDedup";

interface UseMerchantRealtimeEventsParams {
  debouncedFetchOrders: () => void;
  refetchSingleOrder: (orderId: string) => Promise<void>;
  debouncedFetchConversations: () => void;
  refreshBalance: () => void;
  addNotification: (type: Notification['type'], message: string, orderId?: string, opts?: { sticky?: boolean; priority?: 'high' | 'normal'; status?: string }) => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  toast: any;
  setExtensionRequests: (fn: (prev: Map<string, any>) => Map<string, any>) => void;
  /** Clears any sticky warnings (e.g. expiry warning) when the trade settles */
  dismissStickyForOrder?: (orderId: string) => void;
}

export function useMerchantRealtimeEvents({
  debouncedFetchOrders,
  refetchSingleOrder,
  debouncedFetchConversations,
  refreshBalance,
  addNotification,
  playSound,
  toast,
  setExtensionRequests,
  dismissStickyForOrder,
}: UseMerchantRealtimeEventsParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const orders = useMerchantStore(s => s.orders);
  const setOrders = useMerchantStore(s => s.setOrders);

  useRealtimeOrders({
    actorType: 'merchant',
    actorId: merchantId,
    onOrderCreated: () => {
      // No notification — new orders appear in the Pending list directly
      debouncedFetchOrders();
      debouncedFetchConversations();
    },
    onOrderStatusUpdated: (orderId, newStatus, _previousStatus, extra?: { buyerMerchantId?: string; merchantId?: string }) => {
      // INLINE optimistic update — clears stale action buttons the instant the
      // Pusher event lands, so the button never lingers behind the toast.
      // The single-order refetch below replaces minimalStatus + primaryAction
      // with the authoritative server-derived values ~100-300ms later.
      setOrders((prev: Order[]) => prev.map(o => {
        if (o.id !== orderId) return o;
        const patch: Partial<Order> = { minimalStatus: newStatus as Order['minimalStatus'] };
        // Stale primary/secondary actions for the previous status are no longer
        // valid — wipe them so the user can't click an action that's already
        // been taken. enrichOrderResponse will repopulate on refetch.
        (patch as any).primaryAction = null;
        (patch as any).secondaryAction = null;
        if (newStatus === 'accepted' && extra?.buyerMerchantId) {
          (patch as any).buyerMerchantId = extra.buyerMerchantId;
        }
        return { ...o, ...patch };
      }));
      // Fast path: refetch single order for authoritative state
      refetchSingleOrder(orderId);
      // Full list refetch to ensure enrichOrderResponse recomputes actions (primaryAction etc.)
      debouncedFetchOrders();
      debouncedFetchConversations();
      const matchedOrder = orders.find(o => o.id === orderId);
      const isRelevantOrder = () => matchedOrder && (matchedOrder.orderMerchantId === merchantId || matchedOrder.buyerMerchantId === merchantId);
      const amt = matchedOrder ? `${matchedOrder.amount.toLocaleString()} USDT` : '';
      const usr = matchedOrder?.user || '';
      const desc = amt ? (usr ? `${amt} · ${usr}` : amt) : '';
      // Role-aware, concise panel copy. Falls back to the previous wording when
      // no milestone message applies (msg() returns the fallback unchanged).
      const role = matchedOrder?.my_role;
      const msg = (fallback: string) =>
        stageMessage(newStatus, role, { amount: amt || undefined, counterparty: usr || undefined }) ?? fallback;

      // Settled / advanced past the warning window — clear any sticky
      // expiry warning toast still on screen for this trade.
      if (
        dismissStickyForOrder &&
        ['completed', 'cancelled', 'expired', 'disputed', 'payment_sent', 'payment_confirmed'].includes(newStatus)
      ) {
        dismissStickyForOrder(orderId);
      }

      if (newStatus === 'payment_sent') {
        addNotification('payment', msg(desc ? `Payment marked sent · ${desc}` : 'Payment sent for order'), orderId, { status: newStatus });
        playSound('notification');
        toast.showPaymentSent(orderId);
      } else if (newStatus === 'escrowed') {
        addNotification('escrow', msg(amt ? `Escrow locked · ${amt} secured` : 'Escrow locked on order'), orderId, { status: newStatus });
        playSound('notification');
        toast.showEscrowLocked();
      } else if (newStatus === 'completed') {
        addNotification('complete', msg(desc ? `Trade completed! ${desc}` : 'Trade completed!'), orderId, { status: newStatus });
        playSound('order_complete');
        toast.showTradeComplete();
        refreshBalance();
      } else if (newStatus === 'disputed') {
        addNotification('dispute', msg(desc ? `Dispute opened · ${desc}` : 'Dispute opened on order'), orderId, { status: newStatus });
        playSound('error');
        toast.showDisputeOpened(orderId);
      } else if (newStatus === 'cancelled' && isRelevantOrder()) {
        addNotification('system', msg(desc ? `Order cancelled · ${desc}` : 'Order cancelled'), orderId, { status: newStatus });
        playSound('error');
        toast.showOrderCancelled();
      } else if (newStatus === 'expired' && isRelevantOrder()) {
        addNotification('system', msg(amt ? `Order expired · ${amt} timed out` : 'Order expired'), orderId, { status: newStatus });
        toast.showOrderExpired();
      } else if (newStatus === 'accepted' && isRelevantOrder() && matchedOrder?.isMyOrder) {
        addNotification('order', msg(desc ? `Your order accepted · ${desc}` : 'Your order has been accepted!'), orderId, { status: newStatus });
        playSound('notification');
        toast.show({ type: 'order', title: 'Order Accepted!', message: 'Someone accepted your order!' });
      } else if (newStatus === 'payment_confirmed') {
        addNotification('payment', msg(amt ? `Payment confirmed · ${amt} · Ready to release` : 'Payment confirmed!'), orderId, { status: newStatus });
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
    onExpiryWarning: (data) => {
      // Defense-in-depth: only surface the warning if this merchant is
      // actually a participant in the trade. The server already restricts
      // the event to per-participant channels, but we re-check here so a
      // misconfigured channel binding can't leak to the merchant pool.
      const matchedOrder = orders.find(o => o.id === data.orderId);
      if (!matchedOrder) return;
      const isParticipant =
        matchedOrder.orderMerchantId === merchantId ||
        matchedOrder.buyerMerchantId === merchantId;
      if (!isParticipant) return;

      const amt = matchedOrder.amount ? `${matchedOrder.amount.toLocaleString()} USDT` : '';
      const msg = data.message || 'Only 5 minutes remaining to complete this trade.';
      const desc = amt ? `${msg} (${amt})` : msg;
      addNotification('warning', desc, data.orderId, { sticky: true, priority: 'high' });
      playSound('error');
      // Sticky high-priority warning toast — must remain visible until the
      // user dismisses it or the trade transitions out of an active state.
      // The toast layer will keep the latest sticky warning per order in
      // the foreground; status-change handlers above clear it on
      // completed / cancelled / expired.
      if (typeof toast.showWarning === 'function') {
        toast.showWarning(desc, { sticky: true, priority: 'high', orderId: data.orderId });
      } else if (typeof toast.show === 'function') {
        toast.show({
          type: 'warning',
          title: '5 Minutes Remaining',
          message: desc,
          sticky: true,
          priority: 'high',
          orderId: data.orderId,
        });
      }
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
    // Inbox preview refresh on incoming chat messages, regardless of whether
    // the chat window is open. The user-side useRealtimeChat hook only
    // subscribes to a per-order channel when a chat window is OPEN, so
    // closed-window updates have to come through the merchant's private
    // channel binding inside useRealtimeOrders. Without this callback the
    // conversation list keeps showing the stale last message until a manual
    // refresh.
    onChatMessage: (data) => {
      // Skip our own outgoing messages — server publishes to recipient
      // channel only, but be defensive in case the contract changes.
      if (data.senderType === 'merchant' && data.senderId === merchantId) return;

      debouncedFetchConversations();

      // Dedup the alert across the two merchant chat transports (WebSocket
      // open-window path in market/page + this private-channel path) by message
      // id, so one message never produces two toasts. Data refresh above always
      // runs; only the alert is gated.
      if (isDuplicateRealtimeEvent('chat-toast-mrc', data.messageId)) return;

      // Light-weight notification so the merchant gets the same alert UX as
      // for status events. Falls back to a generic label if we can't find
      // the order in the local store yet.
      const order = orders.find(o => o.id === data.orderId);
      const userLabel = order?.user || (data.senderType === 'user' ? 'User' : 'Merchant');
      const preview = (data.content || '').substring(0, 80);
      addNotification('message', preview ? `${userLabel}: ${preview}` : `New message from ${userLabel}`, data.orderId);
      playSound('message');
      toast.showNewMessage?.(userLabel, preview);
    },
  });
}
