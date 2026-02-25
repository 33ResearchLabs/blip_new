'use client';

/**
 * useSubmitReview — UI state wrapper for trade review submission
 */

import { useState, useCallback } from 'react';
import { submitReview, type SubmitReviewParams } from '../services/reviews.service';

interface UseSubmitReviewReturn {
  submit: (params: SubmitReviewParams) => Promise<unknown>;
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
  reset: () => void;
}

export function useSubmitReview(): UseSubmitReviewReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const reset = useCallback(() => {
    setError(null);
    setIsSuccess(false);
  }, []);

  const submit = useCallback(async (params: SubmitReviewParams) => {
    setIsLoading(true);
    setError(null);
    setIsSuccess(false);

    try {
      const result = await submitReview(params);
      setIsSuccess(true);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { submit, isLoading, error, isSuccess, reset };
}
