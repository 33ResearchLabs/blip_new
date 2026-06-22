/**
 * ensureGas — client helper for the platform gas station.
 *
 * Asks POST /api/wallet/gas to top the given embedded wallet up to the small
 * SOL ceiling so the next on-chain action doesn't fail with "insufficient
 * SOL". Best-effort and non-throwing: a false result just means the caller
 * falls back to whatever SOL the wallet already has.
 *
 * The server enforces all the abuse caps (cooldown, ceiling, daily/global
 * budgets); this helper only kicks off the request and reports whether a
 * transfer actually happened.
 */

import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

export interface EnsureGasResult {
  /** True when the sponsor actually sent SOL on this call. */
  funded: boolean;
  /** Reason / status from the server (e.g. "sufficient", "cooldown"). */
  reason?: string;
}

export async function ensureGas(walletAddress: string): Promise<EnsureGasResult> {
  if (!walletAddress) return { funded: false, reason: "no_wallet" };
  try {
    const res = await fetchWithAuth("/api/wallet/gas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet_address: walletAddress }),
    });
    if (!res.ok) return { funded: false, reason: `http_${res.status}` };
    const data = await res.json().catch(() => null);
    return {
      funded: !!data?.data?.funded,
      reason: data?.data?.reason,
    };
  } catch {
    return { funded: false, reason: "network" };
  }
}
