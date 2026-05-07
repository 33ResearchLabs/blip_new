import { NextRequest, NextResponse } from 'next/server';
import { getRpcEndpoints } from '@/lib/solana/rpc';

// Server-side probe of the active Solana RPC. Exists because public RPCs
// (api.mainnet-beta.solana.com, api.devnet.solana.com, and most public mirrors)
// reject browser POSTs without a CORS preflight allow-origin, which would make
// the wallet's Network Status card show "Down" forever despite the RPC being
// healthy. Running the same call from our server avoids the browser CORS gate
// entirely.
//
// Caches the JSON result for 8 seconds so this endpoint can be polled every
// 10s by every open wallet tab without becoming a thundering-herd amplifier
// against the RPC. Cache key includes the network so mainnet/devnet probes
// don't share state.
type ProbeResult = {
  slot: number | null;
  latency: number | null;
  healthy: boolean;
  endpoint: string | null;
  error?: string;
};

const CACHE_TTL_MS = 8_000;
const cache = new Map<string, { value: ProbeResult; expiresAt: number }>();

async function probe(url: string): Promise<{ slot: number; latency: number } | null> {
  const start = Date.now();
  try {
    // Server-side fetch: no CORS check, no preflight. We DO honor the URL's
    // own auth (api keys baked in via env are sent verbatim).
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 4_000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSlot',
        params: [{ commitment: 'confirmed' }],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.result !== 'number') return null;
    return { slot: data.result, latency: Date.now() - start };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const network =
    req.nextUrl.searchParams.get('network') === 'devnet'
      ? 'devnet'
      : 'mainnet-beta';

  const cacheKey = network;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return NextResponse.json({ success: true, data: cached.value });
  }

  // Walk env-configured endpoints first, then fall back to the canonical
  // public RPC. First successful probe wins.
  const configured = getRpcEndpoints(network).map((e) => e.url);
  const publicFallback =
    network === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com';
  const candidates = Array.from(new Set([...configured, publicFallback]));

  let result: ProbeResult = {
    slot: null,
    latency: null,
    healthy: false,
    endpoint: null,
    error: 'all endpoints failed',
  };

  for (const url of candidates) {
    const r = await probe(url);
    if (r) {
      result = {
        slot: r.slot,
        latency: r.latency,
        healthy: true,
        endpoint: url,
      };
      break;
    }
  }

  cache.set(cacheKey, { value: result, expiresAt: now + CACHE_TTL_MS });
  return NextResponse.json({ success: true, data: result });
}
