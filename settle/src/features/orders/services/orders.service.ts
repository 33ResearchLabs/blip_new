/**
 * Orders Service — API communication layer
 *
 * Pure async functions. No React state, no business logic, no role logic.
 * Delegates to the existing centralized API client or fetch() calls.
 *
 * SAFETY: This file MUST NOT contain:
 *  - Type inversion logic (merchant BUY ↔ DB sell)
 *  - Role/actor resolution (computeMyRole)
 *  - State machine transitions
 *  - Escrow payer determination
 */

import api, { ApiError } from '@/lib/api/client';

// ─── Types ────────────────────────────────────────────────────────────

export interface CreateOrderParams {
  user_id: string;
  crypto_amount: number;
  type: 'buy' | 'sell';
  payment_method: 'bank' | 'cash';
  preference?: 'fast' | 'cheap' | 'best';
  offer_id?: string;
  /** Buyer's Solana wallet for receiving crypto (buy orders) */
  buyer_wallet_address?: string;
  /** User's bank account for receiving fiat (sell orders) */
  user_bank_account?: string;
  /** On-chain escrow references (sell orders with pre-locked escrow) */
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_trade_id?: number;
}

export interface UpdateStatusParams {
  orderId: string;
  status: string;
  actorType: 'user' | 'merchant' | 'system';
  actorId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface CancelOrderParams {
  orderId: string;
  actorType: 'user' | 'merchant';
  actorId: string;
  reason?: string;
}

export interface ListOrdersParams {
  actorType: 'user' | 'merchant';
  actorId: string;
  status?: string[];
}

// ─── Service functions ────────────────────────────────────────────────

/** Fetch a single order by ID */
export async function getOrder(orderId: string) {
  return api.orders.get(orderId);
}

/** Fetch orders for user or merchant */
export async function listOrders(params: ListOrdersParams) {
  if (params.actorType === 'merchant') {
    return api.merchant.getOrders(params.actorId, params.status);
  }
  return api.orders.list(params.actorId);
}

/**
 * Create a new order — passes full payload through to API unchanged.
 * Uses raw fetch to support all optional fields (escrow refs, wallet address)
 * that the typed api client does not cover.
 */
export async function createOrder(params: CreateOrderParams) {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    const err = new ApiError(res.status, data.error || 'Failed to create order');
    (err as ApiError & { details?: string[] }).details = data.details;
    throw err;
  }
  return data.data;
}

/**
 * Update order status — passes through to API, no transition validation.
 * Uses raw fetch to support optional reason field.
 */
export async function updateOrderStatus(params: UpdateStatusParams) {
  const { orderId, status, actorType, actorId, reason, metadata } = params;
  const res = await fetch(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      actor_type: actorType,
      actor_id: actorId,
      ...(reason ? { reason } : {}),
      ...(metadata ? { metadata } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new ApiError(res.status, data.error || 'Failed to update order status');
  }
  return data.data;
}

/** Cancel an order */
export async function cancelOrder(params: CancelOrderParams) {
  return api.orders.cancel(
    params.orderId,
    params.actorType,
    params.actorId,
    params.reason,
  );
}

/** Re-export ApiError so consumers don't need a separate import */
export { ApiError };
