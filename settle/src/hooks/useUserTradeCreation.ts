"use client";

import { useEffect, useRef, useState } from "react";
import type { Screen, TradeType, TradePreference, PaymentMethod, Order, Offer, DbOrder } from "@/components/user/screens/types";
import { mapDbOrderToUI } from "@/components/user/screens/helpers";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { newSubmitId, txAnchoredKey } from '@/lib/api/idempotencyKeys';
import { showAlert } from '@/context/ModalContext';
import type { SelectedBankDetails } from '@/components/user/BankAccountSelector';
import type { PaymentMethodItem } from '@/components/user/PaymentMethodSelector';

interface UseUserTradeCreationParams {
  userId: string | null;
  setScreen: (s: Screen) => void;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setActiveOrderId: (id: string | null) => void;
  setPendingTradeData: (data: { amount: string; fiatAmount: string; type: TradeType; paymentMethod: PaymentMethod } | null) => void;
  solanaWallet: any;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  toast: any;
  setUserId: (id: string | null) => void;
  setShowWalletModal: (show: boolean) => void;
}

export function useUserTradeCreation({
  userId,
  setScreen,
  setOrders,
  setActiveOrderId,
  setPendingTradeData,
  solanaWallet,
  playSound,
  toast,
  setUserId,
  setShowWalletModal,
}: UseUserTradeCreationParams) {
  const [tradeType, setTradeType] = useState<TradeType>("buy");
  const [tradePreference, setTradePreference] = useState<TradePreference>("fast");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");
  const [amount, setAmount] = useState("");
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  // Initial fallback matches the default selectedPair below (INR ≈ 92, AED ≈ 3.67).
  // This prevents the home screen from briefly showing an AED-shaped number with an INR label.
  const [currentRate, setCurrentRate] = useState(92);
  const [selectedPair, setSelectedPair] = useState<'usdt_aed' | 'usdt_inr'>('usdt_inr');
  const [isLoading, setIsLoading] = useState(false);

  // Keep currentRate in sync with selectedPair: fetch the live rate whenever
  // the corridor changes (and on mount). This is the source of truth for the
  // home-screen rate label and the trade-creation conversion preview.
  useEffect(() => {
    let cancelled = false;
    fetchWithAuth(`/api/prices/current?pair=${selectedPair}`)
      .then((res) => res.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success && j.data?.price) setCurrentRate(j.data.price);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedPair]);

  // Escrow transaction state
  const [escrowTxStatus, setEscrowTxStatus] = useState<'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error'>('idle');
  const [escrowTxHash, setEscrowTxHash] = useState<string | null>(null);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  const [selectedBankDetails, setSelectedBankDetails] = useState<SelectedBankDetails | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodItem | null>(null);

  // Per-submission idempotency keys for the order-creation flows that have
  // no on-chain anchor (BUY orders that don't escrow first). Held in refs so
  // a network blip + user-driven retry (or a strict-mode double effect)
  // presents the SAME key to the backend and collapses on the server's
  // idempotency_log instead of double-creating an order. Reset on success
  // so the next deliberate "Submit" click mints a fresh key. Failed attempts
  // are NOT cached server-side (the idempotency record commits inside the
  // mutation transaction), so a retry of a 4xx/5xx with the same key still
  // runs fresh on core-api — no manual reset needed for those cases.
  const startSubmitIdRef = useRef<string | null>(null);
  const cashSubmitIdRef = useRef<string | null>(null);

  const startTrade = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      showAlert('Invalid Amount', 'Please enter a valid amount', 'warning');
      return;
    }

    if (!userId) {
      showAlert('Wallet Required', 'Please connect your wallet first', 'warning');
      console.error('[Order] No userId - user not authenticated');
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Order] Invalid userId format:', userId);
      showAlert('Session Error', 'Session error. Please reconnect your wallet.', 'error');
      localStorage.removeItem('blip_user');
      setUserId(null);
      setScreen('welcome');
      return;
    }

    // Sell orders (user receives fiat) require a selected payment method
    if (tradeType === 'sell' && !selectedPaymentMethod) {
      showAlert('Payment Method Required', 'Please select a payment method where you want to receive fiat.', 'warning');
      return;
    }

    setIsLoading(true);

    try {
      // Refresh corridor rate so the order's expected_rate matches what the
      // server will see. No offer lookup — broadcast model: order sits in
      // pending until any merchant claims it.
      let liveRate = currentRate;
      try {
        const priceRes = await fetchWithAuth(`/api/prices/current?pair=${selectedPair}`);
        const priceData = await priceRes.json();
        if (priceData?.success && priceData.data?.price) {
          liveRate = priceData.data.price;
          setCurrentRate(liveRate);
        }
      } catch { /* keep last known rate */ }

      // SELL flow — broadcast. User funds escrow without specifying a
      // counterparty (depositToEscrowOpen / fundEscrow). A merchant joins
      // later via acceptTrade.
      if (tradeType === "sell") {
        setSelectedOffer(null);
        setEscrowTxStatus('idle');
        setEscrowTxHash(null);
        setEscrowError(null);
        setScreen("escrow");
        setIsLoading(false);
        return;
      }

      // BUY flow — broadcast. No offer lookup; any merchant can claim later.
      // Buy orders require a connected wallet so the merchant can release escrow to the buyer
      if (!solanaWallet.walletAddress) {
        showAlert('Wallet Required', 'Please connect your Solana wallet before creating a buy order. The merchant needs your wallet address to release crypto to you.', 'warning');
        setIsLoading(false);
        return;
      }

      // Stable per-submission key. Reused across retries within this
      // attempt so a network blip + click-again or page-reload-mid-request
      // collapses on the backend's idempotency_log. Reset on success
      // (below) so a fresh "Submit" mints a new key.
      if (!startSubmitIdRef.current) startSubmitIdRef.current = newSubmitId();

      const orderRes = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Required by /api/orders POST: server-side dedup of accidental
          // double-clicks / network retries. Reuses startSubmitIdRef.current
          // (initialized just above on line 151) so any retry within the
          // same submit attempt sends the SAME key — server treats it as a
          // duplicate and returns the cached response. A fresh
          // generateIdempotencyKey() per call would defeat the dedup.
          'Idempotency-Key': startSubmitIdRef.current,
        },
        body: JSON.stringify({
          user_id: userId,
          crypto_amount: parseFloat(amount),
          type: 'buy',
          payment_method: paymentMethod,
          preference: tradePreference,
          buyer_wallet_address: solanaWallet.walletAddress,
          pair: selectedPair,
          expected_rate: liveRate,
        }),
      });
      if (!orderRes.ok) {
        const orderData = await orderRes.json().catch(() => ({}));
        const errorDetails = orderData.details ? `\n${orderData.details.join('\n')}` : '';
        const errorMsg = (orderData.error || 'Failed to create order') + errorDetails;
        console.error('Failed to create order:', errorMsg, orderData);

        if (orderData.details?.includes('User not found')) {
          showAlert('Session Expired', 'Your session has expired. Please reconnect your wallet.', 'error');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setScreen('welcome');
          playSound('error');
          setIsLoading(false);
          return;
        }

        showAlert('Order Failed', errorMsg, 'error');
        playSound('error');
        setIsLoading(false);
        return;
      }
      const orderData = await orderRes.json();

      if (!orderData.success) {
        const errorMsg = orderData.error || 'Failed to create order';
        console.error('Failed to create order:', errorMsg);
        showAlert('Order Failed', errorMsg, 'error');
        playSound('error');
        setIsLoading(false);
        return;
      }

      const newOrder = mapDbOrderToUI(orderData.data);
      if (newOrder) {
        // Order committed — release the per-submission key so the next
        // deliberate "Submit" click mints a fresh one.
        startSubmitIdRef.current = null;
        setOrders(prev => [...prev, newOrder]);
        setActiveOrderId(newOrder.id);
        setPendingTradeData({ amount, fiatAmount: (parseFloat(amount) * liveRate).toFixed(2), type: tradeType, paymentMethod });
        setScreen("matching");
        setAmount("");
        playSound('trade_start');
      } else {
        showAlert('Error', 'Failed to process order data', 'error');
        playSound('error');
      }
    } catch (err) {
      console.error('Failed to start trade:', err);
      showAlert('Error', 'Failed to create order', 'error');
      playSound('error');
    }

    setIsLoading(false);
  };

  const confirmCashOrder = async () => {
    if (!selectedOffer || !amount) {
      showAlert('Error', 'Missing order details', 'error');
      return;
    }

    // Guard: SELL orders must go through escrow screen, not cash-confirm
    if (tradeType === 'sell') {
      showAlert('Error', 'SELL orders require escrow. Please use the escrow flow.', 'error');
      return;
    }

    if (!userId) {
      showAlert('Wallet Required', 'Please connect your wallet first', 'warning');
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Order] Invalid userId format:', userId);
      showAlert('Session Error', 'Session error. Please reconnect your wallet.', 'error');
      localStorage.removeItem('blip_user');
      setUserId(null);
      setScreen('welcome');
      return;
    }

    setIsLoading(true);

    // Cash buy orders also require a connected wallet for escrow release
    if (tradeType === 'buy' && !solanaWallet.walletAddress) {
      showAlert('Wallet Required', 'Please connect your Solana wallet before creating a buy order. The merchant needs your wallet address to release crypto to you.', 'warning');
      setIsLoading(false);
      return;
    }

    try {
      // Stable per-submission key — see startSubmitIdRef comment above for
      // the rationale (collapses retries / strict-mode double-effects).
      if (!cashSubmitIdRef.current) cashSubmitIdRef.current = newSubmitId();

      const orderRes = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': cashSubmitIdRef.current,
        },
        body: JSON.stringify({
          user_id: userId,
          offer_id: selectedOffer.id,
          crypto_amount: parseFloat(amount),
          type: tradeType,
          payment_method: 'cash',
          preference: tradePreference,
          buyer_wallet_address: tradeType === 'buy' ? solanaWallet.walletAddress : undefined,
        }),
      });
      if (!orderRes.ok) {
        const orderData = await orderRes.json().catch(() => ({}));
        const errorDetails = orderData.details ? `\n${orderData.details.join('\n')}` : '';
        const errorMsg = (orderData.error || 'Failed to create order') + errorDetails;
        console.error('Failed to create cash order:', errorMsg, orderData);

        if (orderData.details?.includes('User not found')) {
          showAlert('Session Expired', 'Your session has expired. Please reconnect your wallet.', 'error');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setScreen('welcome');
          setIsLoading(false);
          return;
        }

        showAlert('Order Failed', errorMsg, 'error');
        setIsLoading(false);
        return;
      }
      const orderData = await orderRes.json();

      if (!orderData.success) {
        const errorMsg = orderData.error || 'Failed to create order';
        console.error('Failed to create cash order:', errorMsg);
        showAlert('Order Failed', errorMsg, 'error');
        setIsLoading(false);
        return;
      }

      const newOrder = mapDbOrderToUI(orderData.data);
      if (newOrder) {
        // Order committed — release the per-submission key so the next
        // deliberate "Submit" click mints a fresh one.
        cashSubmitIdRef.current = null;
        setOrders(prev => [...prev, newOrder]);
        setActiveOrderId(newOrder.id);
        setAmount("");
        setSelectedOffer(null);
        setScreen("order");
      } else {
        showAlert('Error', 'Failed to process order data', 'error');
      }
    } catch (err) {
      console.error('Failed to create cash order:', err);
      showAlert('Network Error', 'Network error. Please try again.', 'error');
    }

    setIsLoading(false);
  };

  const confirmEscrow = async () => {
    console.log('[Escrow] confirmEscrow called', { amount, userId });
    if (!amount) {
      console.log('[Escrow] Missing amount');
      showAlert('Error', 'Missing order amount', 'error');
      return;
    }

    if (!userId) {
      console.log('[Escrow] No userId - user not authenticated');
      showAlert('Wallet Required', 'Please connect your wallet first', 'warning');
      return;
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      console.error('[Escrow] Invalid userId format:', userId);
      showAlert('Session Error', 'Session error. Please reconnect your wallet.', 'error');
      localStorage.removeItem('blip_user');
      setUserId(null);
      setScreen('welcome');
      return;
    }

    setEscrowError(null);
    setEscrowTxHash(null);

    console.log('[Escrow] Wallet connected:', solanaWallet.connected);
    if (!solanaWallet.connected) {
      console.log('[Escrow] Opening wallet modal');
      setEscrowTxStatus('connecting');
      setShowWalletModal(true);
      return;
    }

    const amountNum = parseFloat(amount);
    console.log('[Escrow] Balance check:', { usdtBalance: solanaWallet.usdtBalance, amountNeeded: amountNum });

    if (solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance < amountNum) {
      setEscrowError(`Insufficient USDT balance. You have ${solanaWallet.usdtBalance.toFixed(2)} USDT but need ${amountNum} USDT.`);
      setEscrowTxStatus('error');
      return;
    }

    if (solanaWallet.usdtBalance === null) {
      console.log('[Escrow] Balance still loading, refreshing...');
      await solanaWallet.refreshBalances();
      await new Promise(r => setTimeout(r, 500));
      if (solanaWallet.usdtBalance !== null && solanaWallet.usdtBalance < amountNum) {
        setEscrowError(`Insufficient USDT balance. You have ${solanaWallet.usdtBalance.toFixed(2)} USDT but need ${amountNum} USDT.`);
        setEscrowTxStatus('error');
        return;
      }
    }

    setIsLoading(true);
    setEscrowTxStatus('signing');
    console.log('[Escrow] Starting escrow transaction');

    try {
      console.log('[Escrow] User wallet:', solanaWallet.walletAddress);
      console.log('[Escrow] Program ready:', solanaWallet.programReady);
      console.log('[Escrow] Wallet state before escrow:', {
        connected: solanaWallet.connected,
        walletAddress: solanaWallet.walletAddress,
        hasPublicKey: !!solanaWallet.publicKey,
      });

      // Pre-generate the trade_id we'll use on-chain. Breadcrumb gives the
      // sweep script a recoverable trail if we crash between sign+confirm
      // and the settle POST.
      const userTradeId = Date.now();
      const breadcrumbKey = `blip_user_pending_escrow_${userTradeId}`;
      try {
        localStorage.setItem(
          breadcrumbKey,
          JSON.stringify({
            tradeId: userTradeId,
            amount: amountNum,
            actorWallet: solanaWallet.walletAddress,
            timestamp: Date.now(),
          }),
        );
      } catch { /* non-fatal */ }

      console.log('[Escrow] Calling depositToEscrowOpen (broadcast) with:', {
        amount: amountNum,
        tradeId: userTradeId,
      });

      let escrowResult: { txHash: string; success: boolean; tradePda?: string; escrowPda?: string; tradeId?: number };

      try {
        escrowResult = await solanaWallet.depositToEscrowOpen({
          amount: amountNum,
          tradeId: userTradeId,
          side: 'sell',
        });
        console.log('[Escrow] depositToEscrow result:', escrowResult);

        if (!escrowResult.success) {
          throw new Error('Transaction failed');
        }
        // Success — drop the breadcrumb. The order will be created next,
        // and from that point the normal flow takes over.
        try { localStorage.removeItem(breadcrumbKey); } catch { /* */ }
      } catch (escrowErr: any) {
        console.error('[Escrow] On-chain escrow failed:', escrowErr);
        console.error('[Escrow] Error message:', escrowErr?.message);
        console.error('[Escrow] Error stack:', escrowErr?.stack?.split('\n').slice(0, 3).join('\n'));

        // Soften the messaging when this is the well-known indexing-lag
        // pattern. The on-chain tx may have actually landed; the sweep
        // script can still recover the funds.
        const errMsg = escrowErr?.message || '';
        const isExpiry =
          errMsg.includes('block height exceeded') ||
          errMsg.includes('has expired') ||
          errMsg.includes('expired') ||
          errMsg.includes('confirmation timed out');

        if (errMsg.includes('program=false')) {
          console.error('[Escrow] CRITICAL: Anchor program is null - wallet may not be fully connected');
          setEscrowError('Wallet not fully connected. Please disconnect and reconnect your wallet, then try again.');
        } else if (errMsg.includes('User rejected')) {
          setEscrowError('Transaction was rejected. Please approve the transaction in your wallet.');
          // User actively cancelled — drop the breadcrumb, no orphan possible.
          try { localStorage.removeItem(breadcrumbKey); } catch { /* */ }
        } else if (errMsg.includes('Insufficient')) {
          setEscrowError(escrowErr.message);
          try { localStorage.removeItem(breadcrumbKey); } catch { /* */ }
        } else if (isExpiry) {
          // The breadcrumb stays — sweep can recover if the tx actually landed.
          setEscrowError(
            `Network was slow to confirm your transaction. Trade ID ${userTradeId} is recorded — if your USDT was debited on-chain, the system will recover it automatically. Do NOT click Lock again. Wait 1 minute, then refresh.`,
          );
        } else {
          setEscrowError(`Escrow failed: ${escrowErr?.message || 'Unknown error'}. Please try again.`);
        }
        setEscrowTxStatus('error');
        setIsLoading(false);
        return;
      }

      setEscrowTxHash(escrowResult.txHash);
      setEscrowTxStatus('confirming');

      setEscrowTxStatus('recording');

      // Build the order-creation payload once so the original call and any
      // later orphan-recovery retry use byte-identical input. The body lives
      // in localStorage under a tx-hash key so a browser crash, network drop,
      // or backend 5xx between "escrow funded on-chain" and "order written
      // to DB" can self-heal on the next app load.
      const orderPayload = {
        user_id: userId,
        crypto_amount: amountNum,
        type: 'sell' as const,
        payment_method: paymentMethod,
        preference: tradePreference,
        pair: selectedPair,
        // CRITICAL: Include escrow_tx_hash so backend creates order as 'escrowed' (escrow-first model)
        escrow_tx_hash: escrowResult.txHash,
        escrow_trade_pda: escrowResult.tradePda,
        escrow_pda: escrowResult.escrowPda,
        escrow_trade_id: escrowResult.tradeId,
        escrow_creator_wallet: solanaWallet.walletAddress,
        user_bank_account: selectedBankDetails ? JSON.stringify(selectedBankDetails) : undefined,
        payment_method_id: selectedPaymentMethod?.id,
      };
      const idempotencyKey = txAnchoredKey(escrowResult.txHash, 'create_sell_order');
      const orphanKey = `blip_orphan_sell_${escrowResult.txHash}`;

      // Persist BEFORE the network call. If anything below throws or the
      // browser tab dies, the orphan-recovery hook will retry on next mount.
      try {
        localStorage.setItem(orphanKey, JSON.stringify({
          payload: orderPayload,
          idempotencyKey,
          timestamp: Date.now(),
        }));
      } catch {}

      // Retry up to 3× with backoff (1s, 3s) — idempotent because of the
      // tx-anchored key. Transient 5xx / network blips no longer strand
      // on-chain escrow.
      let orderRes: Response | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let orderData: any = null;
      let lastNetErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          orderRes = await fetchWithAuth('/api/orders', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Anchor the key to the on-chain escrow signature so retries
              // collapse server-side instead of duplicating orders.
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify(orderPayload),
          });
          orderData = await orderRes.json();
          if (orderRes.ok && orderData?.success) break;
          // Don't burn retries on hard validation errors (4xx); only 5xx is worth retrying.
          if (orderRes.status >= 400 && orderRes.status < 500) break;
        } catch (e) {
          lastNetErr = e;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, attempt === 0 ? 1000 : 3000));
      }

      if (!orderRes || !orderRes.ok || !orderData?.success) {
        if (orderData?.details?.includes('User not found')) {
          setEscrowError(`Session expired. Your funds are safe — TX: ${escrowResult.txHash}. Reconnect wallet; the order will be created automatically.`);
          setEscrowTxStatus('error');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setIsLoading(false);
          return;
        }
        setEscrowError(
          `Order sync pending. Funds are locked on-chain (TX: ${escrowResult.txHash.slice(0, 8)}…). ` +
            `We'll auto-recover on next reload.${lastNetErr ? '' : ''}`,
        );
        setEscrowTxStatus('error');
        setIsLoading(false);
        // Leave orphanKey in localStorage — recovery hook will retry.
        return;
      }

      // Success — clear orphan record.
      try { localStorage.removeItem(orphanKey); } catch {}

      // Step 2: Record escrow on the newly created order
      const escrowRes = await fetchWithAuth(`/api/orders/${orderData.data.id}/escrow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_hash: escrowResult.txHash,
          actor_type: 'user',
          actor_id: userId,
          escrow_address: solanaWallet.walletAddress,
          escrow_trade_id: escrowResult.tradeId,
          escrow_trade_pda: escrowResult.tradePda,
          escrow_pda: escrowResult.escrowPda,
          escrow_creator_wallet: solanaWallet.walletAddress,
        }),
      });

      setEscrowTxStatus('success');
      toast.showEscrowLocked(amount);

      let finalOrderData = orderData.data;
      if (escrowRes.ok) {
        const escrowData = await escrowRes.json();
        if (escrowData.success && escrowData.data) {
          finalOrderData = escrowData.data;
        }
      } else {
        console.warn('Failed to record escrow, but order was created');
        finalOrderData = { ...finalOrderData, status: 'escrowed', escrow_tx_hash: escrowResult.txHash };
      }

      const newOrder = mapDbOrderToUI(finalOrderData);
      if (newOrder) {
        setOrders(prev => [...prev, newOrder]);
        setActiveOrderId(newOrder.id);
      }
    } catch (err) {
      console.error('Escrow failed:', err);
      setEscrowError(err instanceof Error ? err.message : 'Transaction failed. Please try again.');
      setEscrowTxStatus('error');
    }

    setIsLoading(false);
  };

  return {
    tradeType, setTradeType,
    tradePreference, setTradePreference,
    paymentMethod, setPaymentMethod,
    amount, setAmount,
    selectedOffer, setSelectedOffer,
    currentRate, setCurrentRate,
    selectedPair, setSelectedPair,
    isLoading, setIsLoading,
    escrowTxStatus, setEscrowTxStatus,
    escrowTxHash,
    escrowError, setEscrowError,
    selectedBankDetails, setSelectedBankDetails,
    selectedPaymentMethod, setSelectedPaymentMethod,
    startTrade,
    confirmCashOrder,
    confirmEscrow,
  };
}
