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

  // 3. User ID from localStorage (user-facing app, not merchant portal)
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

  return headers;
}

/**
 * Drop-in replacement for window.fetch with auth headers injected.
 * Signature matches fetch() exactly.
 */
export function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const authHeaders = getAuthHeaders();
  return fetch(input, {
    ...init,
    headers: {
      ...authHeaders,
      ...init?.headers,
    },
  });
}
