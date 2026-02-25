'use client';

/**
 * useOrderStatus — UI state wrapper for status updates
 *
 * Manages loading / error state for order status transitions.
 * Does NOT validate transitions — the API + state machine handle that.
 */

import { useState, useCallback } from 'react';
import { updateOrderStatus, type UpdateStatusParams, ApiError } from '../services/orders.service';

interface UseOrderStatusReturn {
  update: (params: UpdateStatusParams) => Promise<unknown>;
  isLoading: boolean;
  error: string | null;
  reset: () => void;
}

export function useOrderStatus(): UseOrderStatusReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setError(null);
  }, []);

  const update = useCallback(async (params: UpdateStatusParams) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await updateOrderStatus(params);
      return result;
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : 'Failed to update order status';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { update, isLoading, error, reset };
}
