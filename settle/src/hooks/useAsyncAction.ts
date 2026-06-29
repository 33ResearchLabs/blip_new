"use client";

/**
 * useAsyncAction — one DRY wrapper for every async user action.
 *
 * Gives, in a single place:
 *   - a re-entrancy guard (the action is a no-op while a previous call is still
 *     in flight) → prevents double-submit / duplicate API requests,
 *   - an `isRunning` flag for spinners / disabled buttons,
 *   - centralized error surfacing via `notifyError` (network/timeout/unexpected),
 *   - a guaranteed reset in `finally` (never leaves a button stuck "loading").
 *
 * It changes NO UI by itself — callers wire `isRunning` into their existing
 * disabled/spinner props. Business logic stays in the supplied `fn`.
 *
 * Usage:
 *   const [submit, submitting] = useAsyncAction('createCorridor', async () => {
 *     const res = await fetchWithAuth(...);
 *     if (!res.ok) throw new Error(await notifyApiError('createCorridor', res));
 *     ...
 *   });
 *   <button onClick={() => submit()} disabled={submitting || !valid}>...</button>
 */
import { useCallback, useRef, useState } from 'react';
import { notifyError, type NotifyErrorOptions } from '@/lib/notify/notifyError';

export interface UseAsyncActionOptions extends NotifyErrorOptions {
  /** Runs after a successful invocation. */
  onSuccess?: () => void;
  /**
   * Custom error handling instead of the default `notifyError`. When provided,
   * the default surfacing is skipped — the caller owns it (e.g. inline banner).
   */
  onError?: (err: unknown) => void;
}

export function useAsyncAction<TArgs extends unknown[], TResult>(
  context: string,
  fn: (...args: TArgs) => Promise<TResult>,
  options: UseAsyncActionOptions = {},
): [(...args: TArgs) => Promise<TResult | undefined>, boolean] {
  const [isRunning, setIsRunning] = useState(false);
  const inFlightRef = useRef(false);

  // Keep latest fn/options without forcing `run` to change identity each render
  // (so it's stable for event handlers and effect deps).
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      // Guard against multiple clicks / concurrent invocations.
      if (inFlightRef.current) return undefined;
      inFlightRef.current = true;
      setIsRunning(true);
      try {
        const result = await fnRef.current(...args);
        optionsRef.current.onSuccess?.();
        return result;
      } catch (err) {
        if (optionsRef.current.onError) optionsRef.current.onError(err);
        else notifyError(context, err, optionsRef.current);
        return undefined;
      } finally {
        inFlightRef.current = false;
        setIsRunning(false);
      }
    },
    [context],
  );

  return [run, isRunning];
}
