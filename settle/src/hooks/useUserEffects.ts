"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Screen, Order, OrderStatus, DbOrder } from "@/components/user/screens/types";
import { mapDbStatusToUI, mapDbOrderToUI } from "@/components/user/screens/helpers";
import { usePusher } from "@/context/PusherContext";
import { useRealtimeChat } from "@/hooks/useRealtimeChat";
import { useRealtimeOrder } from "@/hooks/useRealtimeOrder";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { getUserChannel } from "@/lib/pusher/channels";
import { CHAT_EVENTS } from "@/lib/pusher/events";
import { emitChatToast } from "@/lib/chat/chatToastBus";

interface UseUserEffectsParams {
  userId: string | null;
  screen: Screen;
  setScreen: (s: Screen) => void;
  activeOrderId: string | null;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  pendingTradeData: { amount: string; fiatAmount: string; type: 'buy' | 'sell'; paymentMethod: 'bank' | 'cash' } | null;
  setPendingTradeData: (data: any) => void;
  escrowTxStatus: string;
  setEscrowTxStatus: (s: any) => void;
  setAmount: (a: string) => void;
  setSelectedOffer: (o: any) => void;
  solanaWallet: any;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  toast: any;
  setExtensionRequest: (req: any) => void;
}

export function useUserEffects({
  userId,
  screen,
  setScreen,
  activeOrderId,
  orders,
  setOrders,
  pendingTradeData,
  setPendingTradeData,
  escrowTxStatus,
  setEscrowTxStatus,
  setAmount,
  setSelectedOffer,
  solanaWallet,
  playSound,
  toast,
  setExtensionRequest,
}: UseUserEffectsParams) {
  const [matchingTimeLeft, setMatchingTimeLeft] = useState<number>(15 * 60);
  const [timerTick, setTimerTick] = useState(0);
  const [showAcceptancePopup, setShowAcceptancePopup] = useState(false);
  const [acceptedOrderInfo, setAcceptedOrderInfo] = useState<{
    merchantName: string;
    cryptoAmount: number;
    fiatAmount: number;
    orderType: 'buy' | 'sell';
  } | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [showChat, setShowChat] = useState(false);
  const [chatMessage, setChatMessage] = useState("");

  const { setActor } = usePusher();

  // Set actor when user ID is available
  useEffect(() => {
    if (userId) {
      setActor('user', userId);
    }
  }, [userId, setActor]);

  // Request notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, []);

  const showBrowserNotification = useCallback((title: string, body: string, orderId?: string) => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title, {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: orderId || 'chat-message',
      });
      notification.onclick = () => {
        window.focus();
        if (orderId) {
          // Note: these state setters aren't available here, but we pass orderId for the tag
        }
        notification.close();
      };
    }
  }, []);

  // Real-time chat hook
  const {
    chatWindows,
    openChat,
    sendMessage: sendChatMessage,
    sendTypingIndicator,
    markAsRead,
    refetchMessagesForOrder,
    loadOlderMessages,
    hasOlderMessages,
    isLoadingOlderMessages,
  } = useRealtimeChat({
    actorType: "user",
    actorId: userId || undefined,
    onNewMessage: (orderId, message) => {
      playSound('message');

      setOrders(prev => prev.map(o => {
        if (o.id === orderId && message.from === 'them') {
          return {
            ...o,
            unreadCount: (o.unreadCount || 0) + 1,
            lastMessage: {
              content: message.text,
              fromMerchant: true,
              createdAt: message.timestamp,
            },
          };
        }
        return o;
      }));

      if (message.from === 'them' && (screen !== 'order' || activeOrderId !== orderId)) {
        const order = orders.find(o => o.id === orderId);
        const merchantName = order?.merchant?.name || 'Merchant';
        toast.showNewMessage(merchantName, message.text?.substring(0, 80));
        showBrowserNotification(
          `New message from ${merchantName}`,
          message.text.substring(0, 100),
          orderId
        );
        // Emit to in-app chat toast stack (ChatToastHost subscribes).
        // No-op when no listener is mounted → zero regression.
        emitChatToast({
          orderId,
          senderName: merchantName,
          preview: (message.text || '').slice(0, 120),
          avatarUrl: order?.merchant?.avatarUrl ?? null,
          timestamp: Date.now(),
        });
      }
    },
  });

  // ── User private-channel chat listener ─────────────────────────────────
  // The order-channel subscription in useRealtimeChat only fires after the
  // user opens a chat window. Until then, merchant messages broadcast to
  // private-order-{id} are missed and only show up after refresh.
  // The bridge in /api/merchant/direct-messages also publishes the same
  // chat:message-new event to the user's private channel — listen there as
  // a safety net so the UI updates instantly regardless of subscription state.
  const pusherCtx = usePusher();
  const refetchMessagesForOrderRef = useRef(refetchMessagesForOrder);
  refetchMessagesForOrderRef.current = refetchMessagesForOrder;
  // Snapshot of chatWindows for the user-channel handler to consult — lets us
  // skip a redundant refetch when the order-channel listener has already
  // delivered the same message. Without this, the chat panel re-renders fully
  // (replaced messages array → all child components re-paint, scroll resets)
  // every time core-api pushes a chat:message-new (e.g. the receipt card).
  const chatWindowsRef = useRef(chatWindows);
  chatWindowsRef.current = chatWindows;
  useEffect(() => {
    if (!userId || !pusherCtx) return;
    const channelName = getUserChannel(userId);
    const channel = pusherCtx.subscribe(channelName);
    if (!channel) return;

    const seenIds = new Set<string>();
    const handler = (raw: unknown) => {
      const data = raw as {
        messageId?: string;
        orderId?: string;
        senderType?: string;
        senderId?: string | null;
        content?: string;
        messageType?: string;
        imageUrl?: string;
        createdAt?: string;
      };
      if (!data.messageId || !data.orderId) return;
      if (seenIds.has(data.messageId)) return;
      seenIds.add(data.messageId);
      // Bound the dedup set
      if (seenIds.size > 200) {
        const it = seenIds.values();
        for (let i = 0; i < 100; i++) it.next();
      }
      // Skip my own outgoing messages — server may publish to both channels.
      if (data.senderType === 'user' && data.senderId === userId) return;

      // Update the order's lastMessage + unread count in the inbox.
      setOrders(prev => prev.map(o => {
        if (o.id !== data.orderId) return o;
        return {
          ...o,
          unreadCount: (o.unreadCount || 0) + 1,
          lastMessage: {
            content: data.content || '',
            fromMerchant: data.senderType === 'merchant',
            createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
          },
        };
      }));

      // Force the open chat window (if any) to refetch its messages so the
      // newly-arrived merchant DM appears in the chat UI without a refresh.
      //
      // BUT: if the order-channel listener (useRealtimeChat.ts:648) has
      // already delivered this exact message, a refetch replaces the entire
      // messages array → causes a visible re-render of the whole chat panel
      // (scroll resets, all message rows update reference). We give the
      // order-channel listener a brief moment to land first, then refetch
      // only if the message is still missing.
      if (data.orderId) {
        const oid = data.orderId;
        const mid = data.messageId;
        setTimeout(() => {
          const win = chatWindowsRef.current?.find((w) => w.orderId === oid);
          if (win?.messages?.some((m) => m.id === mid)) {
            // Already delivered by order-channel handler — no refetch needed.
            return;
          }
          refetchMessagesForOrderRef.current?.(oid);
        }, 250);
      }
    };

    channel.bind(CHAT_EVENTS.MESSAGE_NEW, handler);
    return () => {
      channel.unbind(CHAT_EVENTS.MESSAGE_NEW, handler);
      pusherCtx.unsubscribe(channelName);
    };
  }, [userId, pusherCtx, setOrders]);

  // Real-time order updates for active order
  const { order: realtimeOrder, refetch: refetchActiveOrder } = useRealtimeOrder(activeOrderId, {
    onStatusChange: (newStatus, previousStatus, orderData) => {
      const wasPending = previousStatus === 'pending' || previousStatus === 'escrowed' || (!previousStatus && screen === 'matching');
      if (wasPending && (newStatus === 'accepted' || newStatus === 'escrowed')) {
        const merchantName = orderData?.merchant?.display_name || orderData?.merchant?.business_name || 'Merchant';
        playSound('notification');

        setAcceptedOrderInfo({
          merchantName,
          cryptoAmount: orderData?.crypto_amount || 0,
          fiatAmount: orderData?.fiat_amount || 0,
          orderType: orderData?.type || 'buy',
        });
        setShowAcceptancePopup(true);
        setTimeout(() => setShowAcceptancePopup(false), 5000);
        toast.showMerchantAccepted(merchantName);
        showBrowserNotification('Order Accepted!', `${merchantName} accepted your ${orderData?.type || 'buy'} order`, activeOrderId || undefined);

        if (screen === "matching") {
          setPendingTradeData(null);
        }
        if (screen !== "order") {
          setScreen("order");
        }
      }

      if (screen === "escrow" && escrowTxStatus === 'success' && newStatus === 'accepted') {
        setScreen("order");
        setEscrowTxStatus('idle');
        setAmount("");
        setSelectedOffer(null);
        playSound('notification');
        toast.showEscrowLocked();
      }

      if (newStatus === 'payment_sent') {
        if (screen !== 'order') {
          setScreen("order");
        }
        playSound('notification');
        toast.showPaymentSent();
        showBrowserNotification('Payment Sent', 'Your fiat payment has been marked as sent. Waiting for confirmation.', activeOrderId || undefined);
      }

      if (newStatus === 'payment_confirmed') {
        playSound('notification');
        toast.show({ type: 'payment', title: 'Payment Confirmed', message: 'Payment has been confirmed!' });
      }

      if (newStatus === 'releasing') {
        toast.showEscrowReleased();
      }

      if (newStatus === 'completed') {
        playSound('trade_complete');
        toast.showTradeComplete();
        showBrowserNotification('Trade Complete!', 'Your trade has been completed successfully.', activeOrderId || undefined);
        if (solanaWallet.connected) {
          solanaWallet.refreshBalances();
        }
        // Pull the user off any pre-completion intermediate screen so the
        // stale "Escrow Locked / Waiting for merchant" UI doesn't keep showing.
        if (screen === 'escrow' || screen === 'matching') {
          setScreen('order');
        }
      }

      if (newStatus === 'disputed') {
        playSound('error');
        toast.showDisputeOpened();
        showBrowserNotification('Dispute Opened', 'A dispute has been raised on your order.', activeOrderId || undefined);
        if (screen === 'escrow' || screen === 'matching') {
          setScreen('order');
        }
      }

      if (newStatus === 'cancelled') {
        playSound('error');
        toast.showOrderCancelled();
        if (screen === 'escrow' || screen === 'matching') {
          setScreen('order');
        }
      }

      if (newStatus === 'expired') {
        toast.showOrderExpired();
        if (screen === 'escrow' || screen === 'matching') {
          setScreen('order');
        }
      }

      if (activeOrderId) {
        setOrders(prev => prev.map(o => {
          if (o.id === activeOrderId) {
            const { status, step } = mapDbStatusToUI(newStatus);
            return { ...o, status, step, dbStatus: newStatus };
          }
          return o;
        }));
      }

      if (newStatus === 'escrowed') {
        console.log('[User] Escrow locked - refetching order data');
        refetchActiveOrder();

        if (solanaWallet.connected && orderData) {
          const escrowCreatorWallet = (orderData as any).escrow_creator_wallet;
          const escrowTradeId = (orderData as any).escrow_trade_id;
          if (escrowCreatorWallet && escrowTradeId) {
            console.log('[User] Auto-calling acceptTrade on-chain:', { escrowCreatorWallet, escrowTradeId });
            solanaWallet.acceptTrade({
              creatorPubkey: escrowCreatorWallet,
              tradeId: Number(escrowTradeId),
            }).then((result: any) => {
              if (result.success) {
                console.log('[User] acceptTrade success:', result.txHash);
              } else {
                console.warn('[User] acceptTrade failed:', result.error);
              }
            }).catch((err: any) => {
              console.warn('[User] acceptTrade error (may already be accepted):', err.message);
            });
          }
        }
      }
    },
    onExtensionRequested: (data) => {
      if (data.requestedBy === 'merchant') {
        setExtensionRequest({
          orderId: data.orderId,
          requestedBy: data.requestedBy,
          extensionMinutes: data.extensionMinutes,
          extensionCount: data.extensionCount,
          maxExtensions: data.maxExtensions,
        });
        playSound('notification');
        toast.showExtensionRequest('Merchant', data.extensionMinutes);
        showBrowserNotification('Extension Requested', `Merchant requested ${data.extensionMinutes} more minutes`);
      }
    },
    onExtensionResponse: (data) => {
      setExtensionRequest(null);
      if (data.accepted) {
        playSound('click');
        toast.show({ type: 'system', title: 'Extension Accepted', message: 'Time has been extended' });
      } else {
        playSound('error');
        toast.showWarning('Extension request was declined');
      }
    },
  });

  // Detect merchant claiming a sell order (status stays 'escrowed' but merchant_id gets set).
  // When this happens on the escrow/matching screen, transition to order detail.
  const prevMerchantIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!realtimeOrder || !activeOrderId) return;
    const merchantId = (realtimeOrder as any).merchant_id || null;
    const prevMerchantId = prevMerchantIdRef.current;
    prevMerchantIdRef.current = merchantId;

    // Merchant just got assigned (claim transition on sell order)
    if (merchantId && !prevMerchantId && (screen === 'escrow' || screen === 'matching')) {
      const merchantName = (realtimeOrder as any).merchant?.display_name || 'Merchant';
      playSound('notification');
      toast.showMerchantAccepted(merchantName);
      setAcceptedOrderInfo({
        merchantName,
        cryptoAmount: (realtimeOrder as any).crypto_amount || 0,
        fiatAmount: (realtimeOrder as any).fiat_amount || 0,
        orderType: (realtimeOrder as any).type || 'sell',
      });
      setShowAcceptancePopup(true);
      setTimeout(() => setShowAcceptancePopup(false), 5000);
      if (screen === 'matching') setPendingTradeData(null);
      setScreen('order');
    }
  }, [realtimeOrder, activeOrderId, screen]);

  // Active order: merge real-time data with list data, preserving optimistic updates
  const orderFromList = orders.find(o => o.id === activeOrderId);
  // Wrap mapper in try/catch — defensive against malformed realtime data
  let mappedRealtimeOrder: Order | null = null;
  if (realtimeOrder) {
    try {
      mappedRealtimeOrder = mapDbOrderToUI(realtimeOrder as unknown as DbOrder);
    } catch (err) {
      console.error('[useUserEffects] mapDbOrderToUI failed:', err);
      mappedRealtimeOrder = null;
    }
  }
  const activeOrder = mappedRealtimeOrder
    ? {
        ...orderFromList,
        ...mappedRealtimeOrder,
        // Preserve cancelRequest from list if realtime doesn't have it yet (optimistic update)
        cancelRequest: mappedRealtimeOrder.cancelRequest ?? orderFromList?.cancelRequest ?? null,
        // Preserve userRating from list (set by optimistic update after submitRating)
        userRating: orderFromList?.userRating ?? mappedRealtimeOrder.userRating ?? null,
        // Preserve unreadCount — single-order fetch may omit it; list / realtime increments are authoritative
        unreadCount: Math.max(orderFromList?.unreadCount ?? 0, mappedRealtimeOrder.unreadCount ?? 0),
      }
    : orderFromList;

  // Recovery: if on order screen but activeOrder is missing, refetch
  useEffect(() => {
    if (screen === 'order' && !activeOrder && activeOrderId) {
      refetchActiveOrder();
    }
  }, [screen, activeOrder, activeOrderId, refetchActiveOrder]);

  // Auto-accept trade on-chain when viewing an escrowed order (safety net)
  const acceptTradeCalledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeOrder || !solanaWallet.connected) return;
    const dbStatus = activeOrder.dbStatus || activeOrder.status;
    if (activeOrder.type !== 'buy') return;
    if (!['escrowed', 'payment_sent', 'payment_confirmed'].includes(dbStatus)) return;
    if (!activeOrder.escrowCreatorWallet || !activeOrder.escrowTradeId) return;
    if (acceptTradeCalledRef.current.has(activeOrder.id)) return;

    acceptTradeCalledRef.current.add(activeOrder.id);
    console.log('[User] Safety net: calling acceptTrade for escrowed order', activeOrder.id);
    solanaWallet.acceptTrade({
      creatorPubkey: activeOrder.escrowCreatorWallet,
      tradeId: Number(activeOrder.escrowTradeId),
    }).then((result: any) => {
      if (result.success) {
        console.log('[User] acceptTrade success (safety net):', result.txHash);
      }
    }).catch((err: any) => {
      console.log('[User] acceptTrade skipped (likely already accepted):', err.message);
    });
  }, [activeOrder?.id, activeOrder?.dbStatus, activeOrder?.escrowCreatorWallet, solanaWallet.connected]);

  // Countdown timer for matching screen
  useEffect(() => {
    if (screen !== "matching" || !pendingTradeData || !activeOrderId) {
      return;
    }

    const currentOrder = orders.find(o => o.id === activeOrderId);
    if (!currentOrder?.expiresAt) {
      return;
    }

    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const expiresAt = currentOrder.expiresAt.getTime();
      return Math.max(0, Math.floor((expiresAt - now) / 1000));
    };

    setMatchingTimeLeft(calculateTimeLeft());

    const interval = setInterval(() => {
      const timeLeft = calculateTimeLeft();
      setMatchingTimeLeft(timeLeft);

      if (timeLeft <= 0) {
        clearInterval(interval);
        // Mark the order as expired locally — server-side expiration is handled
        // by the cron worker (settle/api/orders/expire). We do NOT call PATCH
        // with actor_type='system' from the client (forbidden per CLAUDE.md).
        setOrders(prev => prev.map(o =>
          o.id === activeOrderId
            ? { ...o, status: 'expired' as OrderStatus, dbStatus: 'expired' }
            : o
        ));
        setPendingTradeData(null);
        setScreen("home");
        playSound('error');
        toast.showOrderExpired();
        showBrowserNotification('Order Expired', 'No merchant accepted your order in time. Please try again.');
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [screen, pendingTradeData, activeOrderId, orders, playSound]);

  // Timer tick for orders list countdown display
  useEffect(() => {
    const hasPendingOrders = orders.some(o => o.dbStatus === 'pending');
    if (!hasPendingOrders) return;

    const interval = setInterval(() => {
      setTimerTick(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [orders]);

  const formatTimeLeft = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Open chat when showChat is toggled or when entering chat-view screen
  const handleOpenChat = useCallback(() => {
    if (activeOrder) {
      openChat(
        activeOrder.merchant.name,
        "\uD83C\uDFEA",
        activeOrder.id
      );
      // Clear the inbox-level unread count locally — markAsRead (fired by the
      // auto-subscribe effect below) persists is_read=true on the server, but
      // orders[].unreadCount is a client-side counter that must be cleared here
      // or the Chat button badge stays pinned after the user reads the thread.
      setOrders(prev => prev.map(o =>
        o.id === activeOrder.id ? { ...o, unreadCount: 0 } : o
      ));
    }
    setShowChat(true);
  }, [activeOrder, openChat, setOrders]);

  // Auto-open chat when entering chat-view screen
  // Use refs to avoid re-firing when callback references change
  const chatWindowsRef2 = useRef(chatWindows);
  chatWindowsRef2.current = chatWindows;
  const markAsReadRef = useRef(markAsRead);
  markAsReadRef.current = markAsRead;
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;
  const activeOrderRef = useRef(activeOrder);
  activeOrderRef.current = activeOrder;
  const prevChatViewOrderRef = useRef<string | null>(null);
  useEffect(() => {
    const order = activeOrderRef.current;
    // Auto-subscribe to the order's chat channel whenever the user is on the
    // order screen OR the dedicated chat-view screen. Without this, the user
    // never subscribes to private-order-{id} until they explicitly click the
    // chat button — and any merchant message that arrives in the meantime
    // only shows up on refresh (when GET /messages re-fetches the inserted row).
    const shouldSubscribe = (screen === "chat-view" || screen === "order") && !!order;
    if (shouldSubscribe && order.id !== prevChatViewOrderRef.current) {
      prevChatViewOrderRef.current = order.id;
      openChatRef.current(
        order.merchant?.name || 'Merchant',
        "\uD83C\uDFEA",
        order.id
      );
      // Mark merchant's messages as read once when user enters chat
      setTimeout(() => {
        const chat = chatWindowsRef2.current.find(w => w.orderId === order.id);
        if (chat) markAsReadRef.current(chat.id);
      }, 500);
      // Also clear the inbox unread counter for this order so the Chat-button
      // badge disappears as soon as the user is looking at the thread.
      setOrders(prev => prev.map(o =>
        o.id === order.id ? { ...o, unreadCount: 0 } : o
      ));
    }
    if (!shouldSubscribe) {
      prevChatViewOrderRef.current = null;
    }
  }, [screen, activeOrder?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom when chat messages change
  const activeChat = activeOrder ? chatWindows.find(w => w.orderId === activeOrder.id) : null;

  useEffect(() => {
    if ((showChat || screen === "chat-view") && chatMessagesRef.current) {
      // Use requestAnimationFrame to ensure DOM has painted before scrolling
      requestAnimationFrame(() => {
        if (chatMessagesRef.current) {
          chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
        }
      });
    }
  }, [showChat, screen, activeChat?.messages?.length]);

  const handleSendMessage = useCallback(() => {
    if (!activeChat || !chatMessage.trim()) return;
    sendChatMessage(activeChat.id, chatMessage);
    // Update lastMessage on the order for chat list preview
    if (activeOrderId) {
      setOrders(prev => prev.map(o => {
        if (o.id === activeOrderId) {
          return {
            ...o,
            lastMessage: {
              content: chatMessage.trim(),
              fromMerchant: false,
              createdAt: new Date(),
            },
          };
        }
        return o;
      }));
    }
    setChatMessage("");
    playSound('send');
    // Scroll to bottom after sending
    requestAnimationFrame(() => {
      if (chatMessagesRef.current) {
        chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
      }
    });
  }, [activeChat, chatMessage, sendChatMessage, playSound, activeOrderId, setOrders]);

  // Debug logging for chat issues (disabled — was causing re-render spam via chatWindows dep)
  // To re-enable, use a ref-based approach instead of chatWindows in deps

  return {
    matchingTimeLeft,
    timerTick,
    formatTimeLeft,
    activeOrder,
    realtimeOrder,
    refetchActiveOrder,
    showBrowserNotification,
    // Chat
    chatWindows,
    openChat,
    sendChatMessage,
    sendTypingIndicator,
    activeChat: activeChat ?? null,
    showChat, setShowChat,
    chatMessage, setChatMessage,
    chatMessagesRef,
    chatInputRef,
    handleOpenChat,
    handleSendMessage,
    // Pagination
    loadOlderMessages,
    hasOlderMessages,
    isLoadingOlderMessages,
    // Acceptance popup
    showAcceptancePopup, setShowAcceptancePopup,
    acceptedOrderInfo,
  };
}
