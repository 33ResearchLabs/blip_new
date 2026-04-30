/**
 * Refund-target resolution + validation.
 *
 * Two pure functions, no DB. The resolver mirrors migration 052's
 * role-derivation rules; the validator enforces consistency between the
 * resolved target and the order's trade roles before any balance is moved.
 */

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  resolveRefundTarget,
  validateRefundTarget,
  OrderForRefund,
} from '@/lib/orders/escrowRefundTarget';

const baseSell: OrderForRefund = {
  id: 'order-sell',
  type: 'sell',
  user_id: 'user-A',
  merchant_id: 'merchant-B',
  buyer_merchant_id: null,
  crypto_amount: '100',
  escrow_tx_hash: 'tx-1',
  escrow_debited_entity_id: 'user-A',
  escrow_debited_entity_type: 'user',
  escrow_debited_amount: '100',
};

const baseBuy: OrderForRefund = {
  id: 'order-buy',
  type: 'buy',
  user_id: 'user-A',
  merchant_id: 'merchant-B',
  buyer_merchant_id: null,
  crypto_amount: '100',
  escrow_tx_hash: 'tx-1',
  escrow_debited_entity_id: 'merchant-B',
  escrow_debited_entity_type: 'merchant',
  escrow_debited_amount: '100',
};

const baseM2M: OrderForRefund = {
  id: 'order-m2m',
  type: 'buy',
  user_id: 'placeholder-user',
  merchant_id: 'merchant-seller',
  buyer_merchant_id: 'merchant-buyer',
  crypto_amount: '50',
  escrow_tx_hash: 'tx-1',
  escrow_debited_entity_id: 'merchant-seller',
  escrow_debited_entity_type: 'merchant',
  escrow_debited_amount: '50',
};

describe('resolveRefundTarget — recorded path (post-migration-026)', () => {
  test('SELL order with recorded fields → recorded target = user', () => {
    const r = resolveRefundTarget(baseSell);
    expect(r).toMatchObject({
      kind: 'recorded',
      entityId: 'user-A',
      entityType: 'user',
      amount: 100,
    });
  });

  test('BUY order with recorded fields → recorded target = merchant', () => {
    const r = resolveRefundTarget(baseBuy);
    expect(r).toMatchObject({
      kind: 'recorded',
      entityId: 'merchant-B',
      entityType: 'merchant',
      amount: 100,
    });
  });

  test('M2M order with recorded fields → recorded target = seller merchant', () => {
    const r = resolveRefundTarget(baseM2M);
    expect(r).toMatchObject({
      kind: 'recorded',
      entityId: 'merchant-seller',
      entityType: 'merchant',
    });
  });

  test('amount falls back to crypto_amount when escrow_debited_amount missing', () => {
    const r = resolveRefundTarget({
      ...baseSell, escrow_debited_amount: null, crypto_amount: '99.5',
    });
    expect(r).toMatchObject({ kind: 'recorded', amount: 99.5 });
  });

  test('zero/negative amount → indeterminate', () => {
    const r = resolveRefundTarget({
      ...baseSell, escrow_debited_amount: '0', crypto_amount: '0',
    });
    expect(r.kind).toBe('indeterminate');
  });

  test('non-numeric amount → indeterminate', () => {
    const r = resolveRefundTarget({
      ...baseSell, escrow_debited_amount: 'banana', crypto_amount: null,
    });
    expect(r.kind).toBe('indeterminate');
  });

  test('unsupported entity_type (e.g. "system") → indeterminate', () => {
    const r = resolveRefundTarget({
      ...baseSell, escrow_debited_entity_type: 'system' as any,
    });
    expect(r.kind).toBe('indeterminate');
  });
});

describe('resolveRefundTarget — no escrow path', () => {
  test('escrow_tx_hash null → no_escrow regardless of other fields', () => {
    const r = resolveRefundTarget({ ...baseSell, escrow_tx_hash: null });
    expect(r).toEqual({ kind: 'no_escrow' });
  });
});

