"use client";

import { useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, Notification } from "@/types/merchant";
import { mapDbOrderToUI } from "@/lib/orders/mappers";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface UseTradeCreationParams {
  solanaWallet: any;
  effectiveBalance: number | null;
  openTradeForm: {
    tradeType: "buy" | "sell";
    cryptoAmount: string;
    paymentMethod: "bank" | "cash";
    paymentMethodId?: string;
    spreadPreference: "best" | "fastest" | "cheap";
    expiryMinutes: 15 | 90;
  };
  setOpenTradeForm: (form: any) => void;
  setShowOpenTradeModal: (show: boolean) => void;
  setIsCreatingTrade: (creating: boolean) => void;
  setCreateTradeError: (error: string | null) => void;
  addNotification: (type: Notification['type'], message: string, orderId?: string) => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  refreshBalance: () => void;
}

const DEFAULT_FORM = {
  tradeType: "sell" as const,
  cryptoAmount: "",
  paymentMethod: "bank" as const,
  paymentMethodId: undefined as string | undefined,
  spreadPreference: "fastest" as const,
  expiryMinutes: 15 as const,
};

export function useTradeCreation({
  solanaWallet,
  effectiveBalance,
  openTradeForm,
  setOpenTradeForm,
  setShowOpenTradeModal,
  setIsCreatingTrade,
  setCreateTradeError,
  addNotification,
  playSound,
  refreshBalance,
}: UseTradeCreationParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const setOrders = useMerchantStore(s => s.setOrders);

  const handleCreateTrade = useCallback(async () => {
    if (!merchantId) return;

    if (openTradeForm.tradeType === "sell") {
      setIsCreatingTrade(true);
      setCreateTradeError(null);
      try {
        if (effectiveBalance !== null && effectiveBalance < parseFloat(openTradeForm.cryptoAmount)) {
          setCreateTradeError(`Insufficient USDT balance. You need ${openTradeForm.cryptoAmount} USDT but have ${effectiveBalance.toFixed(2)} USDT.`);
          setIsCreatingTrade(false);
          return;
        }
        const offerParams = new URLSearchParams({
          amount: openTradeForm.cryptoAmount, type: 'buy',
          payment_method: openTradeForm.paymentMethod, exclude_merchant: merchantId,
        });
        const offerRes = await fetchWithAuth(`/api/offers?${offerParams}`);
        const offerData = offerRes.ok ? await offerRes.json().catch(() => ({})) : {};
        let matchedOffer: { id: string; merchant?: { wallet_address?: string; display_name?: string } } | null = null;
        if (offerRes.ok && offerData.success && offerData.data) matchedOffer = offerData.data;
        const counterpartyWallet = matchedOffer?.merchant?.wallet_address;
        if (!counterpartyWallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(counterpartyWallet)) {
          setCreateTradeError('No matching merchant with a linked wallet found.');
          setIsCreatingTrade(false);
          return;
        }

        // Pre-validate order payload BEFORE locking escrow on-chain.
        // This prevents the critical scenario where escrow is locked but
        // order creation fails due to validation (e.g. invalid payment_method).
        const preValidateRes = await fetchWithAuth("/api/merchant/orders?dry_run=true", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_id: merchantId, type: openTradeForm.tradeType,
            crypto_amount: parseFloat(openTradeForm.cryptoAmount),
            payment_method: openTradeForm.paymentMethod, spread_preference: openTradeForm.spreadPreference,
            merchant_payment_method_id: openTradeForm.paymentMethodId,
            matched_offer_id: matchedOffer?.id,
          }),
        });
        if (!preValidateRes.ok) {
          const preData = await preValidateRes.json().catch(() => ({}));
          setCreateTradeError(preData.error || preData.details?.[0] || 'Order validation failed — escrow not locked.');
          setIsCreatingTrade(false);
          return;
        }

        const escrowResult: { success: boolean; txHash: string; tradeId?: number; tradePda?: string; escrowPda?: string; error?: string } = await solanaWallet.depositToEscrowOpen({ amount: parseFloat(openTradeForm.cryptoAmount), side: 'sell' });
        if (!escrowResult.success || !escrowResult.txHash) throw new Error(escrowResult.error || 'Escrow transaction failed');
        const res = await fetchWithAuth("/api/merchant/orders", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant_id: merchantId, type: openTradeForm.tradeType,
            crypto_amount: parseFloat(openTradeForm.cryptoAmount),
            payment_method: openTradeForm.paymentMethod, spread_preference: openTradeForm.spreadPreference,
            merchant_payment_method_id: openTradeForm.paymentMethodId,
            matched_offer_id: matchedOffer?.id, escrow_tx_hash: escrowResult.txHash,
            escrow_trade_id: escrowResult.tradeId, escrow_trade_pda: escrowResult.tradePda,
            escrow_pda: escrowResult.escrowPda, escrow_creator_wallet: solanaWallet.walletAddress,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setCreateTradeError(data.error || "Failed to create order");
          setIsCreatingTrade(false);
          return;
        }
        if (data.data) {
          const newOrder = mapDbOrderToUI(data.data, merchantId);
          setOrders((prev: Order[]) => [newOrder, ...prev.filter((o: Order) => o.id !== newOrder.id)]);
          playSound('trade_complete');
          addNotification('escrow', `Sell order created! ${parseFloat(openTradeForm.cryptoAmount).toLocaleString()} USDT locked in escrow`, data.data?.id);
        }
        refreshBalance();
        setShowOpenTradeModal(false);
        setOpenTradeForm(DEFAULT_FORM);
      } catch (error) {
        setCreateTradeError(error instanceof Error ? error.message : 'Network error');
      } finally {
        setIsCreatingTrade(false);
      }
      return;
    }

    setIsCreatingTrade(true);
    setCreateTradeError(null);
    try {
      const res = await fetchWithAuth("/api/merchant/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_id: merchantId, type: openTradeForm.tradeType,
          crypto_amount: parseFloat(openTradeForm.cryptoAmount),
          payment_method: openTradeForm.paymentMethod, spread_preference: openTradeForm.spreadPreference,
          merchant_payment_method_id: openTradeForm.paymentMethodId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setCreateTradeError(data.error || "Failed to create trade");
        return;
      }
      if (data.data) {
        const newOrder = mapDbOrderToUI(data.data, merchantId);
        setOrders((prev: Order[]) => [newOrder, ...prev.filter((o: Order) => o.id !== newOrder.id)]);
      }
      setShowOpenTradeModal(false);
      setOpenTradeForm(DEFAULT_FORM);
    } catch {
      setCreateTradeError("Network error. Please try again.");
    } finally {
      setIsCreatingTrade(false);
    }
  }, [merchantId, openTradeForm, solanaWallet, effectiveBalance, playSound, addNotification, refreshBalance]);

  return { handleCreateTrade };
}
