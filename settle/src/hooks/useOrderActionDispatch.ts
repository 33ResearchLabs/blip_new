/**
 * useOrderActionDispatch - Hardened unified action dispatcher.
 *
 * All order actions use ONE endpoint: POST /api/orders/{id}/action
 * Frontend takes action.type from primaryAction/secondaryAction and sends directly.
 *
 * SAFETY:
 *   - Double-click guard: rejects dispatch while another is in-flight
 *   - Auto idempotency keys for financial actions (SEND_PAYMENT, CONFIRM_PAYMENT, LOCK_ESCROW)
 *   - Re-fetches order on error so UI stays in sync
 *   - Never assumes success — always trusts backend response
 */

import { useCallback, useState, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import type {
  ActionType,
  OrderActionRequest,
  OrderActionResponse,
} from '@/types/backendOrder';
import { FINANCIAL_ACTIONS } from '@/types/backendOrder';

interface UseOrderActionDispatchOptions {
  /** Actor ID (user or merchant ID) */
  actorId: string;
  /** Actor type */
  actorType: 'user' | 'merchant';
  /** Callback after successful action */
  onSuccess?: (response: OrderActionResponse) => void;
  /** Callback on error */
  onError?: (error: string, code?: string) => void;
  /** Called on any completion (success or error) to re-fetch order state */
  onSettled?: () => void;
}

interface DispatchOptions {
  /** Optional reason (for CANCEL, DISPUTE) */
  reason?: string;
  /** Escrow transaction hash (for LOCK_ESCROW) */
  tx_hash?: string;
  /** Wallet address (for ACCEPT) */
  acceptor_wallet_address?: string;
  /** On-chain escrow refs */
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
  /** Override idempotency key (auto-generated for financial actions if omitted) */
  idempotency_key?: string;
}

/** Generate a UUID v4 for idempotency */
function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useOrderActionDispatch(options: UseOrderActionDispatchOptions) {
  const { actorId, actorType, onSuccess, onError, onSettled } = options;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Double-click guard: track in-flight request
  const inflightRef = useRef<string | null>(null);

  const dispatch = useCallback(
    async (
      orderId: string,
      action: ActionType,
      dispatchOptions?: DispatchOptions
    ): Promise<OrderActionResponse | null> => {
      // Double-click guard: reject if same action is already in-flight
      const inflightKey = `${orderId}:${action}`;
      if (inflightRef.current === inflightKey) {
        return null;
      }

      inflightRef.current = inflightKey;
      setIsLoading(true);
      setError(null);

      try {
        const payload: OrderActionRequest = {
          action,
          actor_id: actorId,
          actor_type: actorType,
          reason: dispatchOptions?.reason,
          tx_hash: dispatchOptions?.tx_hash,
          acceptor_wallet_address: dispatchOptions?.acceptor_wallet_address,
          escrow_trade_id: dispatchOptions?.escrow_trade_id,
          escrow_trade_pda: dispatchOptions?.escrow_trade_pda,
          escrow_pda: dispatchOptions?.escrow_pda,
          escrow_creator_wallet: dispatchOptions?.escrow_creator_wallet,
        };

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // Auto-generate idempotency key for financial actions
        const isFinancial = (FINANCIAL_ACTIONS as readonly string[]).includes(action);
        const idempotencyKey = dispatchOptions?.idempotency_key
          || (isFinancial ? generateIdempotencyKey() : undefined);

        if (idempotencyKey) {
          headers['x-idempotency-key'] = idempotencyKey;
        }

        const res = await fetchWithAuth(`/api/orders/${orderId}/action`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });

        const data: OrderActionResponse = await res.json();

        if (!res.ok || !data.success) {
          const errorMsg = data.error || `Action ${action} failed`;
          setError(errorMsg);
          onError?.(errorMsg, data.code);
          return data;
        }

        setError(null);
        onSuccess?.(data);
        return data;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Network error';
        setError(errorMsg);
        onError?.(errorMsg);
        return null;
      } finally {
        inflightRef.current = null;
        setIsLoading(false);
        // Always call onSettled so the caller can re-fetch order state
        onSettled?.();
      }
    },
    [actorId, actorType, onSuccess, onError, onSettled]
  );

  return {
    dispatch,
    isLoading,
    error,
    clearError: () => setError(null),
  };
}
