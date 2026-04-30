/**
 * Resolve & validate the entity that should receive an escrow refund.
 *
 * Source of truth: orders.escrow_debited_entity_id / _entity_type / _amount,
 * captured atomically when the seller locks escrow (migration 026).
 *
 * Legacy fallback: orders created before migration 026 may have these fields
 * NULL. Migration 052 backfills orders in payment-status statuses and
 * enforces a CHECK constraint, BUT 'disputed' is NOT in that constraint's
 * scope — a dispute raised on a pre-026 escrowed order can still hit this
 * code path with NULL fields. We mirror migration 052's role rules:
 *
 *   M2M (buyer_merchant_id NOT NULL)  → merchant_id is seller (merchant)
 *   BUY  (buyer_merchant_id NULL,      → merchant_id is seller (merchant)
 *         type='buy')
 *   SELL (buyer_merchant_id NULL,      → user_id is seller (user)
 *         type='sell')
 *
 * Validation: regardless of source (recorded or derived), the target MUST be
 * one of {user_id, merchant_id, buyer_merchant_id} on the order, AND the
 * entity_type must be consistent with which role the entity_id belongs to.
 * A mismatch is treated as data corruption — refund is REFUSED rather than
 * sent to a potentially wrong party. The dispute resolution then surfaces a
 * clean 422 to compliance for manual investigation.
 */

import { logger } from '@/lib/logger';

export type EntityType = 'user' | 'merchant';

export interface OrderForRefund {
  id?: string;
  type?: 'buy' | 'sell' | string | null;
  user_id?: string | null;
  merchant_id?: string | null;
  buyer_merchant_id?: string | null;
  crypto_amount?: string | number | null;
  escrow_tx_hash?: string | null;
  escrow_debited_entity_id?: string | null;
  escrow_debited_entity_type?: EntityType | string | null;
  escrow_debited_amount?: string | number | null;
}

export interface RefundTargetResolved {
  kind: 'recorded' | 'legacy_derived';
  entityId: string;
  entityType: EntityType;
  amount: number;
  /** Audit field — explains how the target was chosen. */
  rationale: string;
}

export interface RefundTargetNoEscrow {
  kind: 'no_escrow';
}

export interface RefundTargetIndeterminate {
  kind: 'indeterminate';
  reason: string;
}

export type RefundTargetResolution =
  | RefundTargetResolved
  | RefundTargetNoEscrow
  | RefundTargetIndeterminate;

export interface RefundTargetValidation {
  ok: boolean;
  reason?: string;
}

const SUPPORTED_ENTITY_TYPES: ReadonlySet<string> = new Set(['user', 'merchant']);

function safeNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the refund target for an order. Pure function — no DB calls.
 * Caller must wrap any logging/persistence around the result.
 */
export function resolveRefundTarget(order: OrderForRefund): RefundTargetResolution {
  if (!order.escrow_tx_hash) return { kind: 'no_escrow' };

  // Recorded path — the field set at lock time. Preferred when present.
  const recordedId = order.escrow_debited_entity_id;
  const recordedType = order.escrow_debited_entity_type;
  if (recordedId && recordedType) {
    if (!SUPPORTED_ENTITY_TYPES.has(String(recordedType))) {
      return {
        kind: 'indeterminate',
        reason: `escrow_debited_entity_type='${recordedType}' is not a supported entity type`,
      };
    }
    const amount = safeNumber(order.escrow_debited_amount)
      ?? safeNumber(order.crypto_amount); // ultra-rare: id+type set but amount missing
    if (amount === null || amount <= 0) {
      return { kind: 'indeterminate', reason: 'escrow_debited_amount missing or non-positive' };
    }
    return {
      kind: 'recorded',
      entityId: recordedId,
      entityType: recordedType as EntityType,
      amount,
      rationale: 'escrow_debited_entity_id recorded at lock time',
    };
  }

  // Legacy fallback. Mirrors migration 052 role-derivation rules exactly.
  const cryptoAmount = safeNumber(order.crypto_amount);
  if (cryptoAmount === null || cryptoAmount <= 0) {
    return {
      kind: 'indeterminate',
      reason: 'legacy order has no escrow_debited_entity_id and no crypto_amount to fall back on',
    };
  }

  // Rule 1: M2M — merchant_id is ALWAYS seller (regardless of order.type).
  if (order.buyer_merchant_id && order.merchant_id) {
    return {
      kind: 'legacy_derived',
      entityId: order.merchant_id,
      entityType: 'merchant',
      amount: cryptoAmount,
      rationale: 'legacy: M2M order, merchant_id is always the seller',
    };
  }

  // Rule 2: U2M BUY — merchant is the seller.
  if (order.type === 'buy' && order.merchant_id) {
    return {
      kind: 'legacy_derived',
      entityId: order.merchant_id,
      entityType: 'merchant',
      amount: cryptoAmount,
      rationale: 'legacy: BUY order, merchant is the seller',
    };
  }

  // Rule 3: U2M SELL — user is the seller.
  if (order.type === 'sell' && order.user_id) {
    return {
      kind: 'legacy_derived',
      entityId: order.user_id,
      entityType: 'user',
      amount: cryptoAmount,
      rationale: 'legacy: SELL order, user is the seller',
    };
  }

  return {
    kind: 'indeterminate',
    reason: `legacy order with type='${order.type ?? 'unknown'}' and missing role IDs is not derivable`,
  };
}

