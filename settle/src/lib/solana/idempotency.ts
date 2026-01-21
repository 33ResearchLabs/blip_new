/**
 * Idempotency Layer for Blip Protocol V2.2
 *
 * Prevents duplicate transactions by caching operation results.
 * Uses localStorage for browser-side persistence.
 *
 * CRITICAL: This prevents users from accidentally submitting the same
 * transaction multiple times (e.g., double-clicking a button).
 */

const IDEMPOTENCY_PREFIX = 'blip_idempotency_';
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Cached operation result
 */
interface CachedResult<T> {
  result: T;
  timestamp: number;
  key: string;
}

/**
 * Generate a deterministic idempotency key
 *
 * @param operation Operation name (e.g., "release_escrow")
 * @param params Operation parameters (e.g., tradePda, wallet)
 */
export function generateIdempotencyKey(
  operation: string,
  ...params: (string | number)[]
): string {
  const paramString = params.join('_');
  return `${operation}_${paramString}`;
}

/**
 * Get cached result if it exists and hasn't expired
 *
 * @param key Idempotency key
 * @param ttlMs Time to live in milliseconds
 */
function getCachedResult<T>(key: string, ttlMs: number): CachedResult<T> | null {
  if (typeof window === 'undefined') return null;

  try {
    const storageKey = IDEMPOTENCY_PREFIX + key;
    const cached = localStorage.getItem(storageKey);

    if (!cached) return null;

    const parsed: CachedResult<T> = JSON.parse(cached);
    const age = Date.now() - parsed.timestamp;

    if (age > ttlMs) {
      // Expired, remove from cache
      localStorage.removeItem(storageKey);
      console.log('[Idempotency] Cache expired:', key, `(age: ${age}ms, ttl: ${ttlMs}ms)`);
      return null;
    }

    console.log('[Idempotency] Cache hit:', key, `(age: ${age}ms)`);
    return parsed;
  } catch (error) {
    console.error('[Idempotency] Error reading cache:', error);
    return null;
  }
}

/**
 * Store result in cache
 *
 * @param key Idempotency key
 * @param result Operation result
 */
function setCachedResult<T>(key: string, result: T): void {
  if (typeof window === 'undefined') return;

  try {
    const storageKey = IDEMPOTENCY_PREFIX + key;
    const cached: CachedResult<T> = {
      result,
      timestamp: Date.now(),
      key,
    };

    localStorage.setItem(storageKey, JSON.stringify(cached));
    console.log('[Idempotency] Result cached:', key);
  } catch (error) {
    console.error('[Idempotency] Error writing cache:', error);
  }
}

/**
 * Execute operation with idempotency
 *
 * If the operation has been executed recently (within ttlMs), return the cached result.
 * Otherwise, execute the operation and cache the result.
 *
 * @param key Idempotency key
 * @param operation Async operation to execute
 * @param ttlMs Time to live for cached result (default: 5 minutes)
 *
 * @example
 * const { result, cached } = await executeWithIdempotency(
 *   'release_escrow_123_buyer123',
 *   async () => {
 *     return await releaseEscrowTransaction();
 *   }
 * );
 *
 * if (cached) {
 *   console.log('Using cached transaction signature:', result);
 * }
 */
export async function executeWithIdempotency<T>(
  key: string,
  operation: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<{ result: T; cached: boolean }> {
  // Check cache first
  const cached = getCachedResult<T>(key, ttlMs);

  if (cached) {
    console.log('[Idempotency] Returning cached result for:', key);
    return {
      result: cached.result,
      cached: true,
    };
  }

  // Execute operation
  console.log('[Idempotency] Executing fresh operation:', key);
  const result = await operation();

  // Cache result
  setCachedResult(key, result);

  return {
    result,
    cached: false,
  };
}

/**
 * Clear cached result for a specific key
 *
 * @param key Idempotency key
 */
export function clearCachedResult(key: string): void {
  if (typeof window === 'undefined') return;

  try {
    const storageKey = IDEMPOTENCY_PREFIX + key;
    localStorage.removeItem(storageKey);
    console.log('[Idempotency] Cache cleared:', key);
  } catch (error) {
    console.error('[Idempotency] Error clearing cache:', error);
  }
}

/**
 * Clear all cached idempotency results
 *
 * Useful for debugging or when user logs out
 */
export function clearAllCachedResults(): void {
  if (typeof window === 'undefined') return;

  try {
    const keys = Object.keys(localStorage);
    let cleared = 0;

    for (const key of keys) {
      if (key.startsWith(IDEMPOTENCY_PREFIX)) {
        localStorage.removeItem(key);
        cleared++;
      }
    }

    console.log('[Idempotency] Cleared all cached results:', cleared, 'items');
  } catch (error) {
    console.error('[Idempotency] Error clearing all cache:', error);
  }
}

/**
 * Get all cached idempotency keys (for debugging)
 */
export function getCachedKeys(): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const keys = Object.keys(localStorage);
    return keys
      .filter(key => key.startsWith(IDEMPOTENCY_PREFIX))
      .map(key => key.replace(IDEMPOTENCY_PREFIX, ''));
  } catch (error) {
    console.error('[Idempotency] Error getting cached keys:', error);
    return [];
  }
}
