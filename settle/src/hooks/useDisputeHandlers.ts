"use client";

import { useState, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, Notification } from "@/types/merchant";
import type { SoundType } from "@/hooks/useSounds";
import { showToast } from "@/components/NotificationToast";

interface UseDisputeHandlersParams {
  solanaWallet: any;
  addNotification: (type: Notification['type'], message: string, orderId?: string) => void;
  playSound: (sound: SoundType) => void;
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
      const res = await fetch(`/api/orders/${disputeOrderId}/dispute`, {
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
        const errorData = await res.json().catch(() => ({}));
        const errDetail = errorData.error || `Server error (${res.status})`;
        showToast({ type: 'error', title: 'Dispute Failed', message: errDetail });
        addNotification('system', `Failed to submit dispute: ${errDetail}`, disputeOrderId);
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to submit dispute:', err);
      const errorMsg = err instanceof Error ? err.message : 'Network error — please check your connection.';
      showToast({ type: 'error', title: 'Dispute Failed', message: errorMsg });
      addNotification('system', `Failed to submit dispute: ${errorMsg}`, disputeOrderId || undefined);
      playSound('error');
    } finally {
      setIsSubmittingDispute(false);
    }
  };

  // ─── Fetch dispute info ───
  const fetchDisputeInfo = useCallback(async (orderId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/dispute`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setDisputeInfo(data.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch dispute info:', err);
    }
  }, []);

  // ─── Request extension ───
  const requestExtension = async (orderId: string) => {
    if (!merchantId) return;

    setRequestingExtension(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/extension`, {
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
        showToast({ type: 'success', title: 'Extension Requested', message: 'Extension request sent to the other party.' });
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
        const errDetail = data.error || 'Extension request denied by server';
        addNotification('system', errDetail, orderId);
        showToast({ type: 'error', title: 'Extension Failed', message: errDetail });
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to request extension:', err);
      const errorMsg = err instanceof Error ? err.message : 'Network error — please check your connection.';
      addNotification('system', `Failed to request extension: ${errorMsg}`, orderId);
      showToast({ type: 'error', title: 'Extension Failed', message: errorMsg });
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
      const res = await fetch(`/api/orders/${orderId}/extension`, {
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
          showToast({ type: 'success', title: 'Extension Accepted', message: 'Timer has been extended.' });
          playSound('click');
          fetchOrders();
        } else {
          addNotification('system', `Extension declined - order ${data.data?.status || 'updated'}`, orderId);
          showToast({ type: 'warning', title: 'Extension Declined', message: `Extension declined. Order ${data.data?.status || 'updated'}.` });
          playSound('error');
          fetchOrders();
        }
      } else {
        const errDetail = data.error || 'Failed to respond to extension';
        addNotification('system', errDetail, orderId);
        showToast({ type: 'error', title: 'Extension Response Failed', message: errDetail });
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to respond to extension:', err);
      const errorMsg = err instanceof Error ? err.message : 'Network error — please check your connection.';
      addNotification('system', `Failed to respond to extension: ${errorMsg}`, orderId);
      showToast({ type: 'error', title: 'Extension Response Failed', message: errorMsg });
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
      const res = await fetch(`/api/orders/${orderId}/dispute/confirm`, {
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
            addNotification('system', 'Dispute resolution finalized.', orderId);
            showToast({ type: 'success', title: 'Resolution Finalized', message: 'The dispute has been resolved.' });
            fetchOrders();
          } else {
            const msg = action === 'accept' ? 'You accepted the resolution. Waiting for the other party.' : 'You rejected the proposed resolution.';
            addNotification('system', msg, orderId);
            showToast({ type: action === 'accept' ? 'success' : 'warning', title: action === 'accept' ? 'Resolution Accepted' : 'Resolution Rejected', message: msg });
          }
          playSound('click');
        } else {
          const errDetail = data.error || 'Unexpected server response';
          addNotification('system', `Failed to respond: ${errDetail}`, orderId);
          showToast({ type: 'error', title: 'Response Failed', message: errDetail });
          playSound('error');
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        const errDetail = errorData.error || `Server error (${res.status})`;
        addNotification('system', `Failed to respond: ${errDetail}`, orderId);
        showToast({ type: 'error', title: 'Response Failed', message: errDetail });
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to respond to resolution:', err);
      const errorMsg = err instanceof Error ? err.message : 'Network error — please check your connection.';
      addNotification('system', `Failed to respond to resolution: ${errorMsg}`, orderId);
      showToast({ type: 'error', title: 'Response Failed', message: errorMsg });
      playSound('error');
    } finally {
      setIsRespondingToResolution(false);
    }
  };

  return {
    // State
    showDisputeModal, setShowDisputeModal,
    disputeOrderId, setDisputeOrderId,
    disputeReason, setDisputeReason,
    disputeDescription, setDisputeDescription,
    isSubmittingDispute,
    disputeInfo, setDisputeInfo,
    isRespondingToResolution,
    extensionRequests, setExtensionRequests,
    requestingExtension,

    // Actions
    openDisputeModal,
    submitDispute,
    fetchDisputeInfo,
    requestExtension,
    respondToExtension,
    respondToResolution,
  };
}
