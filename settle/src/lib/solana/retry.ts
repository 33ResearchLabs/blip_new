/**
 * Retry Logic with Exponential Backoff for Blip Protocol V2.2
 *
 * Handles transient failures (network issues, RPC rate limits, etc.)
 * Uses exponential backoff to avoid overwhelming the system.
 *
 * CRITICAL: Solana RPC endpoints can be flaky. Always retry transient failures.
 */

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /**
   * Maximum number of retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds before first retry
   * @default 1000 (1 second)
   */
  baseDelayMs?: number;

  /**
   * Maximum delay in milliseconds between retries
   * @default 10000 (10 seconds)
   */
  maxDelayMs?: number;

  /**
   * Exponential backoff multiplier
   * @default 2
   */
  backoffMultiplier?: number;

  /**
   * Function to determine if an error is retryable
   * @default checks for network/RPC errors
   */
  isRetryable?: (error: any) => boolean;

  /**
   * Callback called before each retry attempt
   * @param attempt Current attempt number (1-indexed)
   * @param error Error that triggered the retry
   * @param delayMs Delay before next retry
   */
  onRetry?: (attempt: number, error: any, delayMs: number) => void;
}

/**
 * Default implementation of isRetryable
 * Checks if error is a transient failure that should be retried
 */
function defaultIsRetryable(error: any): boolean {
  // Always retry network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  const errorMessage = error?.message?.toLowerCase() || '';
  const errorString = String(error).toLowerCase();

  // Common transient errors
  const transientErrors = [
    'network',
    'timeout',
    'rate limit',
    'too many requests',
    '429',
    'service unavailable',
    '503',
    'bad gateway',
    '502',
    'gateway timeout',
    '504',
    'connection',
    'econnrefused',
    'enotfound',
    'etimedout',
    'blockhash not found', // Solana-specific transient error
    'node is unhealthy', // Solana RPC error
    'block height exceeded', // Blockhash expired - user took too long to approve
    'has expired', // Alternative wording for blockhash expiry
  ];

  return transientErrors.some(
    err => errorMessage.includes(err) || errorString.includes(err)
  );
}

/**
 * Calculate delay for next retry using exponential backoff
 */
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number
): number {
  const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  const jitter = Math.random() * 0.1 * exponentialDelay; // Add 0-10% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelayMs);
  return Math.floor(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 *
 * @param operation Async operation to retry
 * @param options Retry configuration options
 *
 * @example
 * const result = await retryWithBackoff(
 *   async () => {
 *     return await connection.sendTransaction(tx);
 *   },
 *   {
 *     maxRetries: 3,
 *     baseDelayMs: 1000,
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry attempt ${attempt} after ${delay}ms:`, error.message);
 *     }
 *   }
 * );
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    isRetryable = defaultIsRetryable,
    onRetry,
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Retry] Attempt ${attempt + 1}/${maxRetries + 1}`);
      const result = await operation();

      if (attempt > 0) {
        console.log(`[Retry] ✅ Succeeded on attempt ${attempt + 1}`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        console.error(`[Retry] ❌ All ${maxRetries + 1} attempts failed`);
        throw error;
      }

      // Check if error is retryable
      if (!isRetryable(error)) {
        console.error('[Retry] ❌ Error is not retryable, giving up:', error);
        throw error;
      }

      // Calculate delay for next retry
      const delayMs = calculateDelay(
        attempt + 1,
        baseDelayMs,
        maxDelayMs,
        backoffMultiplier
      );

      console.warn(
        `[Retry] ⚠️  Attempt ${attempt + 1} failed, retrying in ${delayMs}ms...`,
        error instanceof Error ? error.message : String(error)
      );

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, error, delayMs);
      }

      // Wait before next attempt
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Retry a transaction confirmation with custom timeouts
 *
 * Solana transactions can take time to confirm, especially on devnet.
 * This helper retries confirmation with appropriate backoff.
 *
 * @param confirmFn Function that confirms the transaction
 * @param options Retry options
 */
export async function retryTransactionConfirmation<T>(
  confirmFn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return retryWithBackoff(confirmFn, {
    maxRetries: 5, // More retries for confirmations
    baseDelayMs: 2000, // Start with 2 seconds
    maxDelayMs: 15000, // Cap at 15 seconds
    ...options,
  });
}

/**
 * Retry an RPC call with appropriate backoff
 *
 * RPC endpoints can hit rate limits or be temporarily unavailable.
 * This helper uses shorter delays appropriate for RPC calls.
 *
 * @param rpcCall Function that makes the RPC call
 * @param options Retry options
 */
export async function retryRpcCall<T>(
  rpcCall: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return retryWithBackoff(rpcCall, {
    maxRetries: 3,
    baseDelayMs: 500, // Shorter base delay for RPC
    maxDelayMs: 5000, // Cap at 5 seconds
    ...options,
  });
}
