"use client";

import { useReducer, useState, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, DbOrder, Notification } from "@/types/merchant";
import { mapDbOrderToUI } from "@/lib/orders/mappers";
import { computeMyRole } from "@/lib/orders/statusResolver";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { isValidSolanaAddress } from '@/lib/validation/solana';
import { showConfirm } from '@/context/ModalContext';

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

// ─── Escrow reducer ───────────────────────────────────────────────
// Replaces 15 individual useState calls with a single reducer.
// Each operation (lock/release/cancel) has the same shape: show, order, loading, txHash, error.

interface OperationState {
  show: boolean;
  order: Order | null;
  loading: boolean;
  txHash: string | null;
  error: string | null;
}

const INITIAL_OP: OperationState = { show: false, order: null, loading: false, txHash: null, error: null };

interface EscrowState {
  lock: OperationState;
  release: OperationState;
  cancel: OperationState;
}

const INITIAL_ESCROW_STATE: EscrowState = {
  lock: INITIAL_OP,
  release: INITIAL_OP,
  cancel: INITIAL_OP,
};

type EscrowAction =
  | { type: 'OPEN'; op: 'lock' | 'release' | 'cancel'; order: Order }
  | { type: 'CLOSE'; op: 'lock' | 'release' | 'cancel' }
  | { type: 'SET_LOADING'; op: 'lock' | 'release' | 'cancel'; loading: boolean }
  | { type: 'SET_TX_HASH'; op: 'lock' | 'release' | 'cancel'; txHash: string }
  | { type: 'SET_ERROR'; op: 'lock' | 'release' | 'cancel'; error: string | null }
  | { type: 'SET_ORDER'; op: 'lock' | 'release' | 'cancel'; order: Order | null }
  | { type: 'HIDE_MODAL'; op: 'lock' | 'release' | 'cancel' };

function escrowReducer(state: EscrowState, action: EscrowAction): EscrowState {
  switch (action.type) {
    case 'OPEN':
      return { ...state, [action.op]: { show: true, order: action.order, loading: false, txHash: null, error: null } };
    case 'CLOSE':
      return { ...state, [action.op]: INITIAL_OP };
    case 'SET_LOADING':
      return { ...state, [action.op]: { ...state[action.op], loading: action.loading } };
    case 'SET_TX_HASH':
      return { ...state, [action.op]: { ...state[action.op], txHash: action.txHash } };
    case 'SET_ERROR':
      return { ...state, [action.op]: { ...state[action.op], error: action.error } };
    case 'SET_ORDER':
      return { ...state, [action.op]: { ...state[action.op], order: action.order } };
    case 'HIDE_MODAL':
      return { ...state, [action.op]: { ...state[action.op], show: false } };
    default:
      return state;
  }
}

interface UseEscrowOperationsParams {
  solanaWallet: any;
  effectiveBalance: number | null;
  inAppBalance: number | null;
  addNotification: (type: Notification['type'], message: string, orderId?: string) => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  afterMutationReconcile: (orderId: string, optimisticUpdate?: Partial<Order>) => Promise<void>;
  fetchOrders: () => Promise<void>;
  refreshBalance: () => void;
  setShowWalletModal: (show: boolean) => void;
  setRatingModalData: (data: { orderId: string; counterpartyName: string; counterpartyType: 'user' | 'merchant' } | null) => void;
}

