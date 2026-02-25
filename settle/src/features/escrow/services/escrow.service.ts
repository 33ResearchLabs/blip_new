/**
 * Escrow Service — API communication for escrow operations
 *
 * Pure async functions for escrow deposit, release, and status queries.
 * No React state, no business logic, no escrow-payer determination.
 *
 * SAFETY: This file MUST NOT contain:
 *  - Escrow payer determination logic (determineEscrowPayer)
 *  - Balance deduction logic (mockEscrowLock)
 *  - On-chain transaction building (that's in lib/solana/)
 *  - Role resolution
 *
 * The API route handles all escrow rules (who pays, mock vs on-chain,
 * core-api proxying, Pusher notifications).
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface EscrowDepositParams {
  orderId: string;
  tx_hash: string;
  actor_type: 'user' | 'merchant';
  actor_id: string;
  escrow_address?: string | null;
  escrow_trade_id?: number | null;
  escrow_trade_pda?: string | null;
  escrow_pda?: string | null;
  escrow_creator_wallet?: string | null;
}

export interface EscrowReleaseParams {
  orderId: string;
  tx_hash: string;
  actor_type: 'user' | 'merchant' | 'system';
  actor_id: string;
}

export interface EscrowStatusResult {
  order_id: string;
  status: string;
  escrow_tx_hash: string | null;
  escrow_address: string | null;
  release_tx_hash: string | null;
  escrowed_at: string | null;
  crypto_amount: number;
  crypto_currency: string;
  is_escrowed: boolean;
  is_released: boolean;
  [key: string]: unknown;
}

// ─── Service functions ────────────────────────────────────────────────

/** Get escrow status for an order */
export async function getEscrowStatus(orderId: string): Promise<EscrowStatusResult> {
  const res = await fetch(`/api/orders/${orderId}/escrow`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to fetch escrow status');
  }
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Failed to fetch escrow status');
  return data.data;
}

/** Record escrow deposit (lock funds) */
export async function depositEscrow(params: EscrowDepositParams) {
  const { orderId, ...body } = params;
  const res = await fetch(`/api/orders/${orderId}/escrow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to deposit escrow');
  }
  return data.data;
}

/** Record escrow release (unlock funds to buyer) */
export async function releaseEscrow(params: EscrowReleaseParams) {
  const { orderId, ...body } = params;
  const res = await fetch(`/api/orders/${orderId}/escrow`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to release escrow');
  }
  return data.data;
}
