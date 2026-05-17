/**
 * Local swap history — records every successful in-app Jupiter swap so
 * the merchant's Recent Activity feed can show them alongside trades
 * and raw on-chain txs.
 *
 * Why localStorage: swaps go straight through Jupiter on-chain, the
 * backend never sees them. Persisting client-side keeps the activity
 * feed honest about what *this* device's user did. List is capped at
 * SWAP_LIMIT to keep the storage footprint small; the on-chain TX tab
 * is the authoritative full record for anyone who wants to audit.
 */
const SWAP_LIMIT = 50;

export interface SwapRecord {
  signature: string;
  inputSymbol: string;
  inputAmount: number;
  outputSymbol: string;
  outputAmount: number;
  /** Unix seconds — matches the on-chain blockTime field for sort
   *  consistency with the activity feed. */
  blockTime: number;
}

function key(actorId: string): string {
  return `blip:swapHistory:${actorId}`;
}

/** Append a successful swap to the per-actor history list. Caller is
 *  expected to invoke this exactly once per confirmed swap. Failures
 *  to write (private mode, full quota) are swallowed — the swap
 *  already happened on-chain, missing local cache is non-critical. */
export function recordSwap(actorId: string | null | undefined, record: SwapRecord): void {
  if (!actorId) return;
  try {
    const existing = loadSwaps(actorId);
    // Dedup on signature to avoid double-writes from React strict-mode
    // re-renders or fast retries that landed the same sig twice.
    const dedup = existing.filter((s) => s.signature !== record.signature);
    const next = [record, ...dedup].slice(0, SWAP_LIMIT);
    localStorage.setItem(key(actorId), JSON.stringify(next));
  } catch {
    /* ignore — see comment above */
  }
}

/** Read the swap history for the given actor, newest-first. Returns
 *  an empty array on any parse or storage error. */
export function loadSwaps(actorId: string | null | undefined): SwapRecord[] {
  if (!actorId) return [];
  try {
    const raw = localStorage.getItem(key(actorId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SwapRecord =>
        typeof s === "object" &&
        s !== null &&
        typeof s.signature === "string" &&
        typeof s.inputSymbol === "string" &&
        typeof s.outputSymbol === "string" &&
        typeof s.inputAmount === "number" &&
        typeof s.outputAmount === "number" &&
        typeof s.blockTime === "number",
    );
  } catch {
    return [];
  }
}
