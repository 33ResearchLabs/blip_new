"use client";

import { useState, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, Notification } from "@/types/merchant";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { fetchDisputeInfoFromApi } from '@/lib/api/disputeApi';

interface UseDisputeHandlersParams {
  solanaWallet: any;
  addNotification: (type: Notification['type'], message: string, orderId?: string) => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  toast: any;
  afterMutationReconcile: (orderId: string, optimisticUpdate?: Partial<Order>) => Promise<void>;
  fetchOrders: () => Promise<void>;
}

export function useDisputeHandlers({
  solanaWallet,
  addNotification,
  playSound,
  toast,
  afterMutationReconcile,
  fetchOrders,
}: UseDisputeHandlersParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const orders = useMerchantStore(s => s.orders);

  // ─── Dispute state ───
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeOrderId, setDisputeOrderId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeDescription, setDisputeDescription] = useState("");
  const [isSubmittingDispute, setIsSubmittingDispute] = useState(false);
  const [disputeInfo, setDisputeInfo] = useState<{
    id: string;
    status: string;
    reason: string;
    proposed_resolution?: string;
    resolution_notes?: string;
    user_confirmed?: boolean;
    merchant_confirmed?: boolean;
  } | null>(null);
  const [isRespondingToResolution, setIsRespondingToResolution] = useState(false);
  const [extensionRequests, setExtensionRequests] = useState<Map<string, {
    requestedBy: 'user' | 'merchant';
    extensionMinutes: number;
    extensionCount: number;
    maxExtensions: number;
  }>>(new Map());
  const [requestingExtension, setRequestingExtension] = useState<string | null>(null);

  // ─── Open dispute modal ───
  const openDisputeModal = (orderId: string) => {
    setDisputeOrderId(orderId);
    setShowDisputeModal(true);
  };

  // ─── Submit dispute ───
  const submitDispute = async () => {
    if (!disputeOrderId || !merchantId || !disputeReason) return;

    const order = orders.find(o => o.id === disputeOrderId);

    setIsSubmittingDispute(true);
    try {
      // If wallet connected and order has escrow, open dispute on-chain first
      if (solanaWallet.connected && order?.escrowTradeId && order?.escrowCreatorWallet) {
        try {
          const disputeResult = await solanaWallet.openDispute({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
          });

          if (disputeResult.success) {
            addNotification('system', `Dispute opened on-chain: ${disputeResult.txHash?.slice(0, 8)}...`, disputeOrderId);
          }
        } catch (chainError) {
          // Log but continue - the API dispute will still be recorded
        }
      }

      // Submit dispute to API
      const res = await fetchWithAuth(`/api/orders/${disputeOrderId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: disputeReason,
          description: disputeDescription,
          initiated_by: 'merchant',
          merchant_id: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setShowDisputeModal(false);
          const dOrderId = disputeOrderId;
          setDisputeOrderId(null);
          setDisputeReason("");
          setDisputeDescription("");
          playSound('click');
          toast.showDisputeOpened(dOrderId);
          addNotification('dispute', 'Dispute submitted. Our team will review it.', dOrderId);
          await afterMutationReconcile(dOrderId, { status: "disputed" as const });
        }
      } else {
        toast.showWarning('Failed to submit dispute. Please try again.');
      }
    } catch (err) {
      console.error('Failed to submit dispute:', err);
      playSound('error');
      toast.showWarning('Failed to submit dispute');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  // ─── Fetch dispute info ───
  const fetchDisputeInfo = useCallback(async (orderId: string) => {
    const data = await fetchDisputeInfoFromApi(orderId);
    if (data) setDisputeInfo(data);
  }, []);

  // ─── Request extension ───
  const requestExtension = async (orderId: string) => {
    if (!merchantId) return;

    setRequestingExtension(orderId);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/extension`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'merchant',
          actor_id: merchantId,
        }),
      });

      const data = await res.json();
      if (data.success) {
        addNotification('system', 'Extension request sent to user', orderId);
        playSound('click');
        setExtensionRequests(prev => {
          const newMap = new Map(prev);
          newMap.set(orderId, {
            requestedBy: 'merchant',
            extensionMinutes: data.data?.extension_minutes || 30,
            extensionCount: data.data?.extension_count || 0,
            maxExtensions: data.data?.max_extensions || 3,
          });
          return newMap;
        });
      } else {
        addNotification('system', data.error || 'Failed to request extension', orderId);
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to request extension:', err);
      addNotification('system', 'Failed to request extension', orderId);
      playSound('error');
    } finally {
      setRequestingExtension(null);
    }
  };

  // ─── Respond to extension request ───
  const respondToExtension = async (orderId: string, accept: boolean) => {
    if (!merchantId) return;

    setRequestingExtension(orderId);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/extension`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'merchant',
          actor_id: merchantId,
          accept,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setExtensionRequests(prev => {
          const newMap = new Map(prev);
          newMap.delete(orderId);
          return newMap;
        });

        if (accept) {
          addNotification('system', 'Extension accepted - time extended', orderId);
          playSound('click');
          fetchOrders();
        } else {
          addNotification('system', `Extension declined - order ${data.data?.status || 'updated'}`, orderId);
          playSound('error');
          fetchOrders();
        }
      } else {
        addNotification('system', data.error || 'Failed to respond to extension', orderId);
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to respond to extension:', err);
      playSound('error');
    } finally {
      setRequestingExtension(null);
    }
  };

  // ─── Respond to resolution proposal ───
  const respondToResolution = async (action: 'accept' | 'reject', orderId: string) => {
    if (!merchantId || !disputeInfo) return;

    setIsRespondingToResolution(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/dispute/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party: 'merchant',
          action,
          partyId: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          fetchDisputeInfo(orderId);
          if (data.data?.finalized) {
            fetchOrders();
          }
          playSound('click');
        }
      }
    } catch (err) {
      console.error('Failed to respond to resolution:', err);
      playSound('error');
    } finally {
      setIsRespondingToResolution(false);
    }
  };

  // ─── Cancel Request handlers ───
  const [isRequestingCancel, setIsRequestingCancel] = useState(false);

  const requestCancelOrder = useCallback(async (orderId: string) => {
    if (!merchantId) return;
    setIsRequestingCancel(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/cancel-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'merchant',
          actor_id: merchantId,
          reason: 'Merchant requested cancellation',
        }),
      });
      const data = await res.json();
      if (data.success) {
        playSound('click');
        addNotification('order', 'Cancel request sent to user', orderId);
        await afterMutationReconcile(orderId);
      } else {
        playSound('error');
        addNotification('system', data.error || 'Failed to request cancel', orderId);
      }
    } catch (err) {
      playSound('error');
      addNotification('system', 'Failed to request cancel', orderId);
    } finally {
      setIsRequestingCancel(false);
    }
  }, [merchantId, playSound, addNotification, afterMutationReconcile]);

  const respondToCancelRequest = useCallback(async (orderId: string, accept: boolean) => {
    if (!merchantId) return;
    setIsRequestingCancel(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/cancel-request`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor_type: 'merchant',
          actor_id: merchantId,
          accept,
        }),
      });
      const data = await res.json();
      if (data.success) {
        playSound(accept ? 'click' : 'notification');
        addNotification('order', accept ? 'Order cancelled by mutual agreement' : 'Cancel request declined', orderId);
        await afterMutationReconcile(orderId);
      } else {
        playSound('error');
        addNotification('system', data.error || 'Failed to respond to cancel', orderId);
      }
    } catch (err) {
      playSound('error');
      addNotification('system', 'Failed to respond to cancel', orderId);
    } finally {
      setIsRequestingCancel(false);
    }
  }, [merchantId, playSound, addNotification, afterMutationReconcile]);

  return {
    // State
    showDisputeModal,
    disputeOrderId,
    disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription,
    isSubmittingDispute,
    disputeInfo, setDisputeInfo,
    isRespondingToResolution,
    extensionRequests, setExtensionRequests,
    requestingExtension,
    isRequestingCancel,

    // Actions
    openDisputeModal,
    closeDisputeModal: () => setShowDisputeModal(false),
    submitDispute,
    fetchDisputeInfo,
    requestExtension,
    respondToExtension,
    respondToResolution,
    requestCancelOrder,
    respondToCancelRequest,
  };
}
