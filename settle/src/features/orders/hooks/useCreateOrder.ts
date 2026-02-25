'use client';

/**
 * useCreateOrder — UI state wrapper around orders.service.createOrder
 *
 * Manages loading / error / success state for order creation.
 * Contains ZERO business logic. The API determines matching, escrow payer,
 * type inversion, etc.
 */

import { useState, useCallback } from 'react';
import { createOrder, type CreateOrderParams, ApiError } from '../services/orders.service';

interface UseCreateOrderReturn {
  create: (params: CreateOrderParams) => Promise<unknown>;
  isLoading: boolean;
  error: string | null;
  data: unknown;
  reset: () => void;
}

export function useCreateOrder(): UseCreateOrderReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<unknown>(null);

  const reset = useCallback(() => {
    setError(null);
    setData(null);
  }, []);

  const create = useCallback(async (params: CreateOrderParams) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await createOrder(params);
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : 'Failed to create order';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { create, isLoading, error, data, reset };
}
