'use client';

/**
 * Headers attached to /api/pusher/auth requests by pusher-js.
 *
 * Auth model (post-cookie-migration): the httpOnly `blip_access_token`
 * cookie is sent automatically on same-origin XHRs that pusher-js issues
 * to /api/pusher/auth. We attach NO Authorization header, NO x-merchant-id
 * / x-user-id / x-compliance-id — those used to read identity out of
 * localStorage / sessionStorage, which is exactly the attack surface this
 * round of work is closing.
 *
 * pusher-js calls this synchronously per channel-auth request, so identity
 * always reflects whatever the cookie's signed token currently says — no
 * stale snapshots.
 *
 * NOTE: this function is preserved (rather than deleted) because pusher-js
 * is configured with `auth.headers: () => buildPusherAuthHeaders()` from
 * the PusherProvider. Returning `{}` is the correct no-op — auth still
 * works because cookies flow on the same-origin request.
 */

export function buildPusherAuthHeaders(): Record<string, string> {
  return {};
}
