'use client';

/**
 * P2PTradingView - Fully backend-driven P2P trading interface (hardened).
 *
 * ARCHITECTURE:
 * - Frontend = Renderer (displays what backend sends)
 * - Backend = Decision Engine (computes roles, actions, state)
 *
 * SAFETY:
 * - All actions go through POST /orders/{id}/action with idempotency
 * - Error toast system with auto-dismiss
 * - Re-fetches on every action completion (success or failure)
 * - No optimistic updates — always trusts backend response
 */

import { useState, useCallback } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { BackendOrderList } from './BackendOrderList';
import { BackendOrderDetail } from './BackendOrderDetail';
import { useBackendOrders } from '@/hooks/useBackendOrders';
import { useBackendOrder } from '@/hooks/useBackendOrder';
import { useOrderActionDispatch } from '@/hooks/useOrderActionDispatch';
import type { BackendOrder, ActionType } from '@/types/backendOrder';

interface P2PTradingViewProps {
  mode: 'user' | 'merchant';
  actorId: string;
  userId?: string;
  merchantId?: string;
  pusher?: any;
  onEscrowAction?: (orderId: string, action: ActionType) => Promise<{
    tx_hash?: string;
    escrow_trade_id?: number;
    escrow_trade_pda?: string;
    escrow_pda?: string;
    escrow_creator_wallet?: string;
  } | null>;
  onOpenChat?: (orderId: string) => void;
}

export function P2PTradingView({
  mode,
  actorId,
  userId,
  merchantId,
  pusher,
  onEscrowAction,
  onOpenChat,
}: P2PTradingViewProps) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Fetch order list
  const {
    orders,
    isLoading: ordersLoading,
    refetch: refetchOrders,
  } = useBackendOrders({
    mode,
    userId,
    merchantId,
    includeAllPending: mode === 'merchant',
    pusher,
  });

  // Fetch selected order detail (with real-time subscription)
  const {
    order: selectedOrder,
    refetch: refetchOrder,
  } = useBackendOrder({
    orderId: selectedOrderId,
    pusher,
  });

  // Unified action dispatch for inline list actions
  const { dispatch } = useOrderActionDispatch({
    actorId,
    actorType: mode === 'merchant' ? 'merchant' : 'user',
    onSuccess: () => {
      refetchOrders();
      refetchOrder();
    },
    onError: (error) => {
      setGlobalError(error);
      // Auto-dismiss after 6 seconds
      setTimeout(() => setGlobalError(null), 6000);
    },
    onSettled: () => {
      refetchOrders();
      refetchOrder();
    },
  });

  const handleListAction = useCallback(async (orderId: string, action: ActionType) => {
    await dispatch(orderId, action);
  }, [dispatch]);

  const handleSelectOrder = useCallback((order: BackendOrder) => {
    setSelectedOrderId(order.id);
  }, []);

  const handleOrderUpdated = useCallback(() => {
    refetchOrders();
  }, [refetchOrders]);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Global error toast */}
      {globalError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400 flex-1">{globalError}</p>
          <button onClick={() => setGlobalError(null)} className="text-red-400/60 hover:text-red-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left panel: Order list */}
        <div className="w-[400px] shrink-0 border-r border-zinc-800 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800">
            <h2 className="text-lg font-bold text-white">
              {mode === 'merchant' ? 'Orders' : 'My Trades'}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {orders.length} order{orders.length !== 1 ? 's' : ''}
            </p>
          </div>

          <BackendOrderList
            orders={orders}
            isLoading={ordersLoading}
            onSelectOrder={handleSelectOrder}
            onAction={handleListAction}
            selectedOrderId={selectedOrderId || undefined}
            showInlineActions={mode === 'merchant'}
            className="flex-1"
          />
        </div>

        {/* Right panel: Order detail */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedOrder ? (
            <BackendOrderDetail
              order={selectedOrder}
              actorId={actorId}
              actorType={mode === 'merchant' ? 'merchant' : 'user'}
              onOrderUpdated={handleOrderUpdated}
              onClose={() => setSelectedOrderId(null)}
              onOpenChat={onOpenChat}
              onRefetch={refetchOrder}
              onEscrowAction={onEscrowAction}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600">
              <div className="text-center">
                <p className="text-lg font-medium">Select an order</p>
                <p className="text-sm mt-1">Click on an order to view details and take action</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
