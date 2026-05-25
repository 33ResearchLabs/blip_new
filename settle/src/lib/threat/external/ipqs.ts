// IPQualityScore (IPQS) client. Queries IP reputation: datacenter ASN,
// VPN / Tor / proxy detection, and fraud score (0–100).
//
// Operational guarantees:
//   * 24h Redis cache on the IP (cheap miss-to-hit ratio for a waitlist)
//   * 1500 ms timeout per request
//   * 2 retries on 5xx / network errors (with 250 ms then 750 ms backoff)
//   * Returns null on any failure or when IPQS_API_KEY is unset
//   * Never throws — calling code can assume null when no signal is available
//
// Docs: https://www.ipqualityscore.com/documentation/proxy-detection/overview

import cache from '@/lib/cache/redis';

const CACHE_PREFIX = 'ipqs:';
const CACHE_TTL_SECONDS = 86_400;   // 24h
const REQUEST_TIMEOUT_MS = 1500;
const RETRY_DELAYS_MS = [250, 750];

export interface IpqsResult {
  ip: string;
  fraud_score: number;          // 0..100
  is_datacenter: boolean;
  is_vpn: boolean;
  is_tor: boolean;
  is_proxy: boolean;
  country_code: string | null;  // ISO 2-letter
  asn: number | null;
  organization: string | null;
  recent_abuse: boolean;
  fetched_at: string;           // ISO timestamp
}

/**
 * Look up an IP. Returns the IPQS result on success, null on any error or
 * when the API key is missing. Safe to call from any path — never throws.
 */
export async function checkIp(rawIp: string | null | undefined): Promise<IpqsResult | null> {
  if (!rawIp) return null;
  const ip = rawIp.trim();
  if (!ip || ip === '127.0.0.1' || ip === '::1') return null;

  const apiKey = process.env.IPQS_API_KEY;
  if (!apiKey) return null;

  // Cache hit?
  const cached = await cache.get<IpqsResult>(`${CACHE_PREFIX}${ip}`);
  if (cached) return cached;

  const url = `https://www.ipqualityscore.com/api/json/ip/${encodeURIComponent(apiKey)}/${encodeURIComponent(ip)}?strictness=1&allow_public_access_points=true`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
      if (!result) { lastErr = new Error('null fetch result'); continue; }
      // 5xx → retry; 4xx → permanent failure (bad key / quota / invalid IP)
      if (result.status >= 500) { lastErr = new Error(`5xx: ${result.status}`); }
      else if (!result.ok) { return null; }
      else {
        const raw = await result.json().catch(() => null) as Record<string, unknown> | null;
        if (!raw || raw.success === false) return null;
        const parsed = mapIpqsResponse(ip, raw);
        await cache.set(`${CACHE_PREFIX}${ip}`, parsed, CACHE_TTL_SECONDS);
        return parsed;
      }
    } catch (err) {
      lastErr = err;
    }
    // Sleep before next retry (skip after the last attempt).
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  console.warn('[threat/ipqs] all retries failed for', ip, lastErr);
  return null;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      // IPQS responds quickly — no special headers needed.
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function mapIpqsResponse(ip: string, raw: Record<string, unknown>): IpqsResult {
  const num = (v: unknown, fallback = 0): number => {
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? fallback : n;
    }
    return fallback;
  };
  const bool = (v: unknown): boolean => v === true || v === 'true';
  const str = (v: unknown): string | null => typeof v === 'string' && v.length ? v : null;

  return {
    ip,
    fraud_score: Math.max(0, Math.min(100, num(raw.fraud_score))),
    is_datacenter: bool(raw.is_crawler) || bool(raw.is_datacenter)
      || /datacenter|hosting|cloud/i.test(typeof raw.connection_type === 'string' ? raw.connection_type : ''),
    is_vpn: bool(raw.vpn),
    is_tor: bool(raw.tor),
    is_proxy: bool(raw.proxy),
    country_code: str(raw.country_code),
    asn: typeof raw.ASN === 'number' ? raw.ASN : null,
    organization: str(raw.organization) ?? str(raw.ISP),
    recent_abuse: bool(raw.recent_abuse),
    fetched_at: new Date().toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
