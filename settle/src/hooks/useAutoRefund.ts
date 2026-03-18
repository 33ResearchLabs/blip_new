"use client";

import { useRef, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { Order, Notification } from "@/types/merchant";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface UseAutoRefundParams {
  solanaWallet: any;
  addNotification: (type: Notification['type'], message: string, orderId?: string) => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  debouncedFetchOrders: () => void;
}

export function useAutoRefund({
  solanaWallet,
  addNotification,
  playSound,
  debouncedFetchOrders,
}: UseAutoRefundParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const autoRefundInFlightRef = useRef<Set<string>>(new Set());

  const autoRefundEscrow = useCallback(async (order: Order) => {
    if (autoRefundInFlightRef.current.has(order.id)) return;
    if (order.refundTxHash) return;
    autoRefundInFlightRef.current.add(order.id);

    try {
      console.log(`[AutoRefund] Refunding escrow for order ${order.id}...`);
      const refundResult = await solanaWallet.refundEscrow({
        creatorPubkey: order.escrowCreatorWallet || '',
        tradeId: order.escrowTradeId || 0,
      });

      if (refundResult.success) {
        console.log(`[AutoRefund] Success: ${refundResult.txHash}`);
        addNotification('system', `Escrow auto-refunded! ${order.amount} USDC returned to your wallet.`, order.id);
        playSound('click');

        await fetchWithAuth(`/api/orders/${order.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'cancelled',
            actor_type: 'merchant',
            actor_id: merchantId,
            refund_tx_hash: refundResult.txHash,
          }),
        });

        solanaWallet.refreshBalances?.();
        debouncedFetchOrders();
      } else {
        console.warn(`[AutoRefund] Failed for ${order.id}:`, refundResult.error);
        addNotification('system', `Auto-refund failed for ${order.amount} USDC. Use "Cancel & Withdraw" manually.`, order.id);
      }
    } catch (e) {
      console.error(`[AutoRefund] Error for ${order.id}:`, e);
    } finally {
      autoRefundInFlightRef.current.delete(order.id);
    }
  }, [solanaWallet, merchantId, addNotification, debouncedFetchOrders]);

  return { autoRefundEscrow };
}