describe('resolveRefundTarget — legacy fallback (pre-026, no recorded fields)', () => {
  const legacySell: OrderForRefund = {
    ...baseSell,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
  };
  const legacyBuy: OrderForRefund = {
    ...baseBuy,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
  };
  const legacyM2M: OrderForRefund = {
    ...baseM2M,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
  };

  test('legacy SELL → user is seller (refund target=user_id)', () => {
    const r = resolveRefundTarget(legacySell);
    expect(r).toMatchObject({
      kind: 'legacy_derived',
      entityId: 'user-A',
      entityType: 'user',
      amount: 100,
    });
  });

  test('legacy BUY → merchant is seller (refund target=merchant_id)', () => {
    const r = resolveRefundTarget(legacyBuy);
    expect(r).toMatchObject({
      kind: 'legacy_derived',
      entityId: 'merchant-B',
      entityType: 'merchant',
      amount: 100,
    });
  });

  test('legacy M2M → merchant_id is seller regardless of order.type', () => {
    const r = resolveRefundTarget(legacyM2M);
    expect(r).toMatchObject({
      kind: 'legacy_derived',
      entityId: 'merchant-seller',
      entityType: 'merchant',
    });
  });

  test('legacy M2M with type=sell still resolves to merchant_id (M2M rule overrides type)', () => {
    const r = resolveRefundTarget({ ...legacyM2M, type: 'sell' });
    expect(r).toMatchObject({
      kind: 'legacy_derived',
      entityId: 'merchant-seller',
      entityType: 'merchant',
    });
  });

  test('legacy with no type and no buyer_merchant_id → indeterminate', () => {
    const r = resolveRefundTarget({
      ...legacySell, type: null as any, buyer_merchant_id: null,
    });
    expect(r.kind).toBe('indeterminate');
  });

  test('legacy SELL but missing user_id → indeterminate', () => {
    const r = resolveRefundTarget({ ...legacySell, user_id: null });
    expect(r.kind).toBe('indeterminate');
  });

  test('legacy with no crypto_amount → indeterminate (no fallback amount)', () => {
    const r = resolveRefundTarget({ ...legacySell, crypto_amount: null });
    expect(r.kind).toBe('indeterminate');
  });
});

describe('validateRefundTarget — accepts consistent targets', () => {
  test('SELL: target user_id with type=user → ok', () => {
    expect(validateRefundTarget(baseSell, { entityId: 'user-A', entityType: 'user' }))
      .toEqual({ ok: true });
  });

  test('BUY: target merchant_id with type=merchant → ok', () => {
    expect(validateRefundTarget(baseBuy, { entityId: 'merchant-B', entityType: 'merchant' }))
      .toEqual({ ok: true });
  });

  test('M2M: target buyer_merchant_id with type=merchant → ok (buyer merchant is also a party)', () => {
    expect(validateRefundTarget(baseM2M, { entityId: 'merchant-buyer', entityType: 'merchant' }))
      .toEqual({ ok: true });
  });
});

describe('validateRefundTarget — rejects mismatches & corruption', () => {
  test('foreign entity_id (not a party) → rejected with party list in reason', () => {
    const r = validateRefundTarget(baseSell, {
      entityId: 'attacker-wallet',
      entityType: 'user',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not a party to order/);
    expect(r.reason).toMatch(/user=user-A/);
  });

  test('entity_type=user but entity_id matches merchant_id → rejected', () => {
    const r = validateRefundTarget(baseSell, {
      entityId: 'merchant-B',
      entityType: 'user',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/entity_type='user' but entity_id/);
  });

  test('entity_type=merchant but entity_id matches user_id → rejected', () => {
    const r = validateRefundTarget(baseBuy, {
      entityId: 'user-A',
      entityType: 'merchant',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/entity_type='merchant' but entity_id/);
  });

  test('unsupported entity_type → rejected', () => {
    const r = validateRefundTarget(baseSell, {
      entityId: 'user-A',
      entityType: 'platform' as any,
    });
    expect(r.ok).toBe(false);
  });
});