export function useEscrowOperations({
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

  // ─── Escrow state (single reducer for all 3 operations) ───
  const [es, dispatch] = useReducer(escrowReducer, INITIAL_ESCROW_STATE);

  // Derived aliases — same names the return object exposes, zero behavior change
  const showEscrowModal = es.lock.show;
  const escrowOrder = es.lock.order;
  const isLockingEscrow = es.lock.loading;
  const escrowTxHash = es.lock.txHash;
  const escrowError = es.lock.error;

  const showReleaseModal = es.release.show;
  const releaseOrder = es.release.order;
  const isReleasingEscrow = es.release.loading;
  const releaseTxHash = es.release.txHash;
  const releaseError = es.release.error;

  const showCancelModal = es.cancel.show;
  const cancelOrder = es.cancel.order;
  const isCancellingEscrow = es.cancel.loading;
  const cancelTxHash = es.cancel.txHash;
  const cancelError = es.cancel.error;

  // ─── Cancel without escrow loading ───
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

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

    if (!solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to lock escrow.');
      setShowWalletModal(true);
      return;
    }

    let orderToUse = order;
    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          orderToUse = mapDbOrderToUI(data.data, merchantId);
        }
      }
    } catch (err) {
      console.error('[Escrow] Error fetching fresh order:', err);
    }

    dispatch({ type: 'OPEN', op: 'lock', order: orderToUse });
  }, [merchantId, solanaWallet.connected, addNotification, setShowWalletModal]);

  const executeLockEscrow = useCallback(async () => {
    if (!merchantId || !escrowOrder) return;

    if (effectiveBalance !== null && effectiveBalance < escrowOrder.amount) {
      dispatch({ type: 'SET_ERROR', op: 'lock', error: `Insufficient USDC balance. You need ${escrowOrder.amount} USDC but have ${effectiveBalance.toFixed(2)} USDC.` });
      return;
    }

    if (effectiveBalance === null) {
      await refreshBalance();
      await new Promise(r => setTimeout(r, 500));
      const newBalance = solanaWallet.usdtBalance;
      if (newBalance !== null && newBalance < escrowOrder.amount) {
        dispatch({ type: 'SET_ERROR', op: 'lock', error: `Insufficient USDC balance. You need ${escrowOrder.amount} USDC but have ${newBalance.toFixed(2)} USDC.` });
        return;
      }
    }

    const myWallet = solanaWallet.walletAddress;

    const hasAcceptorWallet = isValidSolanaAddress(escrowOrder.acceptorWallet);
    const hasUserWallet = isValidSolanaAddress(escrowOrder.userWallet);
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
        recipientWallet = isValidSolanaAddress(escrowOrder.acceptorWallet) ? escrowOrder.acceptorWallet! : undefined;
      } else {
        recipientWallet = isValidSolanaAddress(escrowOrder.buyerMerchantWallet) ? escrowOrder.buyerMerchantWallet! : undefined;
      }
    } else {
      recipientWallet = isValidSolanaAddress(escrowOrder.userWallet) ? escrowOrder.userWallet! : undefined;
    }

    if (!recipientWallet && !canEscrowToTreasury && !IS_EMBEDDED_WALLET) {
      dispatch({ type: 'SET_ERROR', op: 'lock', error: isMerchantTrade
        ? 'The other merchant has not connected their Solana wallet yet.'
        : 'User has not connected their Solana wallet yet. Ask them to connect their wallet in the app first.' });
      return;
    }

    dispatch({ type: 'SET_LOADING', op: 'lock', loading: true });
    dispatch({ type: 'SET_ERROR', op: 'lock', error: null });

    try {
      const escrowResult: { success: boolean; txHash: string; tradeId?: number; tradePda?: string; escrowPda?: string; error?: string } = await solanaWallet.depositToEscrowOpen({
        amount: escrowOrder.amount,
        side: 'sell',
      });

      if (!escrowResult.success || !escrowResult.txHash) {
        throw new Error(escrowResult.error || 'Transaction failed');
      }

      dispatch({ type: 'SET_TX_HASH', op: 'lock', txHash: escrowResult.txHash });
      dispatch({ type: 'HIDE_MODAL', op: 'lock' });

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
          const res = await fetchWithAuth("/api/merchant/orders", {
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
            dispatch({ type: 'CLOSE', op: 'lock' });
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
            const res = await fetchWithAuth(`/api/orders/${escrowOrder.id}/escrow`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(escrowPayload),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.success) recorded = true;
              else console.error(`[Escrow] Attempt ${attempt + 1} — server returned success:false`, data);
            } else {
              const errData = await res.json().catch(() => ({}));
              console.error(`[Escrow] Attempt ${attempt + 1} — HTTP ${res.status}`, errData);
            }
          } catch (err) {
            console.error(`[Merchant] Escrow record attempt ${attempt + 1} failed:`, err);
          }
        }

        if (recorded) {
          playSound('trade_complete');
          addNotification('escrow', `${escrowOrder.amount} USDC locked in escrow - waiting for payment`, escrowOrder.id);
          dispatch({ type: 'CLOSE', op: 'lock' });
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
      dispatch({ type: 'SET_LOADING', op: 'lock', loading: false });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('block height exceeded') || errorMsg.includes('has expired')) {
        dispatch({ type: 'SET_ERROR', op: 'lock', error: 'Transaction expired. Please approve the wallet popup faster (within 60 seconds). Try again.' });
      } else {
        dispatch({ type: 'SET_ERROR', op: 'lock', error: errorMsg || 'Failed to lock escrow. Please try again.' });
      }
      dispatch({ type: 'SET_LOADING', op: 'lock', loading: false });
      playSound('error');
    }
  }, [merchantId, escrowOrder, effectiveBalance, inAppBalance, solanaWallet, addNotification, playSound, afterMutationReconcile, refreshBalance]);

  const closeEscrowModal = useCallback(() => {
    dispatch({ type: 'CLOSE', op: 'lock' });
    fetchOrders();
  }, [fetchOrders]);

  // ═══════════════════════════════════════════════════════════════════
  // ESCROW RELEASE
  // ═══════════════════════════════════════════════════════════════════

  const openReleaseModal = useCallback(async (order: Order) => {
    if (!merchantId) return;

    if (!solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to release escrow.');
      setShowWalletModal(true);
      return;
    }

    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}`);
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

          // Pre-flight escrow check: verify escrow is locked before showing release modal
          if (!data.data.escrow_debited_entity_id && !data.data.escrow_tx_hash) {
            addNotification('system', 'Please lock escrow before releasing funds. The escrow step has not been completed.', order.id);
            playSound('error');
            return;
          }

          dispatch({ type: 'OPEN', op: 'release', order: freshOrder });
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

    dispatch({ type: 'OPEN', op: 'release', order });
  }, [merchantId, solanaWallet.connected, addNotification, playSound, setShowWalletModal, fetchOrders]);

  const executeRelease = useCallback(async () => {
    if (!merchantId || !releaseOrder) return;

    dispatch({ type: 'SET_LOADING', op: 'release', loading: true });
    dispatch({ type: 'SET_ERROR', op: 'release', error: null });

    try {
      // Server-side pre-flight validation before on-chain transaction
      try {
        const validateRes = await fetchWithAuth(`/api/orders/${releaseOrder.id}/validate-release`);
        if (validateRes.ok) {
          const validateData = await validateRes.json();
          if (validateData.success && validateData.data && !validateData.data.canRelease) {
            const reasons = validateData.data.reasons as string[];
            dispatch({ type: 'SET_ERROR', op: 'release', error: reasons[0] || 'Release validation failed. Please ensure escrow is locked and payment is confirmed.' });
            dispatch({ type: 'SET_LOADING', op: 'release', loading: false });
            return;
          }
        }
      } catch (validateErr) {
        // Non-blocking: if validation endpoint fails, proceed with on-chain checks
        console.warn('[Release] Pre-flight validation failed (non-blocking):', validateErr);
      }

      const { escrowTradeId, escrowCreatorWallet, userWallet } = releaseOrder;

      if (!escrowTradeId || !escrowCreatorWallet || !userWallet) {
        dispatch({ type: 'SET_ERROR', op: 'release', error: 'Missing escrow details. The escrow may not have been locked on-chain. Please lock escrow before releasing funds.' });
        dispatch({ type: 'SET_LOADING', op: 'release', loading: false });
        return;
      }
      if (!isValidSolanaAddress(userWallet)) {
        dispatch({ type: 'SET_ERROR', op: 'release', error: 'Invalid user wallet address format.' });
        dispatch({ type: 'SET_LOADING', op: 'release', loading: false });
        return;
      }

      let releaseResult: { success: boolean; txHash: string; error?: string };
      {
        // Ensure acceptTrade is called first (merchant joins escrow as counterparty)
        // This is required before releaseEscrow — the on-chain trade must be in Locked state
        try {
          console.log('[Release] Ensuring acceptTrade before release:', {
            tradeId: escrowTradeId,
            creatorWallet: escrowCreatorWallet,
          });
          await solanaWallet.acceptTrade({
            creatorPubkey: escrowCreatorWallet,
            tradeId: escrowTradeId,
          });
          console.log('[Release] acceptTrade succeeded (or was already done)');
        } catch (acceptErr: any) {
          // Expected to fail if already accepted — safe to continue
          console.log('[Release] acceptTrade skipped (likely already done):', acceptErr?.message);
        }

        try {
          releaseResult = await solanaWallet.releaseEscrow({
            creatorPubkey: escrowCreatorWallet,
            tradeId: escrowTradeId,
            counterparty: userWallet,
          });
        } catch (releaseErr: unknown) {
          const msg = releaseErr instanceof Error ? releaseErr.message : String(releaseErr);
          console.error('[Release] releaseEscrow failed:', msg);

          // Escrow account gone = already released on-chain, just sync DB
          if (msg.includes('AccountNotInitialized')) {
            console.log('[Release] Escrow already released on-chain — syncing backend...');
            releaseResult = { success: true, txHash: releaseOrder.escrowTxHash || 'already-released' };
          } else if (msg.includes('ConstraintRaw') || msg.includes('CannotRelease')) {
            dispatch({ type: 'SET_ERROR', op: 'release', error: `Unable to release escrow: ${msg.slice(0, 200)}` });
            dispatch({ type: 'SET_LOADING', op: 'release', loading: false });
            return;
          } else {
            throw releaseErr;
          }
        }
      }

      if (releaseResult.success) {
        dispatch({ type: 'SET_TX_HASH', op: 'release', txHash: releaseResult.txHash });

        const releaseBackendRes = await fetchWithAuth(`/api/orders/${releaseOrder.id}/escrow`, {
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
        dispatch({ type: 'SET_ERROR', op: 'release', error: releaseResult.error || 'Failed to release escrow' });
        playSound('error');
      }
    } catch (error) {
      dispatch({ type: 'SET_ERROR', op: 'release', error: error instanceof Error ? error.message : 'Failed to release escrow. Please try again.' });
      playSound('error');
    } finally {
      dispatch({ type: 'SET_LOADING', op: 'release', loading: false });
    }
  }, [merchantId, releaseOrder, solanaWallet, addNotification, playSound, afterMutationReconcile, setRatingModalData]);

  const closeReleaseModal = useCallback(() => {
    dispatch({ type: 'CLOSE', op: 'release' });
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // ESCROW CANCEL
  // ═══════════════════════════════════════════════════════════════════

  const openCancelModal = useCallback(async (order: Order) => {
    if (!merchantId) return;

    if (!solanaWallet.connected) {
      addNotification('system', 'Please connect your wallet to cancel escrow.');
      setShowWalletModal(true);
      return;
    }

    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          const freshOrder = mapDbOrderToUI(data.data, merchantId);
          dispatch({ type: 'OPEN', op: 'cancel', order: freshOrder });
          return;
        }
      }
    } catch (err) {
      console.error('[Cancel] Error fetching fresh order:', err);
    }

    dispatch({ type: 'OPEN', op: 'cancel', order });
  }, [merchantId, solanaWallet.connected, addNotification, setShowWalletModal]);

  const executeCancelEscrow = useCallback(async () => {
    if (!merchantId || !cancelOrder) return;

    dispatch({ type: 'SET_LOADING', op: 'cancel', loading: true });
    dispatch({ type: 'SET_ERROR', op: 'cancel', error: null });

    try {
      const { escrowTradeId, escrowCreatorWallet } = cancelOrder;

      if (!escrowTradeId || !escrowCreatorWallet) {
        dispatch({ type: 'SET_ERROR', op: 'cancel', error: 'Missing escrow details. The escrow may not have been locked on-chain.' });
        dispatch({ type: 'SET_LOADING', op: 'cancel', loading: false });
        return;
      }

      const refundResult: { success: boolean; txHash: string; error?: string } = await solanaWallet.refundEscrow({
        creatorPubkey: escrowCreatorWallet,
        tradeId: escrowTradeId,
      });

      if (refundResult.success) {
        dispatch({ type: 'SET_TX_HASH', op: 'cancel', txHash: refundResult.txHash });

        await fetchWithAuth(`/api/orders/${cancelOrder.id}`, {
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
        dispatch({ type: 'SET_ERROR', op: 'cancel', error: refundResult.error || 'Failed to refund escrow' });
        playSound('error');
      }
    } catch (error) {
      dispatch({ type: 'SET_ERROR', op: 'cancel', error: error instanceof Error ? error.message : 'Failed to cancel escrow. Please try again.' });
      playSound('error');
    } finally {
      dispatch({ type: 'SET_LOADING', op: 'cancel', loading: false });
    }
  }, [merchantId, cancelOrder, solanaWallet, addNotification, playSound, afterMutationReconcile]);

  const closeCancelModal = useCallback(() => {
    dispatch({ type: 'CLOSE', op: 'cancel' });
  }, []);

  // Cancel without escrow (pending/accepted orders)
  const cancelOrderWithoutEscrow = useCallback((orderId: string) => {
    if (!merchantId) return;

    showConfirm('Cancel Order', 'Cancel this order? This action cannot be undone.', async () => {
      setCancellingOrderId(orderId);
      try {
        const res = await fetchWithAuth(`/api/orders/${orderId}?actor_type=merchant&actor_id=${merchantId}&reason=Cancelled by merchant`, {
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
      } finally {
        setCancellingOrderId(null);
      }
    }, { variant: 'warning', confirmLabel: 'Cancel Order' });
  }, [merchantId, addNotification, playSound, afterMutationReconcile]);

  // Open escrow modal for a fresh sell order (used by handleDirectOrderCreation)
  const openEscrowModalForSell = useCallback((tempOrder: Order) => {
    dispatch({ type: 'OPEN', op: 'lock', order: tempOrder });
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
    cancelOrderWithoutEscrow, cancellingOrderId,
  };
}
