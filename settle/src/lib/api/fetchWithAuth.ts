/**
 * fetchWithAuth — drop-in replacement for fetch() that injects identity headers.
 *
 * Reads merchantId from Zustand store (preferred) or localStorage fallback.
 * Adds `x-merchant-id` and/or `x-user-id` headers to every request.
 *
 * Usage:  import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
 *         const res = await fetchWithAuth('/api/merchant/orders?...');
 */

import { useMerchantStore } from '@/stores/merchantStore';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  // 1. Try Zustand store first (in-memory, most reliable)
  const merchantId = useMerchantStore.getState().merchantId;
  if (merchantId) {
    headers['x-merchant-id'] = merchantId;
  }

  // 2. Fallback to localStorage if store is empty
  if (!merchantId) {
    try {
      const saved = localStorage.getItem('blip_merchant');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) {
          headers['x-merchant-id'] = parsed.id;
        }
      }
    } catch {
      // localStorage not available (SSR) or corrupt — skip
    }
  }

  // 3. User ID from localStorage (user-facing app)
  // Always send x-user-id when available — the server disambiguates
  // using the route path (/merchant routes → merchant actor, else → user).
  // Both headers must be present so users logged into merchant + user
  // in the same browser can still create orders from the user side.
  try {
    const saved = localStorage.getItem('blip_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) {
        headers['x-user-id'] = parsed.id;
      }
    }
  } catch {
    // SSR or corrupt — skip
  }

  // 4. Compliance officer ID from localStorage
  try {
    const saved = localStorage.getItem('compliance_member');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) {
        headers['x-compliance-id'] = parsed.id;
      }
    }
  } catch {
    // SSR or corrupt — skip
  }

  return headers;
}

// ── In-flight request deduplication for GET requests ──────────────────
// If the same GET URL is already being fetched, reuse the pending promise
// instead of creating a duplicate network request.
const inflightGets = new Map<string, Promise<Response>>();

/**
 * Drop-in replacement for window.fetch with auth headers injected.
 * Signature matches fetch() exactly.
 *
 * GET requests are automatically deduplicated: concurrent calls to the
 * same URL share a single in-flight request. Mutations (POST/PATCH/DELETE)
 * are never deduplicated.
 */
export function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const authHeaders = getAuthHeaders();
  const method = (init?.method || 'GET').toUpperCase();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // Only deduplicate GET requests (mutations must always execute)
  if (method === 'GET') {
    const existing = inflightGets.get(url);
    if (existing) return existing.then(res => res.clone());

    const promise = fetch(input, {
      ...init,
      headers: {
        ...authHeaders,
        ...init?.headers,
      },
    }).finally(() => {
      inflightGets.delete(url);
    });

    inflightGets.set(url, promise);
    return promise.then(res => res.clone());
  }

  return fetch(input, {
    ...init,
    headers: {
      ...authHeaders,
      ...init?.headers,
    },
  });
}