/**
 * Confirm the refund target is internally consistent with the order's
 * trade roles. Defends against:
 *   - corrupted escrow_debited_entity_id pointing to a foreign UUID
 *   - escrow_debited_entity_type='user' with id matching merchant_id (or vice versa)
 *
 * On failure, the caller MUST refuse the refund and surface a clear error
 * for compliance / on-call review. Funds going to an unintended party is
 * a worse outcome than a manual investigation.
 */
export function validateRefundTarget(
  order: OrderForRefund,
  target: { entityId: string; entityType: EntityType }
): RefundTargetValidation {
  const trade = {
    user_id: order.user_id ?? null,
    merchant_id: order.merchant_id ?? null,
    buyer_merchant_id: order.buyer_merchant_id ?? null,
  };
  const parties = Object.values(trade).filter((v): v is string => !!v);

  if (!parties.includes(target.entityId)) {
    return {
      ok: false,
      reason:
        `refund target ${target.entityId} is not a party to order ` +
        `(parties: user=${trade.user_id ?? '-'}, merchant=${trade.merchant_id ?? '-'}, ` +
        `buyer_merchant=${trade.buyer_merchant_id ?? '-'})`,
    };
  }

  if (target.entityType === 'user') {
    if (target.entityId !== trade.user_id) {
      return {
        ok: false,
        reason: `entity_type='user' but entity_id ${target.entityId} does not match user_id ${trade.user_id}`,
      };
    }
  } else if (target.entityType === 'merchant') {
    if (target.entityId !== trade.merchant_id && target.entityId !== trade.buyer_merchant_id) {
      return {
        ok: false,
        reason:
          `entity_type='merchant' but entity_id ${target.entityId} does not match ` +
          `merchant_id ${trade.merchant_id} or buyer_merchant_id ${trade.buyer_merchant_id}`,
      };
    }
  } else {
    return { ok: false, reason: `unsupported entity_type='${target.entityType}'` };
  }

  return { ok: true };
}

/** Convenience for callers — log a structured warning when falling back to legacy. */
export function logLegacyRefundDerivation(orderId: string | undefined, target: RefundTargetResolved): void {
  logger.warn('[security] dispute refund: using LEGACY role-derived escrow funder', {
    orderId,
    entityId: target.entityId,
    entityType: target.entityType,
    amount: target.amount,
    rationale: target.rationale,
  });
}

/** Log corruption-style mismatches loudly so the on-call gets a paged alert. */
export function logRefundTargetMismatch(
  orderId: string | undefined,
  target: { entityId: string; entityType: EntityType },
  order: OrderForRefund,
  reason: string
): void {
  logger.error('[security] dispute refund target MISMATCH — refund refused', {
    orderId,
    refund_target_entity_id: target.entityId,
    refund_target_entity_type: target.entityType,
    order_user_id: order.user_id ?? null,
    order_merchant_id: order.merchant_id ?? null,
    order_buyer_merchant_id: order.buyer_merchant_id ?? null,
    reason,
  });
}
