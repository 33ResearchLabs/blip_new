/**
 * LI.FI cross-chain status polling. Once the source-chain tx is
 * broadcast, we hit GET /v1/status?txHash=… every few seconds until
 * the bridge marks it DONE (destination credited) or FAILED.
 *
 * The caller passes a callback to receive each status tick so the UI
 * can show stage transitions (PENDING → DONE) without managing the
 * poll loop itself.
 */

import { LIFI_API_BASE } from './config';

export type LifiSubstatus =
  | 'WAIT_SOURCE_CONFIRMATIONS'
  | 'WAIT_DESTINATION_TRANSACTION'
  | 'BRIDGE_NOT_AVAILABLE'
  | 'CHAIN_NOT_AVAILABLE'
  | 'NOT_PROCESSABLE_REFUND_NEEDED'
  | 'REFUND_IN_PROGRESS'
  | 'UNKNOWN_ERROR'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'REFUNDED';

export type LifiStatus = 'NOT_FOUND' | 'INVALID' | 'PENDING' | 'DONE' | 'FAILED';

export interface CrossChainStatus {
  status: LifiStatus;
  substatus?: LifiSubstatus;
  /** Destination-chain tx hash once the credit lands. */
  destinationTxHash?: string;
  /** Settled USDT amount on Solana (human-readable). */
  receivedUsdt?: string;
}

const POLL_INTERVAL_MS = 4_000;
const MAX_POLL_MS = 15 * 60_000; // 15 minutes — beyond this, give up

export async function fetchStatusOnce(txHash: string): Promise<CrossChainStatus | null> {
  try {
    const res = await fetch(`${LIFI_API_BASE}/status?txHash=${encodeURIComponent(txHash)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: LifiStatus;
      substatus?: LifiSubstatus;
      receiving?: { txHash?: string; amount?: string; token?: { decimals?: number } };
    };
    if (!j.status) return null;
    let receivedUsdt: string | undefined;
    if (j.receiving?.amount) {
      const decimals = j.receiving.token?.decimals ?? 6;
      receivedUsdt = (Number(j.receiving.amount) / 10 ** decimals).toFixed(2);
    }
    return {
      status: j.status,
      substatus: j.substatus,
      destinationTxHash: j.receiving?.txHash,
      receivedUsdt,
    };
  } catch {
    return null;
  }
}

/** Polls /v1/status until the bridge settles. `onTick` is invoked for
 *  every non-null status update (so the UI can render progress). The
 *  returned promise resolves with the final status; rejects only on
 *  the hard-timeout case (15 min) — bridge stalls long enough for
 *  the user to walk away. */
export async function pollUntilDone(
  txHash: string,
  onTick: (status: CrossChainStatus) => void,
): Promise<CrossChainStatus> {
  const deadline = Date.now() + MAX_POLL_MS;
  let lastSeen: CrossChainStatus | null = null;
  while (Date.now() < deadline) {
    const s = await fetchStatusOnce(txHash);
    if (s) {
      lastSeen = s;
      onTick(s);
      if (s.status === 'DONE' || s.status === 'FAILED') return s;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  // Timed out — return whatever the last seen status was (or a stub
  // FAILED) so the UI can surface an "it's taking longer than usual"
  // message with a link to the explorer.
  return lastSeen ?? { status: 'FAILED' };
}
