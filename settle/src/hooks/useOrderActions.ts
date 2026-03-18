"use client";

import { useState, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, DbOrder, Notification } from "@/types/merchant";
import { mapDbOrderToUI } from "@/lib/orders/mappers";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

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
      addNotification('system', 'Please connect your wallet first to accept orders.', order.id);
      setShowWalletModal(true);
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

      // Build the request body
      const targetStatus = "accepted";
      const requestBody: Record<string, unknown> = {
        status: targetStatus,
        actor_type: "merchant",
        actor_id: merchantId,
      };

      // Include wallet address if connected (skip mock addresses that fail Solana validation)
      if (solanaWallet.walletAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaWallet.walletAddress)) {
        requestBody.acceptor_wallet_address = solanaWallet.walletAddress;
      }

      const acceptRes = await fetchWithAuth(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
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
      handleOpenChat(order);
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
  // SIGN TO CLAIM ORDER (buyer claims M2M escrowed order)
  // ═══════════════════════════════════════════════════════════════════
  const signToClaimOrder = async (order: Order) => {
    if (!merchantId) return;

    if (!solanaWallet.connected) {
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
      const signature = Buffer.from(signatureBytes).toString('base64');

      const claimBody: Record<string, string> = {
          status: "payment_pending",
          actor_type: "merchant",
          actor_id: merchantId,
      };
      if (solanaWallet.walletAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaWallet.walletAddress)) {
        claimBody.acceptor_wallet_address = solanaWallet.walletAddress;
        claimBody.acceptor_wallet_signature = signature;
      }

      const res = await fetchWithAuth(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claimBody),
      });

      const responseData = await res.json().catch(() => ({}));

      if (!res.ok) {
        addNotification('system', `Failed to claim order: ${responseData.error || 'Unknown error'}`, order.id);
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
        console.error("Error signing:", error);
        addNotification('system', 'Failed to sign. Please try again.');
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
      if (solanaWallet.walletAddress && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(solanaWallet.walletAddress)) {
        proceedBody.acceptor_wallet_address = solanaWallet.walletAddress;
        proceedBody.acceptor_wallet_signature = signature;
      }

      const res = await fetchWithAuth(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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
  // MARK FIAT PAYMENT SENT
  // ═══════════════════════════════════════════════════════════════════
  const markFiatPaymentSent = async (order: Order) => {
    if (!merchantId) return;
    setMarkingDone(true);

    try {
      const res = await fetchWithAuth(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "payment_sent",
          actor_type: "merchant",
          actor_id: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          playSound('click');
          addNotification('system', `Payment marked as sent. Waiting for seller to release escrow.`, order.id);
          await afterMutationReconcile(order.id, { status: "escrow" as const });
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        addNotification('system', `Failed: ${errorData.error || 'Unknown error'}`, order.id);
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
    setConfirmingOrderId(orderId);

    const order = orders.find(o => o.id === orderId);
    if (!order) {
      console.error("Order not found:", orderId);
      return;
    }

    try {
      let releaseTxHash: string;

      if (order.orderType === 'buy' || order.orderType === 'sell') {
        if (order.escrowTradeId && order.escrowCreatorWallet && order.userWallet) {
          const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
          const isValidUserWallet = order.userWallet && base58Regex.test(order.userWallet);

          if (!solanaWallet.connected) {
            addNotification('system', 'Please connect your wallet to release escrow.', orderId);
            setShowWalletModal(true);
            playSound('error');
            return;
          }

          if (!isValidUserWallet) {
            addNotification('system', 'Invalid buyer wallet address. Cannot release escrow.', orderId);
            playSound('error');
            return;
          }

          let releaseResult;
          try {
            releaseResult = await solanaWallet.releaseEscrow({
              creatorPubkey: order.escrowCreatorWallet,
              tradeId: order.escrowTradeId,
              counterparty: order.userWallet,
            });
          } catch (releaseErr: unknown) {
            const errMsg = releaseErr instanceof Error ? releaseErr.message : String(releaseErr);
            if (errMsg.includes('ConstraintRaw') && errMsg.includes('counterparty_ata')) {
              addNotification('system', 'Buyer has not joined the escrow on-chain yet. Ask the buyer to connect their wallet and view this order.', orderId);
              playSound('error');
              return;
            }
            throw releaseErr;
          }

          if (!releaseResult.success) {
            console.error('[Merchant] Failed to release escrow:', releaseResult.error);
            addNotification('system', `Failed to release escrow: ${releaseResult.error || 'Unknown error'}`, orderId);
            playSound('error');
            return;
          }

          releaseTxHash = releaseResult.txHash;
        } else {
          addNotification('system', 'Missing escrow details. Cannot release.', orderId);
          playSound('error');
          return;
        }

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
      addNotification('complete', `Order completed - ${order.amount} USDC released to buyer`, orderId);
      await afterMutationReconcile(orderId, { status: "completed" as const });
    } catch (error) {
      console.error("Error confirming payment:", error);
      addNotification('system', 'Failed to complete order. Please try again.', orderId);
      playSound('error');
    } finally {
      setConfirmingOrderId(null);
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // DIRECT ORDER CREATION (from ConfigPanel)
  // ═══════════════════════════════════════════════════════════════════
  const handleDirectOrderCreation = async (
    openTradeForm: { tradeType: 'buy' | 'sell'; cryptoAmount: string; paymentMethod: 'bank' | 'cash'; spreadPreference: 'best' | 'fastest' | 'cheap'; expiryMinutes: 15 | 90 },
    setOpenTradeForm: (form: { tradeType: 'buy' | 'sell'; cryptoAmount: string; paymentMethod: 'bank' | 'cash'; spreadPreference: 'best' | 'fastest' | 'cheap'; expiryMinutes: 15 | 90 }) => void,
    tradeType?: 'buy' | 'sell',
    priorityFee?: number,
  ) => {
    if (!merchantId || isCreatingTrade) return;

    const effectiveTradeType = tradeType || openTradeForm.tradeType;

    setIsCreatingTrade(true);
    setCreateTradeError(null);

    try {
      if (effectiveTradeType === "sell") {
        // SELL order flow: Lock escrow first, then create order
        if (effectiveBalance !== null && effectiveBalance < parseFloat(openTradeForm.cryptoAmount)) {
          addNotification('system', `Insufficient balance. You have ${effectiveBalance.toFixed(2)} USDC.`);
          setIsCreatingTrade(false);
          return;
        }

        const offerParams = new URLSearchParams({
          amount: openTradeForm.cryptoAmount,
          type: 'buy',
          payment_method: openTradeForm.paymentMethod,
          exclude_merchant: merchantId,
        });
        const offerRes = await fetchWithAuth(`/api/offers?${offerParams}`);
        const offerData = await offerRes.json();

        let matchedOffer: { id: string; merchant?: { wallet_address?: string; display_name?: string } } | null = null;
        if (offerRes.ok && offerData.success && offerData.data) {
          matchedOffer = offerData.data;
        }

        // Validate counterparty wallet (skip in embedded wallet mode)
        if (!IS_EMBEDDED_WALLET) {
          const counterpartyWallet = matchedOffer?.merchant?.wallet_address;
          const isValidWallet = counterpartyWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(counterpartyWallet);

          if (!isValidWallet) {
            addNotification('system', 'No matching merchant with wallet found. Try a different amount.');
            setIsCreatingTrade(false);
            return;
          }
        }

        // Store trade params for manual escrow locking
        (window as any).__pendingSellOrder = {
          merchantId,
          tradeType: effectiveTradeType,
          cryptoAmount: parseFloat(openTradeForm.cryptoAmount),
          paymentMethod: openTradeForm.paymentMethod,
          spreadPreference: openTradeForm.spreadPreference,
          priorityFee: priorityFee || 0,
          matchedOfferId: matchedOffer?.id,
          counterpartyWallet: matchedOffer?.merchant?.wallet_address,
        };

        // Create temporary order for escrow modal
        const tempOrder: Order = {
          id: 'temp-' + Date.now(),
          user: matchedOffer?.merchant?.display_name || 'Merchant',
          emoji: '🏪',
          amount: parseFloat(openTradeForm.cryptoAmount),
          fromCurrency: 'USDC',
          toCurrency: 'AED',
          rate: 3.67,
          total: parseFloat(openTradeForm.cryptoAmount) * 3.67,
          timestamp: new Date(),
          status: 'pending',
          expiresIn: 900,
          orderType: 'sell',
          userWallet: matchedOffer?.merchant?.wallet_address,
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
          addNotification('order', `Buy order created for ${parseFloat(openTradeForm.cryptoAmount)} USDC`, data.data?.id);
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
