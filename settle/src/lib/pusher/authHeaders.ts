'use client';

/**
 * Headers attached to /api/pusher/auth requests by pusher-js.
 *
 * Mirrors fetchWithAuth's strategy:
 *   - Authorization: Bearer <session_token>   (preferred — verified by requireAuth)
 *   - x-{user|merchant|compliance}-id          (dev-only fallback for requireAuth)
 *
 * Called fresh on every channel-auth request so token refreshes are picked up.
 *
 * NOTE: x-actor-id / x-actor-type are intentionally NOT sent. The auth route
 * does not trust them — identity comes from the verified token only.
 */

import { useMerchantStore } from '@/stores/merchantStore';

export function buildPusherAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};

  if (typeof window === 'undefined') return headers;

  // Bearer token (cryptographically signed, server-verified)
  let sessionToken: string | null = null;
  try {
    sessionToken = useMerchantStore.getState().sessionToken;
  } catch { /* store not hydrated */ }
  if (!sessionToken) {
    try { sessionToken = sessionStorage.getItem('blip_session_token'); }
    catch { /* SSR / disabled storage */ }
  }
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  // Dev-fallback identity hints — requireAuth honors these only outside
  // production AND only when no valid Bearer is present.
  try {
    const merchantId = useMerchantStore.getState().merchantId;
    if (merchantId) {
      headers['x-merchant-id'] = merchantId;
    } else {
      const saved = localStorage.getItem('blip_merchant');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) headers['x-merchant-id'] = parsed.id;
      }
    }
  } catch { /* skip */ }

  try {
    const saved = localStorage.getItem('blip_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) headers['x-user-id'] = parsed.id;
    }
  } catch { /* skip */ }

  try {
    const saved = localStorage.getItem('compliance_member');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) headers['x-compliance-id'] = parsed.id;
    }
  } catch { /* skip */ }

  return headers;
}
