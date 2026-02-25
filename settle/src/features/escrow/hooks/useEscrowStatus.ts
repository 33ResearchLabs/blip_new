'use client';

/**
 * useEscrowStatus — UI state wrapper for escrow status queries
 */

import { useState, useCallback } from 'react';
import { getEscrowStatus, type EscrowStatusResult } from '../services/escrow.service';

interface UseEscrowStatusReturn {
  escrow: EscrowStatusResult | null;
  isLoading: boolean;
  error: string | null;
  fetch: (orderId: string) => Promise<void>;
}

export function useEscrowStatus(): UseEscrowStatusReturn {
  const [escrow, setEscrow] = useState<EscrowStatusResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async (orderId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await getEscrowStatus(orderId);
      setEscrow(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch escrow status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { escrow, isLoading, error, fetch };
}
