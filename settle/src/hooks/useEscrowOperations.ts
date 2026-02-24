"use client";

import { useState, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, DbOrder } from "@/types/merchant";
import { mapDbOrderToUI } from "@/lib/orders/mappers";
import { computeMyRole } from "@/lib/orders/statusResolver";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

interface UseEscrowOperationsParams {
  isMockMode: boolean;
  solanaWallet: any;
  effectiveBalance: number | null;
  inAppBalance: number | null;
  addNotification: (type: string, message: string, orderId?: string) => void;
  playSound: (sound: string) => void;
  afterMutationReconcile: (orderId: string, optimisticUpdate?: Partial<Order>) => Promise<void>;
  fetchOrders: () => Promise<void>;
  refreshBalance: () => void;
  setShowWalletModal: (show: boolean) => void;
  setRatingModalData: (data: { orderId: string; counterpartyName: string; counterpartyType: 'user' | 'merchant' } | null) => void;
}

export function useEscrowOperations({
  isMockMode,
  solanaWallet,
  effectiveBalance,
  inAppBalance,
  addNotification,
  playSound,
  afterMutationReconcile,
  fetchOrders,
  refreshBalance,
  setShowWalletModal,
  setRatingModalData,
}: UseEscrowOperationsParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const setOrders = useMerchantStore(s => s.setOrders);

  // ─── Escrow lock state ───
  const [showEscrowModal, setShowEscrowModal] = useState(false);
  const [escrowOrder, setEscrowOrder] = useState<Order | null>(null);
  const [isLockingEscrow, setIsLockingEscrow] = useState(false);
  const [escrowTxHash, setEscrowTxHash] = useState<string | null>(null);
  const [escrowError, setEscrowError] = useState<string | null>(null);

  // ─── Escrow release state ───
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [releaseOrder, setReleaseOrder] = useState<Order | null>(null);
  const [isReleasingEscrow, setIsReleasingEscrow] = useState(false);
  const [releaseTxHash, setReleaseTxHash] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  // ─── Escrow cancel state ───
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelOrder, setCancelOrder] = useState<Order | null>(null);
  const [isCancellingEscrow, setIsCancellingEscrow] = useState(false);
  const [cancelTxHash, setCancelTxHash] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // ═══════════════════════════════════════════════════════════════════
  // ESCROW LOCK
  // ═══════════════════════════════════════════════════════════════════

  const openEscrowModal = useCallback(async (order: Order) => {
    if (!merchantId) return;

    const role = order.myRole || computeMyRole(order, merchantId);
    if (role !== 'seller') {
      addNotification('system', 'Only the seller locks escrow in this trade.');
      return;
    }

    if (!isMockMode && !solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to lock escrow.');
      setShowWalletModal(true);
      return;
    }

    let orderToUse = order;
    try {
      const res = await fetch(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          orderToUse = mapDbOrderToUI(data.data, merchantId);
        }
      }
    } catch (err) {
      console.error('[Escrow] Error fetching fresh order:', err);
    }

    setEscrowOrder(orderToUse);
    setEscrowTxHash(null);
    setEscrowError(null);
    setIsLockingEscrow(false);
    setShowEscrowModal(true);
  }, [merchantId, isMockMode, solanaWallet.connected, addNotification, setShowWalletModal]);

  const executeLockEscrow = useCallback(async () => {
    if (!merchantId || !escrowOrder) return;

    if (effectiveBalance !== null && effectiveBalance < escrowOrder.amount) {
      setEscrowError(`Insufficient USDC balance. You need ${escrowOrder.amount} USDC but have ${effectiveBalance.toFixed(2)} USDC.`);
      return;
    }

    if (effectiveBalance === null) {
      await refreshBalance();
      await new Promise(r => setTimeout(r, 500));
      const newBalance = isMockMode ? inAppBalance : solanaWallet.usdtBalance;
      if (newBalance !== null && newBalance < escrowOrder.amount) {
        setEscrowError(`Insufficient USDC balance. You need ${escrowOrder.amount} USDC but have ${newBalance.toFixed(2)} USDC.`);
        return;
      }
    }

    const validWalletRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const isValidWallet = (addr: string | undefined | null): boolean => {
      if (!addr) return false;
      return isMockMode ? addr.length > 0 : validWalletRegex.test(addr);
    };
    const myWallet = solanaWallet.walletAddress;

    const hasAcceptorWallet = isValidWallet(escrowOrder.acceptorWallet);
    const hasUserWallet = isValidWallet(escrowOrder.userWallet);
    const iAmOrderCreator = escrowOrder.orderMerchantId === merchantId;
    const isPendingOrEscrowed = escrowOrder.dbOrder?.status === 'pending' || escrowOrder.dbOrder?.status === 'escrowed';
    const isMyOrder = escrowOrder.isMyOrder || (isPendingOrEscrowed && iAmOrderCreator);
    const isMyPendingSellOrder = isMyOrder && escrowOrder.dbOrder?.status === 'pending';
    const isMyOrderNoAcceptorWallet = isMyOrder && !hasAcceptorWallet && !hasUserWallet;
    const isMerchantInitiated = isMyOrder && !hasUserWallet;
    const isMerchantTrade = escrowOrder.isM2M || !!escrowOrder.buyerMerchantWallet || hasAcceptorWallet || isMerchantInitiated;
    const iAmCreator = isMyOrder || (myWallet && escrowOrder.buyerMerchantWallet === myWallet);

    let recipientWallet: string | undefined = undefined;
    const canEscrowToTreasury = isMyPendingSellOrder || isMyOrderNoAcceptorWallet;

    if (canEscrowToTreasury) {
      recipientWallet = undefined;
    } else if (isMerchantTrade) {
      if (iAmCreator) {
        recipientWallet = isValidWallet(escrowOrder.acceptorWallet) ? escrowOrder.acceptorWallet! : undefined;
      } else {
        recipientWallet = isValidWallet(escrowOrder.buyerMerchantWallet) ? escrowOrder.buyerMerchantWallet! : undefined;
      }
    } else {
      recipientWallet = isValidWallet(escrowOrder.userWallet) ? escrowOrder.userWallet! : undefined;
    }

    if (!recipientWallet && !canEscrowToTreasury && !isMockMode && !IS_EMBEDDED_WALLET) {
      setEscrowError(isMerchantTrade
        ? 'The other merchant has not connected their Solana wallet yet.'
        : 'User has not connected their Solana wallet yet. Ask them to connect their wallet in the app first.');
      return;
    }

    setIsLockingEscrow(true);
    setEscrowError(null);

    try {
      let escrowResult: { success: boolean; txHash: string; tradeId?: number; tradePda?: string; escrowPda?: string; error?: string };

      if (isMockMode) {
        const mockTxHash = `mock-escrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        escrowResult = { success: true, txHash: mockTxHash, tradeId: undefined, tradePda: undefined, escrowPda: undefined };
      } else {
        escrowResult = await solanaWallet.depositToEscrowOpen({
          amount: escrowOrder.amount,
          side: 'sell',
        });
      }

      if (!escrowResult.success || !escrowResult.txHash) {
        throw new Error(escrowResult.error || 'Transaction failed');
      }

      setEscrowTxHash(escrowResult.txHash);
      setShowEscrowModal(false);

      setOrders((prev: Order[]) => prev.map((o: Order) => o.id === escrowOrder.id ? {
        ...o,
        status: "escrow" as const,
        escrowTxHash: escrowResult.txHash,
        escrowTradeId: escrowResult.tradeId,
        escrowTradePda: escrowResult.tradePda,
        escrowCreatorWallet: solanaWallet.walletAddress,
      } : o));

      const pendingSellOrder = (window as any).__pendingSellOrder;
      const isTempOrder = escrowOrder.id.startsWith('temp-');

      if (pendingSellOrder && isTempOrder) {
        playSound('trade_complete');
        try {
          const res = await fetch("/api/merchant/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              merchant_id: pendingSellOrder.merchantId,
              type: pendingSellOrder.tradeType,
              crypto_amount: pendingSellOrder.cryptoAmount,
              payment_method: pendingSellOrder.paymentMethod,
              spread_preference: pendingSellOrder.spreadPreference,
              priority_fee: pendingSellOrder.priorityFee || 0,
              matched_offer_id: pendingSellOrder.matchedOfferId,
              escrow_tx_hash: escrowResult.txHash,
              escrow_trade_id: escrowResult.tradeId,
              escrow_trade_pda: escrowResult.tradePda,
              escrow_pda: escrowResult.escrowPda,
              escrow_creator_wallet: solanaWallet.walletAddress,
            }),
          });

          const data = await res.json();
          if (res.ok && data.success && data.data) {
            const newOrder = mapDbOrderToUI(data.data, merchantId);
            setOrders((prev: Order[]) => [newOrder, ...prev]);
            addNotification('escrow', `Sell order created! ${escrowOrder.amount} USDC locked in escrow`, data.data.id);
            delete (window as any).__pendingSellOrder;
            setShowEscrowModal(false);
            setEscrowOrder(null);
            setEscrowTxHash(null);
            setEscrowError(null);
          } else {
            const errorMsg = data.error || data.validation_errors?.[0] || 'Unknown error';
            addNotification('system', `Escrow locked but order creation failed: ${errorMsg}`, escrowOrder.id);
          }
        } catch (createError) {
          const errorMsg = createError instanceof Error ? createError.message : 'Network error';
          addNotification('system', `Escrow locked but order creation failed: ${errorMsg}`, escrowOrder.id);
        }
        refreshBalance();
      } else {
        const escrowPayload: Record<string, unknown> = {
          tx_hash: escrowResult.txHash,
          actor_type: "merchant",
          actor_id: merchantId,
        };
        if (escrowResult.escrowPda) escrowPayload.escrow_address = escrowResult.escrowPda;
        if (escrowResult.tradeId != null) escrowPayload.escrow_trade_id = escrowResult.tradeId;
        if (escrowResult.tradePda) escrowPayload.escrow_trade_pda = escrowResult.tradePda;
        if (escrowResult.escrowPda) escrowPayload.escrow_pda = escrowResult.escrowPda;
        if (solanaWallet.walletAddress) escrowPayload.escrow_creator_wallet = solanaWallet.walletAddress;

        let recorded = false;
        for (let attempt = 0; attempt < 3 && !recorded; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
          try {
            const res = await fetch(`/api/orders/${escrowOrder.id}/escrow`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(escrowPayload),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.success) recorded = true;
            }
          } catch (err) {
            console.error(`[Merchant] Escrow record attempt ${attempt + 1} failed:`, err);
          }
        }

        if (recorded) {
          playSound('trade_complete');
          addNotification('escrow', `${escrowOrder.amount} USDC locked in escrow - waiting for payment`, escrowOrder.id);
          setShowEscrowModal(false);
          setEscrowOrder(null);
          setEscrowTxHash(null);
          setEscrowError(null);
          try { localStorage.removeItem(`blip_unrecorded_escrow_${escrowOrder.id}`); } catch {}
          await afterMutationReconcile(escrowOrder.id);
        } else {
          addNotification('system', 'Escrow locked on-chain but server sync failed. It will sync automatically.', escrowOrder.id);
          try {
            localStorage.setItem(`blip_unrecorded_escrow_${escrowOrder.id}`, JSON.stringify({
              orderId: escrowOrder.id,
              txHash: escrowResult.txHash,
              tradeId: escrowResult.tradeId,
              tradePda: escrowResult.tradePda,
              escrowPda: escrowResult.escrowPda,
              creatorWallet: solanaWallet.walletAddress,
              timestamp: Date.now(),
            }));
          } catch {}
        }
        refreshBalance();
      }
      setIsLockingEscrow(false);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('block height exceeded') || errorMsg.includes('has expired')) {
        setEscrowError('Transaction expired. Please approve the wallet popup faster (within 60 seconds). Try again.');
      } else {
        setEscrowError(errorMsg || 'Failed to lock escrow. Please try again.');
      }
      setIsLockingEscrow(false);
      playSound('error');
    }
  }, [merchantId, escrowOrder, effectiveBalance, inAppBalance, isMockMode, solanaWallet, addNotification, playSound, afterMutationReconcile, refreshBalance]);

  const closeEscrowModal = useCallback(() => {
    setShowEscrowModal(false);
    setEscrowOrder(null);
    setEscrowTxHash(null);
    setEscrowError(null);
    setIsLockingEscrow(false);
    fetchOrders();
  }, [fetchOrders]);

  // ═══════════════════════════════════════════════════════════════════
  // ESCROW RELEASE
  // ═══════════════════════════════════════════════════════════════════

  const openReleaseModal = useCallback(async (order: Order) => {
    if (!merchantId) return;

    if (!isMockMode && !solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to release escrow.');
      setShowWalletModal(true);
      return;
    }

    try {
      const res = await fetch(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          const freshOrder = mapDbOrderToUI(data.data, merchantId);
          if (freshOrder.status === 'completed' || freshOrder.status === 'cancelled' || freshOrder.status === 'expired') {
            addNotification('system', `Order already ${freshOrder.status}. Refreshing...`, order.id);
            setOrders((prev: Order[]) => prev.map((o: Order) => o.id === order.id ? freshOrder : o));
            fetchOrders();
            return;
          }
          setReleaseOrder(freshOrder);
          setReleaseTxHash(null);
          setReleaseError(null);
          setIsReleasingEscrow(false);
          setShowReleaseModal(true);
          return;
        }
      }
    } catch (err) {
      console.error('[Release] Error fetching fresh order:', err);
    }

    if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'expired') {
      addNotification('system', `Order already ${order.status}.`, order.id);
      fetchOrders();
      return;
    }

    setReleaseOrder(order);
    setReleaseTxHash(null);
    setReleaseError(null);
    setIsReleasingEscrow(false);
    setShowReleaseModal(true);
  }, [merchantId, isMockMode, solanaWallet.connected, addNotification, setShowWalletModal, fetchOrders]);

  const executeRelease = useCallback(async () => {
    if (!merchantId || !releaseOrder) return;

    setIsReleasingEscrow(true);
    setReleaseError(null);

    try {
      const { escrowTradeId, escrowCreatorWallet, userWallet } = releaseOrder;

      if (!isMockMode) {
        const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
        if (!escrowTradeId || !escrowCreatorWallet || !userWallet) {
          setReleaseError('Missing escrow details. The escrow may not have been locked on-chain.');
          setIsReleasingEscrow(false);
          return;
        }
        if (!base58Regex.test(userWallet)) {
          setReleaseError('Invalid user wallet address format.');
          setIsReleasingEscrow(false);
          return;
        }
      }

      let releaseResult: { success: boolean; txHash: string; error?: string };
      if (isMockMode) {
        releaseResult = { success: true, txHash: `mock-release-${Date.now()}` };
      } else {
        try {
          releaseResult = await solanaWallet.releaseEscrow({
            creatorPubkey: escrowCreatorWallet || 'mock',
            tradeId: escrowTradeId || 0,
            counterparty: userWallet || 'mock',
          });
        } catch (releaseErr: unknown) {
          const msg = releaseErr instanceof Error ? releaseErr.message : String(releaseErr);
          if (msg.includes('ConstraintRaw') && msg.includes('counterparty_ata')) {
            setReleaseError('Buyer has not joined the escrow on-chain yet. Ask the buyer to connect their wallet and view this order first.');
            setIsReleasingEscrow(false);
            return;
          }
          throw releaseErr;
        }
      }

      if (releaseResult.success) {
        setReleaseTxHash(releaseResult.txHash);

        const releaseBackendRes = await fetch(`/api/orders/${releaseOrder.id}/escrow`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tx_hash: releaseResult.txHash,
            actor_type: 'merchant',
            actor_id: merchantId,
          }),
        });
        if (!releaseBackendRes.ok) {
          addNotification('system', 'Escrow released but backend sync failed. Refreshing...', releaseOrder.id);
        }

        playSound('trade_complete');
        addNotification('escrow', `Escrow released! ${releaseOrder.amount} USDC sent to buyer.`, releaseOrder.id);
        await afterMutationReconcile(releaseOrder.id, { status: "completed" as const });

        setTimeout(() => {
          const isM2M = !!releaseOrder.dbOrder?.buyer_merchant_id;
          const counterpartyName = isM2M
            ? (releaseOrder.dbOrder?.buyer_merchant?.display_name || 'Merchant')
            : releaseOrder.user;
          setRatingModalData({
            orderId: releaseOrder.id,
            counterpartyName,
            counterpartyType: isM2M ? 'merchant' : 'user',
          });
        }, 1500);
      } else {
        setReleaseError(releaseResult.error || 'Failed to release escrow');
        playSound('error');
      }
    } catch (error) {
      setReleaseError(error instanceof Error ? error.message : 'Failed to release escrow. Please try again.');
      playSound('error');
    } finally {
      setIsReleasingEscrow(false);
    }
  }, [merchantId, releaseOrder, isMockMode, solanaWallet, addNotification, playSound, afterMutationReconcile, setRatingModalData]);

  const closeReleaseModal = useCallback(() => {
    setShowReleaseModal(false);
    setReleaseOrder(null);
    setReleaseTxHash(null);
    setReleaseError(null);
    setIsReleasingEscrow(false);
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // ESCROW CANCEL
  // ═══════════════════════════════════════════════════════════════════

  const openCancelModal = useCallback(async (order: Order) => {
    if (!merchantId) return;

    if (!isMockMode && !solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to cancel escrow.');
      setShowWalletModal(true);
      return;
    }

    try {
      const res = await fetch(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          const freshOrder = mapDbOrderToUI(data.data, merchantId);
          setCancelOrder(freshOrder);
          setCancelTxHash(null);
          setCancelError(null);
          setIsCancellingEscrow(false);
          setShowCancelModal(true);
          return;
        }
      }
    } catch (err) {
      console.error('[Cancel] Error fetching fresh order:', err);
    }

    setCancelOrder(order);
    setCancelTxHash(null);
    setCancelError(null);
    setIsCancellingEscrow(false);
    setShowCancelModal(true);
  }, [merchantId, isMockMode, solanaWallet.connected, addNotification, setShowWalletModal]);

  const executeCancelEscrow = useCallback(async () => {
    if (!merchantId || !cancelOrder) return;

    setIsCancellingEscrow(true);
    setCancelError(null);

    try {
      const { escrowTradeId, escrowCreatorWallet } = cancelOrder;

      if (!isMockMode && (!escrowTradeId || !escrowCreatorWallet)) {
        setCancelError('Missing escrow details. The escrow may not have been locked on-chain.');
        setIsCancellingEscrow(false);
        return;
      }

      let refundResult: { success: boolean; txHash: string; error?: string };
      if (isMockMode) {
        refundResult = { success: true, txHash: `mock-refund-${Date.now()}` };
      } else {
        refundResult = await solanaWallet.refundEscrow({
          creatorPubkey: escrowCreatorWallet || 'mock',
          tradeId: escrowTradeId || 0,
        });
      }

      if (refundResult.success) {
        setCancelTxHash(refundResult.txHash);

        await fetch(`/api/orders/${cancelOrder.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'cancelled',
            actor_type: 'merchant',
            actor_id: merchantId,
            refund_tx_hash: refundResult.txHash,
          }),
        });

        playSound('click');
        addNotification('system', `Escrow cancelled. ${cancelOrder.amount} USDC returned to your balance.`, cancelOrder.id);
        await afterMutationReconcile(cancelOrder.id, { status: "cancelled" as const });
      } else {
        setCancelError(refundResult.error || 'Failed to refund escrow');
        playSound('error');
      }
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : 'Failed to cancel escrow. Please try again.');
      playSound('error');
    } finally {
      setIsCancellingEscrow(false);
    }
  }, [merchantId, cancelOrder, isMockMode, solanaWallet, addNotification, playSound, afterMutationReconcile]);

  const closeCancelModal = useCallback(() => {
    setShowCancelModal(false);
    setCancelOrder(null);
    setCancelTxHash(null);
    setCancelError(null);
    setIsCancellingEscrow(false);
  }, []);

  // Cancel without escrow (pending/accepted orders)
  const cancelOrderWithoutEscrow = useCallback(async (orderId: string) => {
    if (!merchantId) return;

    const confirmed = confirm('Cancel this order? This action cannot be undone.');
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/orders/${orderId}?actor_type=merchant&actor_id=${merchantId}&reason=Cancelled by merchant`, {
        method: 'DELETE',
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          playSound('click');
          addNotification('system', 'Order cancelled successfully.', orderId);
          await afterMutationReconcile(orderId, { status: "cancelled" as const });
        } else {
          addNotification('system', data.error || 'Failed to cancel order', orderId);
          playSound('error');
        }
      } else {
        const data = await res.json();
        addNotification('system', data.error || 'Failed to cancel order', orderId);
        playSound('error');
      }
    } catch (error) {
      console.error('[Cancel] Error cancelling order:', error);
      addNotification('system', 'Failed to cancel order. Please try again.', orderId);
      playSound('error');
    }
  }, [merchantId, addNotification, playSound, afterMutationReconcile]);

  // Open escrow modal for a fresh sell order (used by handleDirectOrderCreation)
  const openEscrowModalForSell = useCallback((tempOrder: Order) => {
    setEscrowOrder(tempOrder);
    setEscrowTxHash(null);
    setEscrowError(null);
    setIsLockingEscrow(false);
    setShowEscrowModal(true);
  }, []);

  return {
    // Lock state
    showEscrowModal, escrowOrder, isLockingEscrow, escrowTxHash, escrowError,
    openEscrowModal, openEscrowModalForSell, executeLockEscrow, closeEscrowModal,

    // Release state
    showReleaseModal, releaseOrder, isReleasingEscrow, releaseTxHash, releaseError,
    openReleaseModal, executeRelease, closeReleaseModal,

    // Cancel state
    showCancelModal, cancelOrder, isCancellingEscrow, cancelTxHash, cancelError,
    openCancelModal, executeCancelEscrow, closeCancelModal,

    // Simple cancel
    cancelOrderWithoutEscrow,
  };
}
