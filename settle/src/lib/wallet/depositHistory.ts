/**
 * Local deposit history — records every successful in-app cross-chain
 * deposit (LI.FI bridge) so the merchant's Recent Activity feed can
 * show it alongside trades, swaps, and raw on-chain txs.
 *
 * Why localStorage: cross-chain deposits land directly on Solana, the
 * backend doesn't sit on the LI.FI status webhook, so persisting
 * client-side keeps the activity feed honest about what *this* device's
 * user did. List is capped at DEPOSIT_LIMIT to keep storage small; the
 * authoritative full record is the on-chain TX tab.
 */
const DEPOSIT_LIMIT = 50;

export interface DepositRecord {
  /** Destination Solana tx signature — primary dedupe key. */
  destSignature: string;
  /** Source chain (EVM) tx hash — for the "view on source explorer" link. */
  sourceTxHash: string;
  /** Human-readable source chain label e.g. "Ethereum", "Base". */
  sourceChain: string;
  /** USDT amount that landed on Solana (final, after bridge fees). */
  amountUsdt: number;
  /** Unix seconds — matches the on-chain blockTime field for sort
   *  consistency with the activity feed. */
  blockTime: number;
}

function key(actorId: string): string {
  return `blip:depositHistory:${actorId}`;
}

/** Append a successful deposit to the per-actor history list. Caller is
 *  expected to invoke this exactly once per confirmed deposit. Failures
 *  to write (private mode, full quota) are swallowed — the deposit
 *  already happened on-chain, missing local cache is non-critical. */
export function recordDeposit(
  actorId: string | null | undefined,
  record: DepositRecord,
): void {
  if (!actorId) return;
  try {
    const existing = loadDeposits(actorId);
    // Dedup on destSignature to avoid double-writes from React strict-mode
    // re-renders or fast retries that landed the same sig twice.
    const dedup = existing.filter((d) => d.destSignature !== record.destSignature);
    const next = [record, ...dedup].slice(0, DEPOSIT_LIMIT);
    localStorage.setItem(key(actorId), JSON.stringify(next));
  } catch {
    /* ignore — see comment above */
  }
  // Notify other surfaces (e.g. desktop ActivityPanel) that wallet
  // activity changed so they can refresh on-chain views. Same-tab only;
  // cross-tab still relies on the storage event in MobileHomeView's
  // tick-bump pattern. Wrapped in a try/catch because non-browser
  // environments (SSR, tests) won't have `window`.
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('blip:wallet-activity', { detail: { kind: 'deposit' } }));
    }
  } catch { /* ignore */ }
}

/** Read the deposit history for the given actor, newest-first. Returns
 *  an empty array on any parse or storage error. */
export function loadDeposits(actorId: string | null | undefined): DepositRecord[] {
  if (!actorId) return [];
  try {
    const raw = localStorage.getItem(key(actorId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is DepositRecord =>
        typeof d === 'object' &&
        d !== null &&
        typeof d.destSignature === 'string' &&
        typeof d.sourceTxHash === 'string' &&
        typeof d.sourceChain === 'string' &&
        typeof d.amountUsdt === 'number' &&
        typeof d.blockTime === 'number',
    );
  } catch {
    return [];
  }
}
