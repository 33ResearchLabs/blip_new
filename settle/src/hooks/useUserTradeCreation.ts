"use client";

import { useState } from "react";
import type { Screen, TradeType, TradePreference, PaymentMethod, Order, Offer, DbOrder } from "@/components/user/screens/types";
import { mapDbOrderToUI } from "@/components/user/screens/helpers";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
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
  const [currentRate, setCurrentRate] = useState(3.67);
  const [selectedPair, setSelectedPair] = useState<'usdt_aed' | 'usdt_inr'>('usdt_aed');
  const [isLoading, setIsLoading] = useState(false);

  // Escrow transaction state
  const [escrowTxStatus, setEscrowTxStatus] = useState<'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error'>('idle');
  const [escrowTxHash, setEscrowTxHash] = useState<string | null>(null);
  const [escrowError, setEscrowError] = useState<string | null>(null);
  const [selectedBankDetails, setSelectedBankDetails] = useState<SelectedBankDetails | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<PaymentMethodItem | null>(null);

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
      const offerType = tradeType === 'buy' ? 'sell' : 'buy';
      const params = new URLSearchParams({
        amount: amount,
        type: offerType,
        payment_method: paymentMethod,
        preference: tradePreference,
        pair: selectedPair,
      });
      const offerRes = await fetchWithAuth(`/api/offers?${params}`);
      if (!offerRes.ok) {
        const errorMsg = `Server error (${offerRes.status})`;
        console.error('Failed to fetch offers:', errorMsg);
        showAlert('No Offers', 'No offers available for this amount and payment method', 'warning');
        setIsLoading(false);
        return;
      }
      const offerData = await offerRes.json();

      if (!offerData.success || !offerData.data) {
        const errorMsg = offerData.error || 'No offers available for this amount and payment method';
        console.error('Failed to fetch offers:', errorMsg);
        showAlert('Error', errorMsg, 'error');
        setIsLoading(false);
        return;
      }

      const offer = offerData.data;

      // Use corridor rate for the selected pair (admin-set price), not the offer's AED rate
      if (selectedPair !== 'usdt_aed') {
        try {
          const priceRes = await fetchWithAuth(`/api/prices/current?pair=${selectedPair}`);
          const priceData = await priceRes.json();
          if (priceData?.success && priceData.data?.price) {
            setCurrentRate(priceData.data.price);
          } else {
            setCurrentRate(parseFloat(offer.rate));
          }
        } catch {
          setCurrentRate(parseFloat(offer.rate));
        }
      } else {
        setCurrentRate(parseFloat(offer.rate));
      }

      // SELL orders MUST lock escrow first (escrow-first model), regardless of payment method.
      // Route to escrow screen before anything else.
      if (tradeType === "sell") {
        const merchantWallet = offer?.merchant?.wallet_address;
        const isValidSolanaAddress = merchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet);
        if (!isValidSolanaAddress) {
          console.error('[Trade] Merchant has no wallet address:', offer?.merchant?.display_name);
          showAlert('Wallet Not Linked', 'This merchant has not linked their Solana wallet yet. Please try again later or choose a different amount to match with another merchant.', 'warning');
          setIsLoading(false);
          return;
        }
        setSelectedOffer(offer);
        setEscrowTxStatus('idle');
        setEscrowTxHash(null);
        setEscrowError(null);
        setScreen("escrow");
        setIsLoading(false);
        return;
      }

      // BUY cash orders go to cash-confirm screen (no escrow needed from buyer)
      if (paymentMethod === "cash") {
        setSelectedOffer(offer);
        setScreen("cash-confirm");
        setIsLoading(false);
        return;
      }

      // Buy orders require a connected wallet so the merchant can release escrow to the buyer
      if (!solanaWallet.walletAddress) {
        showAlert('Wallet Required', 'Please connect your Solana wallet before creating a buy order. The merchant needs your wallet address to release crypto to you.', 'warning');
        setIsLoading(false);
        return;
      }

      const orderRes = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          offer_id: offer.id,
          crypto_amount: parseFloat(amount),
          type: 'buy',
          payment_method: paymentMethod,
          preference: tradePreference,
          buyer_wallet_address: solanaWallet.walletAddress,
          pair: selectedPair,
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
        setOrders(prev => [...prev, newOrder]);
        setActiveOrderId(newOrder.id);
        setPendingTradeData({ amount, fiatAmount: (parseFloat(amount) * parseFloat(offer.rate)).toFixed(2), type: tradeType, paymentMethod });
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
      const orderRes = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    console.log('[Escrow] confirmEscrow called', { selectedOffer, amount, userId });
    if (!selectedOffer || !amount) {
      console.log('[Escrow] Missing required data:', { selectedOffer: !!selectedOffer, amount: !!amount });
      showAlert('Error', 'Missing order details', 'error');
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
      const merchantWallet = selectedOffer?.merchant?.wallet_address;
      console.log('[Escrow] Merchant wallet:', merchantWallet || '(MISSING!)');
      console.log('[Escrow] Merchant name:', selectedOffer?.merchant?.display_name || '(unknown)');
      console.log('[Escrow] User wallet:', solanaWallet.walletAddress);
      console.log('[Escrow] Program ready:', solanaWallet.programReady);

      const isValidSolanaAddress = merchantWallet && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(merchantWallet);
      if (!isValidSolanaAddress) {
        setEscrowError('This merchant has not linked their Solana wallet. Please choose a different offer or wait for the merchant to set up their wallet.');
        setEscrowTxStatus('error');
        setIsLoading(false);
        return;
      }

      console.log('[Escrow] Wallet state before escrow:', {
        connected: solanaWallet.connected,
        walletAddress: solanaWallet.walletAddress,
        hasPublicKey: !!solanaWallet.publicKey,
      });
      console.log('[Escrow] Calling depositToEscrow with:', { amount: amountNum, merchantWallet });

      let escrowResult: { txHash: string; success: boolean; tradePda?: string; escrowPda?: string; tradeId?: number };

      try {
        escrowResult = await solanaWallet.depositToEscrow({
          amount: amountNum,
          merchantWallet,
        });
        console.log('[Escrow] depositToEscrow result:', escrowResult);

        if (!escrowResult.success) {
          throw new Error('Transaction failed');
        }
      } catch (escrowErr: any) {
        console.error('[Escrow] On-chain escrow failed:', escrowErr);
        console.error('[Escrow] Error message:', escrowErr?.message);
        console.error('[Escrow] Error stack:', escrowErr?.stack?.split('\n').slice(0, 3).join('\n'));

        if (escrowErr?.message?.includes('program=false')) {
          console.error('[Escrow] CRITICAL: Anchor program is null - wallet may not be fully connected');
          setEscrowError('Wallet not fully connected. Please disconnect and reconnect your wallet, then try again.');
        } else if (escrowErr?.message?.includes('User rejected')) {
          setEscrowError('Transaction was rejected. Please approve the transaction in your wallet.');
        } else if (escrowErr?.message?.includes('Insufficient')) {
          setEscrowError(escrowErr.message);
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

      const orderRes = await fetchWithAuth('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          offer_id: selectedOffer.id,
          crypto_amount: amountNum,
          type: 'sell',
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
        }),
      });
      const orderData = await orderRes.json();

      if (!orderRes.ok || !orderData.success) {
        if (orderData.details?.includes('User not found')) {
          setEscrowError(`Session expired. Your funds are safe - TX: ${escrowResult.txHash}. Please reconnect wallet and contact support.`);
          setEscrowTxStatus('error');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
          setUserId(null);
          setIsLoading(false);
          return;
        }
        setEscrowError(`Order creation failed after funds were locked. TX: ${escrowResult.txHash}. Please contact support.`);
        setEscrowTxStatus('error');
        setIsLoading(false);
        return;
      }

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
