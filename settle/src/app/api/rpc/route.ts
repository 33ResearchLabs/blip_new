/**
 * Solana JSON-RPC Proxy
 *
 * Browsers need to talk to a Solana RPC endpoint to read accounts, fetch
 * blockhashes, and submit signed transactions. Pointing them at a paid
 * endpoint (Helius / QuickNode / etc.) directly via NEXT_PUBLIC_SOLANA_RPC_URL
 * leaks the API key into the bundle, DevTools' Network tab, and any captured
 * HAR — exposing the project's quota to free quota-burning by anyone who
 * inspects the page.
 *
 * This route forwards JSON-RPC requests server-side using the SECRET
 * SOLANA_RPC_URL_PRIVATE env var (never exposed to the client). A per-IP
 * rate limit caps the abuse window if someone scripts the proxy itself, and
 * an explicit method allowlist blocks expensive / admin / write-amplifying
 * methods.
 *
 * Latency cost: one additional hop (browser → settle → upstream). On Railway
 * intra-region links this is typically ~30–80 ms; well within the wait
 * tolerance of any wallet flow.
 *
 * Configuration:
 *   SOLANA_RPC_URL_PRIVATE          (required, server-side) — the keyed URL
 *   NEXT_PUBLIC_SOLANA_RPC_URL      (optional, fallback) — public endpoint;
 *                                    used if PRIVATE is unset (dev only)
 *   SOLANA_RPC_PROXY_ALLOWED_METHODS (optional) — CSV override for the
 *                                    allowlist below
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/middleware/rateLimit';

// Method allowlist: every JSON-RPC method a wallet / read client legitimately
// needs. Anything outside this set is rejected at the proxy edge so the
// upstream provider's quota cannot be burned with arbitrary requests.
//
// Notable exclusions:
//   - requestAirdrop          (devnet faucet — only enabled if explicitly opted-in)
//   - getProgramAccounts      (very expensive on most endpoints; allow only if
//                              opted-in via env)
//   - admin / *Subscribe RPCs (websocket only; proxy is HTTP)
const DEFAULT_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getEpochInfo',
  'getFeeForMessage',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getMultipleAccounts',
  'getRecentPerformanceSamples',
  'getRecentPrioritizationFees',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getSlot',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTokenSupply',
  'getTransaction',
  'getVersion',
  'isBlockhashValid',
  'sendTransaction',
  'simulateTransaction',
  'getHealth',
  'getSlotLeaders',
  'getBlock',
  'getGenesisHash',
]);

function getAllowedMethods(): ReadonlySet<string> {
  const override = process.env.SOLANA_RPC_PROXY_ALLOWED_METHODS;
  if (!override) return DEFAULT_ALLOWED_METHODS;
  return new Set(
    override
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0),
  );
}

function getUpstreamUrl(): string | null {
  // Prefer the private (key-bearing) URL. Fall back to the public env only
  // for local/dev parity — production deployments MUST set the private one.
  const priv = process.env.SOLANA_RPC_URL_PRIVATE?.trim();
  if (priv) return priv;
  const pub = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
  if (pub) return pub;
  return null;
}

/** RPC: 120/min per IP. Wallet flows make small bursts; humans wait between. */
const RPC_RATE_LIMIT = { maxRequests: 120, windowSeconds: 60 };

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  return typeof v === 'object' && v !== null && 'method' in v;
}

function jsonRpcError(id: string | number | null | undefined, code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message } },
    { status: 200 }, // JSON-RPC errors travel inside a 200 by convention
  );
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'solana_rpc_proxy', RPC_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const upstream = getUpstreamUrl();
  if (!upstream) {
    // Server misconfiguration. Don't leak which env var is missing.
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'RPC proxy not configured' } },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  // Solana JSON-RPC supports batch (array) requests. Validate every entry.
  const items: JsonRpcRequest[] = Array.isArray(body) ? body : [body as JsonRpcRequest];
  if (items.length === 0) {
    return jsonRpcError(null, -32600, 'Invalid Request');
  }

  const allowed = getAllowedMethods();
  for (const item of items) {
    if (!isJsonRpcRequest(item) || typeof item.method !== 'string') {
      return jsonRpcError(item?.id ?? null, -32600, 'Invalid Request');
    }
    if (!allowed.has(item.method)) {
      // Distinct error code so client logs surface the gate clearly.
      console.warn('[rpc-proxy] blocked method:', item.method);
      return jsonRpcError(item.id ?? null, -32601, `Method not allowed: ${item.method}`);
    }
  }

  // Forward upstream. Hard timeout — a slow RPC must not hold a Next route
  // hostage and consume serverless minutes.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Forward only the JSON body. Do NOT forward the client's
        // Authorization, Cookie, or X-* headers — those belong to settle's
        // session, not the upstream RPC, and could leak user state.
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await upstreamRes.text();
    // Pass through upstream's status + body verbatim. Do NOT echo upstream
    // response headers (they may include rate-limit info that fingerprints
    // the provider / plan tier).
    return new NextResponse(text, {
      status: upstreamRes.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return jsonRpcError(null, -32603, 'Upstream RPC timeout');
    }
    console.error('[rpc-proxy] upstream error:', (err as Error)?.message);
    return jsonRpcError(null, -32603, 'Upstream RPC error');
  } finally {
    clearTimeout(timeout);
  }
}

// Reject other methods explicitly so proxy fetch behaviour is predictable.
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed; use POST' },
    { status: 405 },
  );
}
