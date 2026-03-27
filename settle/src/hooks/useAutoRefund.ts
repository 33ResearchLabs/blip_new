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
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      // Known non-fatal errors — don't spam console with red errors
      if (errMsg.includes('does not exist or has no data')
        || errMsg.includes('Account does not exist')
        || errMsg.includes('MustUseDispute')
        || errMsg.includes('6033')
        || errMsg.includes('0x1791')
        || errMsg.includes('already been refunded')
        || errMsg.includes('never funded')) {
        console.log(`[AutoRefund] Skipped for ${order.id}: ${errMsg.slice(0, 120)}`);
      } else {
        console.warn(`[AutoRefund] Error for ${order.id}:`, errMsg);
      }
    } finally {
      autoRefundInFlightRef.current.delete(order.id);
    }
  }, [solanaWallet, merchantId, addNotification, debouncedFetchOrders]);

  return { autoRefundEscrow };
}
