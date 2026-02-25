'use client';

/**
 * useCancelOrder — UI state wrapper for order cancellation
 *
 * Manages loading / error state. Cancellation rules (pre-escrow = clean,
 * post-escrow = dispute) are enforced by the API, not here.
 */

import { useState, useCallback } from 'react';
import { cancelOrder, type CancelOrderParams, ApiError } from '../services/orders.service';

interface UseCancelOrderReturn {
  cancel: (params: CancelOrderParams) => Promise<unknown>;
  isLoading: boolean;
  error: string | null;
  reset: () => void;
}

export function useCancelOrder(): UseCancelOrderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setError(null);
  }, []);

  const cancel = useCallback(async (params: CancelOrderParams) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await cancelOrder(params);
      return result;
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : 'Failed to cancel order';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { cancel, isLoading, error, reset };
}
