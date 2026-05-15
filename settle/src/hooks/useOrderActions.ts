"use client";

import { useRef, useState, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, DbOrder, Notification } from "@/types/merchant";
import { mapDbOrderToUI } from "@/lib/orders/mappers";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { newSubmitId, orderActionKey, txAnchoredKey } from '@/lib/api/idempotencyKeys';
import { isValidSolanaAddress } from '@/lib/validation/solana';
import { showConfirm } from '@/context/ModalContext';
import { formatFiat } from '@/lib/format';
import { getCachedPrice, ensurePriceFresh } from '@/lib/price/clientPriceCache';
import bs58 from 'bs58';

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

interface UseOrderActionsParams {
  solanaWallet: any;
  effectiveBalance: number | null;
  addNotification: (type: Notification['type'], message: string, orderId?: string) => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  afterMutationReconcile: (orderId: string, optimisticUpdate?: Partial<Order>) => Promise<void>;
  setShowWalletModal: (show: boolean) => void;
  handleOpenChat: (order: Order) => void;
  setSelectedOrderPopup: (order: Order | null) => void;
  openEscrowModalForSell: (tempOrder: Order) => void;
}

export function useOrderActions({
  solanaWallet,
  effectiveBalance,
  addNotification,
  playSound,
  afterMutationReconcile,
  setShowWalletModal,
  handleOpenChat,
  setSelectedOrderPopup,
  openEscrowModalForSell,
}: UseOrderActionsParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const orders = useMerchantStore(s => s.orders);

  // Sync merchant DB balance from Solana wallet after trade completion.
  // This ensures ledger entries have accurate balance_before/balance_after.
  const syncBalance = async () => {
    if (!merchantId) return;
    try {
      // Best-effort refresh of the client's view; the server fetches the
      // authoritative ATA balance itself and writes it to merchants.balance.
      // The number the client knows is no longer trusted — only used to
      // trigger the server-side reconcile.
      await solanaWallet.refreshBalances();
      await fetchWithAuth('/api/merchant/sync-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant_id: merchantId }),
      });
    } catch {
      // Non-critical — balance will sync on next trade
    }
  };
  const setOrders = useMerchantStore(s => s.setOrders);

  // ─── Local state ───
  const [markingDone, setMarkingDone] = useState(false);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);
  const [isCreatingTrade, setIsCreatingTrade] = useState(false);
  const [createTradeError, setCreateTradeError] = useState<string | null>(null);

  // Per-submission idempotency key for the BUY merchant order create flow.
  // No on-chain anchor exists yet (BUY = no escrow at create), so we hold a
  // submit-scoped UUID across retries within a single click attempt and
  // reset on success. See lib/api/idempotencyKeys.ts for the rationale.
  const directBuySubmitIdRef = useRef<string | null>(null);

  // ═══════════════════════════════════════════════════════════════════
  // ACCEPT ORDER
  // ═══════════════════════════════════════════════════════════════════
  const acceptOrder = async (order: Order) => {
    if (!merchantId) return;
    setAcceptingOrderId(order.id);

    const isBuyOrder = order.orderType === 'buy';
    const isSellOrder = order.orderType === 'sell';

    // Check if escrow exists on-chain (don't gate on status — escrow data may arrive before status updates)
    const hasOnChainEscrow = !!order.escrowTxHash && !!order.escrowCreatorWallet && order.escrowTradeId != null;

    // Always require wallet before accepting — you'll need it for escrow lock or release
    if (!solanaWallet.walletAddress) {
      playSound('error');
      addNotification('system', 'Please connect your wallet first to accept orders.', order.id);
      setShowWalletModal(true);
      setAcceptingOrderId(null);
      return;
    }

    // For BUY orders: merchant is the seller (sends crypto, receives fiat).
    // The user needs the merchant's bank/UPI details to send fiat — so the
    // merchant MUST have at least one active payment method before accepting.
    if (isBuyOrder) {
      try {
        const pmRes = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`);
        if (pmRes.ok) {
          const pmData = await pmRes.json();
          const activeMethods = (pmData?.data || []).filter((pm: any) => pm.is_active !== false);
          if (activeMethods.length === 0) {
            addNotification('system', 'You need to add a payment method before accepting buy orders. Go to Settings → Payments.', order.id);
            playSound('error');
            setAcceptingOrderId(null);
            return;
          }
        }
      } catch {
        // Non-blocking: if the check fails, allow accept (server will validate)
      }
    }

    // ── Wallet-binding signature ──
    // Sign a binding message with the CURRENT wallet at the moment of accept.
    // Backend requires this (Option B) — eliminates the closure-stale-value
    // and silent-link-fail bugs where the frozen `acceptor_wallet_address` on
    // the order could end up as a stale/wrong wallet.
    // Binding format must match buildOrderBindingMessage('Claim', ...).
    let acceptorSignatureB64: string | null = null;
    try {
      const walletAddr = solanaWallet.walletAddress;
      const bindingMsg = `Claim order ${order.id} - I will send fiat payment. Wallet: ${walletAddr}`;
      const sigBytes = await solanaWallet.signMessage(new TextEncoder().encode(bindingMsg));
      acceptorSignatureB64 = bs58.encode(sigBytes);
    } catch (sigErr) {
      console.error('[Merchant] Accept signature failed:', sigErr);
      addNotification('system', 'Failed to sign accept binding — wallet rejected or locked. Please retry.', order.id);
      playSound('error');
      setAcceptingOrderId(null);
      return;
    }

    try {
      // If escrow is already funded by seller, call acceptTrade on-chain first
      if (hasOnChainEscrow) {
        try {
          const acceptResult = await solanaWallet.acceptTrade({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
          });

          if (!acceptResult.success) {
            console.error('[Go] Failed to accept trade on-chain:', acceptResult.error);
            addNotification('system', `Failed to join escrow: ${acceptResult.error}`, order.id);
            playSound('error');
            return;
          }

          addNotification('system', 'Successfully joined escrow on-chain!', order.id);
        } catch (acceptError: any) {
          const errMsg = acceptError?.message || acceptError?.toString() || '';
          // CannotAccept / 0x177d = trade already accepted (e.g. auto-fix ran first) — continue
          if (errMsg.includes('CannotAccept') || errMsg.includes('0x177d') || errMsg.includes('6013')) {
            console.log('[Go] Trade already accepted on-chain, continuing to backend accept');
          } else {
            console.error('[Go] Error accepting trade on-chain:', acceptError);
            addNotification('system', `Failed to join escrow: ${errMsg}`, order.id);
            playSound('error');
            return;
          }
        }
      }

      // For escrowed orders, determine the right action:
      // - Merchant already assigned (user sell): SEND_PAYMENT directly (atomic claim+pay)
      // - Unclaimed broadcast: CLAIM to set buyer_merchant_id
      const isEscrowed = order.dbOrder?.status === 'escrowed' || order.minimalStatus === 'escrowed';
      const iAmAssignedMerchant = order.orderMerchantId === merchantId;

      let acceptRes;
      if (isEscrowed && hasOnChainEscrow) {
        // Use SEND_PAYMENT action — backend handles atomic claim+pay for unclaimed,
        // or direct payment_sent transition for already-assigned merchants
        const acceptAction = iAmAssignedMerchant ? 'SEND_PAYMENT' : 'CLAIM';
        const actionBody: Record<string, unknown> = {
          action: acceptAction,
          actor_type: 'merchant',
          actor_id: merchantId,
        };
        if (isValidSolanaAddress(solanaWallet.walletAddress)) {
          actionBody.acceptor_wallet_address = solanaWallet.walletAddress;
          actionBody.acceptor_wallet_signature = acceptorSignatureB64;
        }
        // SEND_PAYMENT is a financial transition — backend rejects without
        // Idempotency-Key. CLAIM doesn't need one but the header is harmless.
        const acceptHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (acceptAction === 'SEND_PAYMENT') {
          acceptHeaders['Idempotency-Key'] = orderActionKey(order.id, 'SEND_PAYMENT');
        }
        acceptRes = await fetchWithAuth(`/api/orders/${order.id}/action`, {
          method: "POST",
          headers: acceptHeaders,
          body: JSON.stringify(actionBody),
        });
      } else {
        // Normal accept flow via PATCH
        const requestBody: Record<string, unknown> = {
          status: "accepted",
          actor_type: "merchant",
          actor_id: merchantId,
        };
        if (isValidSolanaAddress(solanaWallet.walletAddress)) {
          requestBody.acceptor_wallet_address = solanaWallet.walletAddress;
          requestBody.acceptor_wallet_signature = acceptorSignatureB64;
        }
        acceptRes = await fetchWithAuth(`/api/orders/${order.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
      }
      if (!acceptRes.ok) {
        const errorText = await acceptRes.text().catch(() => '');
        let errorMsg = `HTTP ${acceptRes.status}`;
        try {
          const errorData = JSON.parse(errorText);
          errorMsg = errorData.error || JSON.stringify(errorData);
        } catch {
          errorMsg = errorText || errorMsg;
        }
        // 409 = order already claimed by another merchant. This is a normal
        // race outcome (fastest-finger-first), not a bug — surface to the
        // user via the toast but do NOT trip the dev error overlay.
        const isClaimRace = acceptRes.status === 409;
        const friendlyMsg = isClaimRace
          ? 'Order already claimed by another merchant'
          : `Failed to accept order: ${errorMsg}`;
        if (isClaimRace) {
          console.info('[Merchant] Lost claim race:', errorMsg);
        } else {
          console.error('Failed to accept order:', acceptRes.status, errorMsg);
        }
        addNotification('system', friendlyMsg, order.id);
        playSound('error');
        return;
      }
      const acceptData = await acceptRes.json();

      if (!acceptData.success) {
        // Server returned 200 but success=false — usually CLAIM_FAILED race.
        const isClaimRace = /already (claim|accept|in progress)/i.test(acceptData.error || '');
        if (isClaimRace) {
          console.info('[Merchant] Lost claim race:', acceptData.error);
        } else {
          console.error('Failed to accept order:', acceptData.error);
        }
        addNotification('system', `Failed to accept order: ${acceptData.error}`, order.id);
        playSound('error');
        return;
      }

      const acceptRole = isBuyOrder ? 'seller' : 'buyer';
      const nextStepMsg = hasOnChainEscrow
        ? 'Order claimed! Send the fiat payment and click "I\'ve Paid".'
        : acceptRole === 'seller'
          ? 'Now lock your USDT in escrow to proceed.'
          : 'Waiting for the seller to lock escrow.';

      const uiStatus = hasOnChainEscrow ? "escrow" : "active";
      playSound('click');
      addNotification('system', `Order accepted! ${nextStepMsg}`, order.id);
      await afterMutationReconcile(order.id, { status: uiStatus as "escrow" | "active", expiresIn: 1800 });
    } catch (error) {
      console.error("Error accepting order:", error);
      playSound('error');
    } finally {
      setAcceptingOrderId(null);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // ACCEPT WITH sAED
  // ═══════════════════════════════════════════════════════════════════
  const acceptWithSaed = async (order: Order) => {
    if (!merchantId) return;

    try {
      addNotification('system', 'Matching LP and locking sAED...', order.id);

      const bankDetails = order.dbOrder?.payment_details || {};

      const coreApiUrl = process.env.NEXT_PUBLIC_CORE_API_URL || 'http://localhost:4010';
      const matchRes = await fetchWithAuth(`${coreApiUrl}/v1/corridor/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          buyer_merchant_id: merchantId,
          seller_merchant_id: order.dbOrder?.merchant_id || order.orderMerchantId,
          fiat_amount: order.total || order.dbOrder?.fiat_amount,
          bank_details: bankDetails,
        }),
      });

      const matchData = await matchRes.json();
      if (!matchData.success) {
        addNotification('system', `LP match failed: ${matchData.error}`, order.id);
        playSound('error');
        return;
      }

      const { fee_percentage, corridor_fee_fils, saed_locked, provider_name } = matchData.data;
      addNotification(
        'system',
        `LP matched: ${provider_name || 'Provider'} (${fee_percentage}% fee, ${(corridor_fee_fils / 100).toFixed(2)} AED). ${(saed_locked / 100).toFixed(2)} sAED locked.`,
        order.id
      );

      await acceptOrder(order);

      playSound('click');
    } catch (error) {
      console.error('Error accepting with sAED:', error);
      addNotification('system', 'Failed to accept with sAED. Try again.', order.id);
      playSound('error');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // SIGN TO CLAIM ORDER (buyer claims escrowed order via atomic action)
  // ═══════════════════════════════════════════════════════════════════
  const signToClaimOrder = async (order: Order) => {
    if (!merchantId) return;

    if (!solanaWallet.connected) {
      playSound('error');
      addNotification('system', 'Please connect your wallet to sign.');
      setShowWalletModal(true);
      return;
    }

    if (!solanaWallet.walletAddress || !solanaWallet.signMessage) {
      addNotification('system', 'Wallet not ready. Please reconnect.');
      playSound('error');
      return;
    }

    try {
      const walletAddr = solanaWallet.walletAddress;
      const message = `Claim order ${order.id} - I will send fiat payment. Wallet: ${walletAddr}`;
      const messageBytes = new TextEncoder().encode(message);

      addNotification('system', 'Please sign in your wallet to claim this order...', order.id);
      const signatureBytes = await solanaWallet.signMessage(messageBytes);

      // If escrow exists on-chain, join it first
      const hasOnChainEscrow = !!order.escrowTxHash && !!order.escrowCreatorWallet && order.escrowTradeId != null;
      if (hasOnChainEscrow) {
        try {
          const acceptResult = await solanaWallet.acceptTrade({
            creatorPubkey: order.escrowCreatorWallet,
            tradeId: order.escrowTradeId,
          });
          if (!acceptResult.success) {
            addNotification('system', `Failed to join escrow: ${acceptResult.error}`, order.id);
            playSound('error');
            return;
          }
        } catch (acceptError: any) {
          const errMsg = acceptError?.message || '';
          // Already accepted on-chain — continue
          if (!errMsg.includes('CannotAccept') && !errMsg.includes('0x177d') && !errMsg.includes('6013')) {
            addNotification('system', `Failed to join escrow: ${errMsg}`, order.id);
            playSound('error');
            return;
          }
        }
      }

      // Use the atomic CLAIM action endpoint
      const claimBody: Record<string, unknown> = {
        action: 'CLAIM',
        actor_type: 'merchant',
        actor_id: merchantId,
      };
      if (isValidSolanaAddress(walletAddr)) {
        claimBody.acceptor_wallet_address = walletAddr;
      }

      const res = await fetchWithAuth(`/api/orders/${order.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claimBody),
      });

      const responseData = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = responseData.code === 'CLAIM_FAILED'
          ? 'Order already claimed by another merchant.'
          : (responseData.error || 'Unknown error');
        addNotification('system', `Failed to claim order: ${errorMsg}`, order.id);
        playSound('error');
        return;
      }

      playSound('click');
      addNotification('system', 'Order claimed! Now send the fiat payment and click "I\'ve Paid".', order.id);
      await afterMutationReconcile(order.id, { status: "escrow" as const });
    } catch (error: any) {
      if (error?.message?.includes('User rejected')) {
        addNotification('system', 'Signature rejected. Please sign to claim.');
      } else {
        console.error("Error claiming order:", error);
        addNotification('system', 'Failed to claim. Please try again.');
      }
      playSound('error');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // SIGN AND PROCEED (Active -> Ongoing)
  // ═══════════════════════════════════════════════════════════════════
  const signAndProceed = async (order: Order) => {
    if (!merchantId) return;

    if (!solanaWallet.connected) {
      playSound('error');
      addNotification('system', 'Please connect your wallet to sign.');
      setShowWalletModal(true);
      return;
    }

    if (!solanaWallet.walletAddress || !solanaWallet.signMessage) {
      addNotification('system', 'Wallet not ready. Please reconnect.');
      playSound('error');
      return;
    }

    try {
      const walletAddr = solanaWallet.walletAddress;
      const message = `Confirm order ${order.id} - I will send fiat payment. Wallet: ${walletAddr}`;
      const messageBytes = new TextEncoder().encode(message);

      addNotification('system', 'Please sign in your wallet to proceed...', order.id);
      const signatureBytes = await solanaWallet.signMessage(messageBytes);
      const signature = bs58.encode(signatureBytes);

      const proceedBody: Record<string, string> = {
        status: "payment_sent",
        actor_type: "merchant",
        actor_id: merchantId,
      };
      if (isValidSolanaAddress(solanaWallet.walletAddress)) {
        proceedBody.acceptor_wallet_address = solanaWallet.walletAddress;
        proceedBody.acceptor_wallet_signature = signature;
      }

      const res = await fetchWithAuth(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": orderActionKey(order.id, 'patch_payment_sent') },
        body: JSON.stringify(proceedBody),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        addNotification('system', `Failed to update order: ${errorData.error || 'Unknown error'}`, order.id);
        playSound('error');
        return;
      }

      playSound('click');
      addNotification('system', 'Signed! Order moved to Ongoing. Click "I\'ve Paid" when you send the fiat.', order.id);
      await afterMutationReconcile(order.id, { status: "escrow" as const });
    } catch (error: any) {
      if (error?.message?.includes('User rejected')) {
        addNotification('system', 'Signature rejected. Please sign to proceed.');
      } else {
        console.error("Error signing:", error);
        addNotification('system', 'Failed to sign. Please try again.');
      }
      playSound('error');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // MARK FIAT PAYMENT SENT (uses action endpoint; auto-claims if unclaimed)
  // ═══════════════════════════════════════════════════════════════════
  const markFiatPaymentSent = async (order: Order) => {
    if (!merchantId) return;
    setMarkingDone(true);

    try {
      // ── On-chain: join escrow as counterparty (buyer) before marking payment ──
      // This moves the on-chain trade from Funded → Locked, which is required
      // for the seller to release escrow later. Only needed when:
      // 1. Order has on-chain escrow (escrowTradeId + escrowCreatorWallet)
      // 2. Wallet is connected
      // 3. Escrow is not mock/demo
      const hasOnChainEscrow = order.escrowTradeId && order.escrowCreatorWallet;
      const escrowTxHash = order.escrowTxHash || order.dbOrder?.escrow_tx_hash || '';
      const isMockEscrow = escrowTxHash.startsWith('demo-') || escrowTxHash.startsWith('mock-');

      if (hasOnChainEscrow && !isMockEscrow && solanaWallet.connected) {
        try {
          await solanaWallet.acceptTrade({
            creatorPubkey: order.escrowCreatorWallet!,
            tradeId: order.escrowTradeId!,
          });
          console.log('[Merchant] On-chain acceptTrade succeeded — escrow now in Locked state');
        } catch (joinErr: unknown) {
          const joinMsg = joinErr instanceof Error ? joinErr.message : String(joinErr);
          // CannotAccept (6011) = already accepted/locked — safe to continue
          // 0x177d = already accepted variant
          if (joinMsg.includes('CannotAccept') || joinMsg.includes('0x177d') || joinMsg.includes('6011')) {
            console.log('[Merchant] On-chain escrow already in Locked state, continuing');
          } else if (joinMsg.includes('User rejected')) {
            addNotification('system', 'Wallet signature rejected. Please try again.', order.id);
            playSound('error');
            setMarkingDone(false);
            return;
          } else {
            // Non-fatal: log and continue — server-side will handle it
            console.warn('[Merchant] On-chain acceptTrade failed (non-fatal):', joinMsg);
          }
        }
      }

      const actionBody: Record<string, unknown> = {
        action: 'SEND_PAYMENT',
        actor_type: 'merchant',
        actor_id: merchantId,
      };

      // Include wallet address + a fresh ownership signature. The backend
      // runs assertWalletOwnership: Option A compares against the merchant's
      // profile wallet, which can mismatch the wallet recorded on the order
      // (e.g. buyer accepted with a freshly-imported wallet that wasn't yet
      // persisted to merchants.wallet_address). Option B unblocks that case
      // — sign the canonical "Claim order …" binding so the server can
      // verify the user controls this wallet, regardless of profile drift.
      if (isValidSolanaAddress(solanaWallet.walletAddress)) {
        actionBody.acceptor_wallet_address = solanaWallet.walletAddress;
        try {
          const bindingMsg = `Claim order ${order.id} - I will send fiat payment. Wallet: ${solanaWallet.walletAddress}`;
          const sigBytes = await solanaWallet.signMessage(new TextEncoder().encode(bindingMsg));
          actionBody.acceptor_wallet_signature = bs58.encode(sigBytes);
        } catch (sigErr) {
          console.warn('[Merchant] SEND_PAYMENT ownership signature failed; server may reject:', sigErr);
        }
      }

      // SEND_PAYMENT is a financial transition — backend rejects without
      // Idempotency-Key (matches the contract in src/app/api/orders/[id]/action/route.ts).
      const res = await fetchWithAuth(`/api/orders/${order.id}/action`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": orderActionKey(order.id, 'SEND_PAYMENT'),
        },
        body: JSON.stringify(actionBody),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        playSound('click');
        const claimedMsg = data.data?.claimed
          ? 'Order claimed and payment marked as sent.'
          : 'Payment marked as sent.';
        addNotification('system', `${claimedMsg} Waiting for seller to release escrow.`, order.id);
        await afterMutationReconcile(order.id, { status: "escrow" as const });
      } else {
        addNotification('system', `Failed: ${data.error || 'Unknown error'}`, order.id);
        playSound('error');
      }
    } catch (error) {
      console.error("Error marking payment sent:", error);
      playSound('error');
    } finally {
      setMarkingDone(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // MARK PAYMENT SENT (-> Completed)
  // ═══════════════════════════════════════════════════════════════════
  const markPaymentSent = async (order: Order) => {
    if (!merchantId) return;
    setMarkingDone(true);

    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": orderActionKey(order.id, 'patch_completed') },
        body: JSON.stringify({
          status: "completed",
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSelectedOrderPopup(null);
          playSound('trade_complete');
          addNotification('complete', `Trade completed with ${order.user}!`, order.id);
          await afterMutationReconcile(order.id, { status: "completed" as const });
          syncBalance();
        }
      }
    } catch (error) {
      console.error("Error completing order:", error);
      playSound('error');
    } finally {
      setMarkingDone(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // COMPLETE ORDER
  // ═══════════════════════════════════════════════════════════════════
  const completeOrder = async (orderId: string) => {
    if (!merchantId) return;

    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": orderActionKey(orderId, 'patch_completed') },
        body: JSON.stringify({
          status: "completed",
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });
      if (!res.ok) {
        console.error("Failed to complete order:", res.status);
        return;
      }
      const data = await res.json();
      if (data.success) {
        playSound('trade_complete');
        await afterMutationReconcile(orderId, { status: "completed" as const });
        syncBalance();
      }
    } catch (error) {
      console.error("Error completing order:", error);
      playSound('error');
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // CONFIRM PAYMENT (release escrow + complete)
  // ═══════════════════════════════════════════════════════════════════
  const confirmPayment = async (orderId: string) => {
    if (!merchantId) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) {
      console.error("Order not found:", orderId);
      return;
    }

    // Safety: show confirmation dialog before proceeding.
    // Use the order's actual fiat currency (toCurrency) — the previous hardcoded
    // 'AED' was wrong for INR/USD/etc. corridors.
    const fiatCcy = order.toCurrency || order.dbOrder?.fiat_currency || '';
    const fiatAmountFormatted = order.total
      ? formatFiat(order.total, fiatCcy)
      : `${order.amount} USDT worth`;
    showConfirm(
      'Confirm Payment Received',
      `I confirm I have received the fiat payment of ${fiatAmountFormatted}. This will release escrow to the buyer and cannot be reversed.`,
      async () => {
        setConfirmingOrderId(orderId);
        try {
          // Release tx hash gets populated by the real on-chain release call
          // OR by the legitimate mock-escrow branch below. No "fallback" value
          // is initialized here — an empty string propagating past the switch
          // would be caught by backend validation.
          let releaseTxHash: string = '';

          if (order.orderType === 'buy' || order.orderType === 'sell') {
            const hasOnChainEscrow = order.escrowTradeId && order.escrowCreatorWallet && order.userWallet;

            // Detect mock/demo escrow — these have mock PDAs and don't exist on-chain
            const escrowTxHash = order.escrowTxHash || order.dbOrder?.escrow_tx_hash || '';
            const escrowPda = order.dbOrder?.escrow_pda || order.dbOrder?.escrow_trade_pda || '';
            const isMockEscrow = escrowTxHash.startsWith('demo-') || escrowTxHash.startsWith('mock-')
              || escrowPda.startsWith('mock-');

            if (hasOnChainEscrow && !isMockEscrow) {
              if (!solanaWallet.connected) {
                addNotification('system', 'Please connect your wallet to release escrow.', orderId);
                setShowWalletModal(true);
                playSound('error');
                return;
              }

              // Determine the correct counterparty (buyer) wallet for escrow release.
              // M2M: buyer is buyer_merchant_id — use their wallet (buyerMerchantWallet).
              // Non-M2M: buyer is the user — use acceptor_wallet_address or userWallet.
              const counterpartyWallet = order.buyerMerchantWallet
                || order.dbOrder?.acceptor_wallet_address
                || order.userWallet;

              if (!isValidSolanaAddress(counterpartyWallet)) {
                addNotification('system', 'Invalid buyer wallet address. Cannot release escrow.', orderId);
                playSound('error');
                return;
              }

              // Try to join escrow on behalf of counterparty first (auto-fix if not initialized)
              try {
                await solanaWallet.acceptTrade({
                  creatorPubkey: order.escrowCreatorWallet,
                  tradeId: order.escrowTradeId,
                });
              } catch (joinErr: unknown) {
                const joinMsg = joinErr instanceof Error ? joinErr.message : String(joinErr);
                if (!joinMsg.includes('CannotAccept') && !joinMsg.includes('0x177d') && !joinMsg.includes('6013')) {
                  console.warn('[Merchant] Auto-join escrow attempt failed:', joinMsg);
                }
              }

              let releaseResult;
              try {
                releaseResult = await solanaWallet.releaseEscrow({
                  creatorPubkey: order.escrowCreatorWallet,
                  tradeId: order.escrowTradeId,
                  counterparty: counterpartyWallet,
                });
              } catch (releaseErr: unknown) {
                const errMsg = releaseErr instanceof Error ? releaseErr.message : String(releaseErr);

                // AccountNotInitialized (3012 / 0xbc4) on the escrow account is
                // ambiguous — it can mean either:
                //   (a) buyer never called acceptTrade → trade was never funded
                //       (escrow PDA never existed), OR
                //   (b) escrow was ALREADY RELEASED on a previous click → escrow
                //       PDA was closed and rent reclaimed.
                // The DB currently being at payment_sent doesn't tell us which.
                //
                // Optimistically try the backend sync — the release PATCH is
                // idempotent and the server can verify on-chain truth from the
                // trade PDA (which still exists in either case). If the backend
                // confirms "already released" we mark the order complete; if it
                // refuses we fall back to the "buyer hasn't joined" message.
                const looksLikeAlreadyDone =
                  errMsg.includes('AccountNotInitialized') ||
                  errMsg.includes('0xbc4') ||
                  errMsg.includes('3012') ||
                  errMsg.includes('Released');

                if (looksLikeAlreadyDone) {
                  console.log('[Merchant] Escrow account missing — checking on-chain history for an actual ReleaseEscrow tx');
                  // Look up the real release tx hash from on-chain. If a
                  // ReleaseEscrow already ran successfully (race with a prior
                  // click, reconciliation worker, etc.), we'll find its
                  // signature and pass THAT to the backend sync — which is
                  // truthful + auditable, unlike the previous 'already-released'
                  // sentinel string. If nothing is found we treat it as the
                  // buyer-never-joined case (escrow never funded).
                  let onChainReleaseTxHash: string | null = null;
                  try {
                    const { findOnChainTradeOutcome } = await import('@/lib/solana/v2/findOnChainRelease');
                    const { findTradePda } = await import('@/lib/solana/v2/pdas');
                    const { PublicKey } = await import('@solana/web3.js');
                    if (order.escrowCreatorWallet && order.escrowTradeId) {
                      const [tradePda] = findTradePda(
                        new PublicKey(order.escrowCreatorWallet),
                        order.escrowTradeId,
                      );
                      const outcome = await findOnChainTradeOutcome(
                        solanaWallet.connection,
                        tradePda,
                      );
                      if (outcome.kind === 'released') {
                        onChainReleaseTxHash = outcome.signature;
                        console.log('[Merchant] Found on-chain ReleaseEscrow tx:', outcome.signature);
                      } else {
                        console.log('[Merchant] No on-chain release found, outcome:', outcome.kind);
                      }
                    }
                  } catch (lookupErr) {
                    console.warn('[Merchant] On-chain release lookup failed (non-fatal):', lookupErr);
                  }

                  if (onChainReleaseTxHash) {
                    try {
                      const syncRes = await fetchWithAuth(`/api/orders/${orderId}/escrow`, {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                          'Idempotency-Key': txAnchoredKey(onChainReleaseTxHash, 'release_escrow_sync'),
                        },
                        body: JSON.stringify({
                          tx_hash: onChainReleaseTxHash,
                          actor_type: 'merchant',
                          actor_id: merchantId,
                        }),
                      });
                      if (syncRes.ok) {
                        console.log('[Merchant] Backend confirmed release — marking order complete');
                        playSound('trade_complete');
                        addNotification('complete', `Order completed - ${order.amount} USDT released to buyer`, orderId);
                        await afterMutationReconcile(orderId, { status: 'completed' as const });
                        syncBalance();
                        return;
                      }
                      console.warn('[Merchant] Backend sync rejected even with verified on-chain tx');
                    } catch (syncErr) {
                      console.warn('[Merchant] Backend sync failed:', syncErr);
                    }
                  }
                }

                // Either not a "looks already done" signal, or the backend
                // sync rejected. Treat as the buyer-never-joined case.
                console.error('[Merchant] On-chain release failed, NOT completing DB:', errMsg);
                const isKnownCannotRelease = looksLikeAlreadyDone
                  || errMsg.includes('CannotRelease') || errMsg.includes('0x1780') || errMsg.includes('6016')
                  || (errMsg.includes('ConstraintRaw') && errMsg.includes('counterparty_ata'));
                addNotification(
                  'system',
                  isKnownCannotRelease
                    ? 'Release blocked: buyer has not joined the trade on-chain yet. Contact support to finalize — funds are safe and still escrowed.'
                    : `On-chain release failed: ${errMsg.slice(0, 200)}. Order stays in payment_sent until this is resolved.`,
                  orderId,
                );
                playSound('error');
                return; // abort; DB stays in payment_sent, admin can take over
              }

              if (releaseResult) {
                if (!releaseResult.success) {
                  console.error('[Merchant] Failed to release escrow:', releaseResult.error);
                  addNotification('system', `Failed to release escrow: ${releaseResult.error || 'Unknown error'}`, orderId);
                  playSound('error');
                  return;
                }
                releaseTxHash = releaseResult.txHash;
              }
            } else {
              // No on-chain escrow or mock escrow — release via server only
              releaseTxHash = `server-release-${Date.now()}`;
            }

            // Sync release with backend (escrow endpoint accepts payment_sent directly).
            // Release is a financial transition — Idempotency-Key required.
            // Anchor to the on-chain release signature so a network-retried
            // PATCH collapses on the backend instead of re-running release.
            const response = await fetchWithAuth(`/api/orders/${orderId}/escrow`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': txAnchoredKey(releaseTxHash, 'release_escrow'),
              },
              body: JSON.stringify({
                tx_hash: releaseTxHash,
                actor_type: 'merchant',
                actor_id: merchantId,
              }),
            });

            if (!response.ok) {
              const errorData = await response.json();
              console.error('[Merchant] Escrow release API failed:', errorData);
              addNotification('system', `Failed to complete order: ${errorData.error || 'Unknown error'}`, orderId);
              playSound('error');
              return;
            }

          }

          playSound('trade_complete');
          addNotification('complete', `Order completed - ${order.amount} USDT released to buyer`, orderId);
          await afterMutationReconcile(orderId, { status: "completed" as const });
          syncBalance();
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          console.error("Error confirming payment:", error);
          addNotification('system', `Failed to complete order: ${errMsg}`, orderId);
          playSound('error');
        } finally {
          setConfirmingOrderId(null);
        }
      },
      { variant: 'warning', confirmLabel: 'Confirm Payment' }
    );
  };

  // ═══════════════════════════════════════════════════════════════════
  // DIRECT ORDER CREATION (from ConfigPanel)
  // ═══════════════════════════════════════════════════════════════════
  const handleDirectOrderCreation = async (
    openTradeForm: { tradeType: 'buy' | 'sell'; cryptoAmount: string; paymentMethod: 'bank' | 'cash'; paymentMethodId?: string; spreadPreference: 'best' | 'fastest' | 'cheap'; expiryMinutes: 15 | 90 },
    setOpenTradeForm: React.Dispatch<React.SetStateAction<{ tradeType: 'buy' | 'sell'; cryptoAmount: string; paymentMethod: 'bank' | 'cash'; paymentMethodId: string | undefined; spreadPreference: 'best' | 'fastest' | 'cheap'; expiryMinutes: 15 | 90 }>>,
    tradeType?: 'buy' | 'sell',
    priorityFee?: number,
    pair: 'usdt_aed' | 'usdt_inr' = 'usdt_aed',
  ) => {
    if (!merchantId || isCreatingTrade) return;

    const effectiveTradeType = tradeType || openTradeForm.tradeType;

    // Wallet must be connected for BOTH buy and sell:
    //  - SELL: merchant locks USDT in escrow (needs wallet to sign)
    //  - BUY:  merchant receives USDT after the trade (needs wallet to receive)
    // Mirrors the same check used in acceptOrder() — error sound + notification
    // + opens the wallet modal so the merchant can connect.
    if (!solanaWallet.walletAddress) {
      playSound('error');
      addNotification(
        'system',
        `Please connect your wallet to place a ${effectiveTradeType} order.`,
      );
      setShowWalletModal(true);
      return;
    }

    setIsCreatingTrade(true);
    setCreateTradeError(null);

    try {
      if (effectiveTradeType === "sell") {
        // SELL order flow: Lock escrow first, then broadcast order for ANY merchant to accept
        if (effectiveBalance !== null && effectiveBalance < parseFloat(openTradeForm.cryptoAmount)) {
          addNotification('system', `Insufficient balance. You have ${effectiveBalance.toFixed(2)} USDT.`);
          setIsCreatingTrade(false);
          return;
        }

        // Store trade params for escrow locking — NO pre-matched counterparty
        (window as any).__pendingSellOrder = {
          merchantId,
          tradeType: effectiveTradeType,
          cryptoAmount: parseFloat(openTradeForm.cryptoAmount),
          paymentMethod: openTradeForm.paymentMethod,
          paymentMethodId: openTradeForm.paymentMethodId,
          spreadPreference: openTradeForm.spreadPreference,
          priorityFee: priorityFee || 0,
          pair,
        };

        // Resolve the corridor's actual currency + live rate. Previously this
        // block hardcoded `toCurrency: 'AED'` and `rate: 3.67` so an INR
        // merchant who clicked Lock Escrow saw "FIAT VALUE: AED 66.06" — the
        // EscrowLockModal reads `escrowOrder.toCurrency` directly, so the
        // wrong currency rendered no matter which corridor was selected.
        // Currency tracks the pair, and the rate comes from a 30s client
        // cache (clientPriceCache) — synchronous read so the modal opens
        // instantly. A background refresh fires when stale so the next
        // click sees fresh data; the hardcoded fallback only applies on a
        // cold cache, which matches the previous "API failed" branch (the
        // DB order uses the backend's authoritative rate either way).
        const fiatCurrency = pair === 'usdt_inr' ? 'INR' : 'AED';
        const fallbackRate = pair === 'usdt_inr' ? 92 : 3.67;
        const liveRate = getCachedPrice(pair) ?? fallbackRate;
        ensurePriceFresh(pair);

        // Create temporary order for escrow modal — counterparty is TBD
        const tempOrder: Order = {
          id: 'temp-' + Date.now(),
          user: 'Open Order',
          emoji: '📢',
          amount: parseFloat(openTradeForm.cryptoAmount),
          fromCurrency: 'USDT',
          toCurrency: fiatCurrency,
          rate: liveRate,
          total: parseFloat(openTradeForm.cryptoAmount) * liveRate,
          timestamp: new Date(),
          status: 'pending',
          expiresIn: 900,
          orderType: 'sell',
        };

        openEscrowModalForSell(tempOrder);

        setOpenTradeForm({
          tradeType: "sell",
          cryptoAmount: "",
          paymentMethod: "bank",
          paymentMethodId: undefined,
          spreadPreference: "fastest",
          expiryMinutes: 15,
        });

      } else {
        // BUY order flow: Create directly
        // Stable per-submission key. A retry within the same click attempt
        // (network blip, strict-mode double-effect) presents the SAME key
        // and collapses on the backend's idempotency_log; reset on success
        // so the next deliberate "Place order" click mints a fresh key.
        if (!directBuySubmitIdRef.current) directBuySubmitIdRef.current = newSubmitId();

        const res = await fetchWithAuth("/api/merchant/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Required by core-api /v1/merchant/orders. Without this header
            // the order create returns 400 with "Idempotency-Key header is
            // required for merchant order creation."
            "Idempotency-Key": directBuySubmitIdRef.current,
          },
          body: JSON.stringify({
            merchant_id: merchantId,
            type: effectiveTradeType,
            crypto_amount: parseFloat(openTradeForm.cryptoAmount),
            payment_method: openTradeForm.paymentMethod,
            spread_preference: openTradeForm.spreadPreference,
            priority_fee: priorityFee || 0,
            pair, // 'usdt_aed' | 'usdt_inr' — drives corridor + fiat_currency
          }),
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to create order");
        }

        if (data.data) {
          // Order committed — release the per-submission key.
          directBuySubmitIdRef.current = null;
          const newOrder = mapDbOrderToUI(data.data, merchantId);
          setOrders((prev: Order[]) => [newOrder, ...prev]);
          playSound('trade_complete');
        }

        setOpenTradeForm({
          tradeType: "sell",
          cryptoAmount: "",
          paymentMethod: "bank",
          paymentMethodId: undefined,
          spreadPreference: "fastest",
          expiryMinutes: 15,
        });
      }

    } catch (error) {
      console.error("Error creating order:", error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to create order';
      addNotification('system', errorMsg);
      playSound('error');
    } finally {
      setIsCreatingTrade(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // RETRY JOIN ESCROW ON-CHAIN
  // ═══════════════════════════════════════════════════════════════════
  const retryJoinEscrow = async (order: Order): Promise<boolean> => {
    if (!merchantId) return false;

    if (!solanaWallet.connected || !solanaWallet.walletAddress) {
      playSound('error');
      addNotification('system', 'Please connect your wallet first.', order.id);
      setShowWalletModal(true);
      return false;
    }

    if (!order.escrowCreatorWallet || order.escrowTradeId == null) {
      addNotification('system', 'Missing escrow details for on-chain join.', order.id);
      return false;
    }

    try {
      addNotification('system', 'Joining escrow on-chain... Please approve the transaction.', order.id);
      const result = await solanaWallet.acceptTrade({
        creatorPubkey: order.escrowCreatorWallet,
        tradeId: order.escrowTradeId,
      });

      if (!result.success) {
        addNotification('system', `Failed to join escrow: ${result.error}`, order.id);
        playSound('error');
        return false;
      }

      addNotification('system', 'Successfully joined escrow on-chain!', order.id);
      playSound('click');
      return true;
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('CannotAccept') || msg.includes('0x177d') || msg.includes('6013')) {
        addNotification('system', 'Already joined escrow on-chain.', order.id);
        return true;
      }
      if (msg.includes('AccountNotInitialized') || msg.includes('0xbc4') || msg.includes('3012')) {
        addNotification('system', 'Escrow does not exist on-chain. This order may have used mock escrow.', order.id);
        playSound('error');
        return false;
      }
      addNotification('system', `Failed to join escrow: ${msg}`, order.id);
      playSound('error');
      return false;
    }
  };

  return {
    // State
    markingDone,
    acceptingOrderId,
    confirmingOrderId,
    isCreatingTrade, setIsCreatingTrade,
    createTradeError, setCreateTradeError,

    // Actions
    acceptOrder,
    acceptWithSaed,
    retryJoinEscrow,
    signToClaimOrder,
    signAndProceed,
    markFiatPaymentSent,
    markPaymentSent,
    completeOrder,
    confirmPayment,
    handleDirectOrderCreation,
  };
}
