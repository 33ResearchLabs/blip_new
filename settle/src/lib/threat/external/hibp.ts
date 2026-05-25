// Have I Been Pwned (HIBP) email-breach client. Returns:
//   * breach_count       — how many known breaches contain this email
//   * most_recent_breach — ISO date string of the most-recent breach, if any
//
// Why this is a useful signal:
//   * EMAIL_BREACH_EXPOSURE (negative weight) — an address that's been in
//     a breach is overwhelmingly a real, used address. Genuine signal of a
//     "real person", not a throwaway.
//   * EMAIL_BREACH_RECENT (positive weight) — an address breached in the
//     last 30 days is a credential-stuffing target; fraud signal.
//
// Operational guarantees:
//   * 7-day Redis cache keyed by sha256(email) (privacy: we never cache the
//     raw email)
//   * 1500 ms timeout, 2 retries on 5xx
//   * Returns null on any failure or when HIBP_API_KEY is unset
//   * Never throws
//
// HIBP requires an API key for the breachedaccount endpoint.
// Docs: https://haveibeenpwned.com/API/v3#BreachesForAccount

import crypto from 'crypto';
import cache from '@/lib/cache/redis';

const CACHE_PREFIX = 'hibp:';
const CACHE_TTL_SECONDS = 604_800;   // 7d
const REQUEST_TIMEOUT_MS = 1500;
const RETRY_DELAYS_MS = [250, 750];
const USER_AGENT = 'BlipMoney-WaitlistRiskScorer/1.0';

export interface HibpResult {
  email_hash: string;            // sha256 of normalised email (audit only)
  breach_count: number;
  most_recent_breach_iso: string | null;
  fetched_at: string;
}

export async function checkEmail(rawEmail: string | null | undefined): Promise<HibpResult | null> {
  if (!rawEmail) return null;
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes('@')) return null;

  const apiKey = process.env.HIBP_API_KEY;
  if (!apiKey) return null;

  const emailHash = crypto.createHash('sha256').update(email).digest('hex');
  const cacheKey = `${CACHE_PREFIX}${emailHash}`;
  const cached = await cache.get<HibpResult>(cacheKey);
  if (cached) return cached;

  // HIBP supports truncating the response to short list shape via
  // ?truncateResponse=true — we want full breach metadata for the
  // most-recent date, so request the full payload.
  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false&includeUnverified=true`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS, apiKey);
      if (!res) { lastErr = new Error('null fetch result'); }
      else if (res.status === 404) {
        // 404 = no breaches found for this address. That IS a real signal —
        // cache it as a zero-breach result.
        const zero: HibpResult = {
          email_hash: emailHash, breach_count: 0,
          most_recent_breach_iso: null, fetched_at: new Date().toISOString(),
        };
        await cache.set(cacheKey, zero, CACHE_TTL_SECONDS);
        return zero;
      }
      else if (res.status === 401 || res.status === 403) {
        // Bad key / quota — permanent failure for this deployment, no point
        // retrying. Log so we notice in ops.
        console.warn('[threat/hibp] auth/quota failure', res.status);
        return null;
      }
      else if (res.status === 429) {
        // Rate limited — back off (HIBP returns retry-after).
        const retryAfter = parseInt(res.headers.get('retry-after') ?? '', 10) || 5;
        await sleep(retryAfter * 1000);
        lastErr = new Error('429 rate limited');
      }
      else if (res.status >= 500) {
        lastErr = new Error(`5xx: ${res.status}`);
      }
      else if (!res.ok) {
        return null;
      }
      else {
        const arr = await res.json().catch(() => null) as Array<Record<string, unknown>> | null;
        if (!Array.isArray(arr)) return null;
        const result = summarise(emailHash, arr);
        await cache.set(cacheKey, result, CACHE_TTL_SECONDS);
        return result;
      }
    } catch (err) {
      lastErr = err;
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  console.warn('[threat/hibp] all retries failed for', emailHash, lastErr);
  return null;
}

async function fetchWithTimeout(
  url: string, timeoutMs: number, apiKey: string,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'hibp-api-key': apiKey,
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function summarise(emailHash: string, breaches: Array<Record<string, unknown>>): HibpResult {
  let mostRecentMs = 0;
  for (const b of breaches) {
    const date = typeof b.BreachDate === 'string' ? b.BreachDate : null;
    if (date) {
      const ms = Date.parse(date);
      if (!Number.isNaN(ms) && ms > mostRecentMs) mostRecentMs = ms;
    }
  }
  return {
    email_hash: emailHash,
    breach_count: breaches.length,
    most_recent_breach_iso: mostRecentMs > 0 ? new Date(mostRecentMs).toISOString() : null,
    fetched_at: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
