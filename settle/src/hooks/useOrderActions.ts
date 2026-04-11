"use client";

import { useState, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, DbOrder, Notification } from "@/types/merchant";
import { mapDbOrderToUI } from "@/lib/orders/mappers";
import { fetchWithAuth, generateIdempotencyKey } from '@/lib/api/fetchWithAuth';
import { isValidSolanaAddress } from '@/lib/validation/solana';
import { showConfirm } from '@/context/ModalContext';

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
    if (!merchantId || !solanaWallet.usdtBalance) return;
    try {
      await solanaWallet.refreshBalances();
      const balance = solanaWallet.usdtBalance;
      if (balance != null) {
        await fetchWithAuth('/api/merchant/sync-balance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ merchant_id: merchantId, balance }),
        });
      }
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
        const actionBody: Record<string, unknown> = {
          action: iAmAssignedMerchant ? 'SEND_PAYMENT' : 'CLAIM',
          actor_type: 'merchant',
          actor_id: merchantId,
        };
        if (isValidSolanaAddress(solanaWallet.walletAddress)) {
          actionBody.acceptor_wallet_address = solanaWallet.walletAddress;
        }
        acceptRes = await fetchWithAuth(`/api/orders/${order.id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
        console.error("Failed to accept order:", acceptRes.status, errorMsg);
        addNotification('system', `Failed to accept order: ${errorMsg}`, order.id);
        playSound('error');
        return;
      }
      const acceptData = await acceptRes.json();

      if (!acceptData.success) {
        console.error("Failed to accept order:", acceptData.error);
        addNotification('system', `Failed to accept order: ${acceptData.error}`, order.id);
        playSound('error');
        return;
      }

      const acceptRole = isBuyOrder ? 'seller' : 'buyer';
      const nextStepMsg = hasOnChainEscrow
        ? 'Order claimed! Send the fiat payment and click "I\'ve Paid".'
        : acceptRole === 'seller'
          ? 'Now lock your USDC in escrow to proceed.'
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
      const signature = Buffer.from(signatureBytes).toString('base64');

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
        headers: { "Content-Type": "application/json", "Idempotency-Key": generateIdempotencyKey() },
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

      // Include wallet address for auto-claim scenarios
      if (isValidSolanaAddress(solanaWallet.walletAddress)) {
        actionBody.acceptor_wallet_address = solanaWallet.walletAddress;
      }

      const res = await fetchWithAuth(`/api/orders/${order.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json", "Idempotency-Key": generateIdempotencyKey() },
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
        headers: { "Content-Type": "application/json", "Idempotency-Key": generateIdempotencyKey() },
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

    // Safety: show confirmation dialog before proceeding
    showConfirm(
      'Confirm Payment Received',
      `I confirm I have received the fiat payment of ${order.total ? `AED ${Math.round(order.total).toLocaleString()}` : `${order.amount} USDC worth`}. This will release escrow to the buyer and cannot be reversed.`,
      async () => {
        setConfirmingOrderId(orderId);
        try {
          let releaseTxHash: string = `server-release-fallback-${Date.now()}`;

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
                // On-chain release failed — fall back to server-side completion
                // CannotRelease (6016/0x1780): trade not in Locked state (buyer never joined on-chain)
                if (errMsg.includes('AccountNotInitialized') || errMsg.includes('0xbc4') || errMsg.includes('3012')
                    || errMsg.includes('CannotRelease') || errMsg.includes('0x1780') || errMsg.includes('6016')
                    || (errMsg.includes('ConstraintRaw') && errMsg.includes('counterparty_ata'))) {
                  console.warn('[Merchant] On-chain release failed, falling back to server-side completion:', errMsg);
                  addNotification('system', 'On-chain release skipped (buyer not joined). Completing via server.', orderId);
                  releaseTxHash = `server-release-fallback-${Date.now()}`;
                } else {
                  throw releaseErr;
                }
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

            // Sync release with backend (escrow endpoint accepts payment_sent directly)
            const response = await fetchWithAuth(`/api/orders/${orderId}/escrow`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
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
    openTradeForm: { tradeType: 'buy' | 'sell'; cryptoAmount: string; paymentMethod: 'bank' | 'cash'; spreadPreference: 'best' | 'fastest' | 'cheap'; expiryMinutes: 15 | 90 },
    setOpenTradeForm: (form: { tradeType: 'buy' | 'sell'; cryptoAmount: string; paymentMethod: 'bank' | 'cash'; spreadPreference: 'best' | 'fastest' | 'cheap'; expiryMinutes: 15 | 90 }) => void,
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
          addNotification('system', `Insufficient balance. You have ${effectiveBalance.toFixed(2)} USDC.`);
          setIsCreatingTrade(false);
          return;
        }

        // Store trade params for escrow locking — NO pre-matched counterparty
        (window as any).__pendingSellOrder = {
          merchantId,
          tradeType: effectiveTradeType,
          cryptoAmount: parseFloat(openTradeForm.cryptoAmount),
          paymentMethod: openTradeForm.paymentMethod,
          spreadPreference: openTradeForm.spreadPreference,
          priorityFee: priorityFee || 0,
          pair,
        };

        // Create temporary order for escrow modal — counterparty is TBD
        const tempOrder: Order = {
          id: 'temp-' + Date.now(),
          user: 'Open Order',
          emoji: '📢',
          amount: parseFloat(openTradeForm.cryptoAmount),
          fromCurrency: 'USDC',
          toCurrency: 'AED',
          rate: 3.67,
          total: parseFloat(openTradeForm.cryptoAmount) * 3.67,
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
          spreadPreference: "fastest",
          expiryMinutes: 15,
        });

      } else {
        // BUY order flow: Create directly
        const res = await fetchWithAuth("/api/merchant/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
          const newOrder = mapDbOrderToUI(data.data, merchantId);
          setOrders((prev: Order[]) => [newOrder, ...prev]);
          playSound('trade_complete');
        }

        setOpenTradeForm({
          tradeType: "sell",
          cryptoAmount: "",
          paymentMethod: "bank",
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
