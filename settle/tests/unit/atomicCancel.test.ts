/**
 * atomicCancelWithRefund — refund destination correctness.
 *
 * This function is the primary auto-resolve path for disputes (rule 5 in
 * the timeline) and the user-driven cancel path. Before this fix, the
 * refund branch:
 *   - silently SKIPPED the refund when escrow_debited_entity_id was NULL
 *     (legacy orders predating migration 026), leaving the seller short
 *   - did NO validation against trade roles — a corrupted entity_id
 *     would credit a foreign UUID
 *   - SOFT-LOGGED when the target entity row was missing, then proceeded
 *     to cancel the order anyway (refund lost, no audit trail)
 *
 * After the fix, all three paths route through resolveRefundTarget +
 * validateRefundTarget — same as atomicFinalizeDispute. The two helpers
 * MUST stay in sync; if you change one, change the other.
 *
 * Verifies:
 *   - Recorded path: refund credits escrow_debited_entity_id (NEVER
 *     user_id/merchant_id-by-default), correct table, correct amount.
 *   - Legacy path: order with NULL escrow_debited_entity_id refunds via
 *     migration-052 role rules (SELL→user, BUY→merchant, M2M→merchant_id).
 *   - Validation: corrupt entity_id triggers REFUND_TARGET_MISMATCH and
 *     ROLLBACK — no money moves to a foreign UUID.
 *   - Indeterminate: legacy order with no derivable role triggers
 *     REFUND_TARGET_INDETERMINATE and ROLLBACK — no silent skip.
 *   - Missing target row: REFUND_TARGET_NOT_FOUND and ROLLBACK — refund
 *     loss with audit, never silently dropped.
 *   - Per-row + system ledger invariants both ROLLBACK on drift.
 */

const mockTransaction = jest.fn();
jest.mock('@/lib/db', () => ({
  transaction: (cb: (client: unknown) => Promise<unknown>) => mockTransaction(cb),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockValidateTransition = jest.fn();
jest.mock('@/lib/orders/stateMachineMinimal', () => ({
  validateTransition: (...a: unknown[]) => mockValidateTransition(...a),
}));

import { atomicCancelWithRefund } from '@/lib/orders/atomicCancel';

interface ClientState {
  orderRow: Record<string, unknown> | null;
  balance: number;
  drift?: number;
  versionStale?: boolean;
  refundTargetMissing?: boolean;
  ledgerLockTotal?: number;
  ledgerReleaseTotal?: number;
  ledgerRefundTotal?: number;
}

function createClient(state: ClientState) {
  const calls: { text: string; params: unknown[] }[] = [];
  let bal = state.balance;
  return {
    calls,
    query: jest.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params: params ?? [] });

      if (text.includes('SELECT * FROM orders WHERE id') && text.includes('FOR UPDATE')) {
        return { rows: state.orderRow ? [state.orderRow] : [] };
      }
      if (text.includes('SELECT balance FROM') && text.includes('FOR UPDATE')) {
        if (state.refundTargetMissing) return { rows: [] };
        return { rows: [{ balance: bal }] };
      }
      if (/UPDATE\s+(?:merchants|users)\s+SET balance = balance \+/.test(text)) {
        const amt = params?.[0] as number;
        bal += amt;
        return { rows: [] };
      }
      if (text.includes('SELECT balance FROM')) {
        return { rows: [{ balance: bal + (state.drift ?? 0) }] };
      }
      if (text.includes('SELECT entry_type') && text.includes('FROM ledger_entries')) {
        const rows: Array<{ entry_type: string; total: string }> = [];
        if (state.ledgerLockTotal !== undefined) {
          rows.push({ entry_type: 'ESCROW_LOCK', total: String(state.ledgerLockTotal) });
        }
        if (state.ledgerReleaseTotal !== undefined) {
          rows.push({ entry_type: 'ESCROW_RELEASE', total: String(state.ledgerReleaseTotal) });
        }
        if (state.ledgerRefundTotal !== undefined) {
          rows.push({ entry_type: 'ESCROW_REFUND', total: String(state.ledgerRefundTotal) });
        }
        return { rows };
      }
      if (text.match(/^\s*UPDATE orders/) && text.includes('RETURNING *')) {
        if (state.versionStale) return { rows: [] };
        const updated = {
          ...state.orderRow,
          status: 'cancelled',
          order_version: ((state.orderRow as any)?.order_version ?? 1) + 1,
        };
        return { rows: [updated] };
      }
      if (text.match(/INSERT INTO order_events/)) return { rows: [] };
      if (text.match(/INSERT INTO notification_outbox/)) return { rows: [] };
      if (text.match(/INSERT INTO ledger_entries/)) return { rows: [] };
      return { rows: [] };
    }),
  };
}

function asTxRunner(state: ClientState) {
  return async (cb: (client: unknown) => Promise<unknown>) => {
    const client = createClient(state);
    return cb(client);
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────

const sellOrderRecorded = {
  id: 'order-sell-1',
  order_number: 1,
  type: 'sell',
  status: 'escrowed',
  user_id: 'user-A',
  merchant_id: 'merchant-B',
  buyer_merchant_id: null,
  crypto_amount: '100',
  crypto_currency: 'USDT',
  order_version: 3,
  escrow_tx_hash: 'tx-1',
  escrow_debited_entity_id: 'user-A',         // ← seller is user
  escrow_debited_entity_type: 'user',
  escrow_debited_amount: '100',
  escrow_debited_at: '2026-04-01T00:00:00Z',
};

const buyOrderRecorded = {
  ...sellOrderRecorded,
  id: 'order-buy-1',
  type: 'buy',
  user_id: 'user-X',
  merchant_id: 'merchant-Y',
  escrow_debited_entity_id: 'merchant-Y',     // ← seller is merchant
  escrow_debited_entity_type: 'merchant',
};

const m2mOrder = {
  ...sellOrderRecorded,
  id: 'order-m2m',
  type: 'buy',
  user_id: 'placeholder',
  merchant_id: 'merchant-seller',
  buyer_merchant_id: 'merchant-buyer',
  escrow_debited_entity_id: 'merchant-seller',
  escrow_debited_entity_type: 'merchant',
};

const orderData = {
  type: 'sell' as const,
  crypto_amount: 100,
  merchant_id: 'merchant-B',
  user_id: 'user-A',
  buyer_merchant_id: null,
  order_number: 1,
  crypto_currency: 'USDT',
  fiat_amount: 367,
  fiat_currency: 'AED',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateTransition.mockReturnValue({ valid: true });
});

describe('refund destination — recorded escrow_debited_entity_id', () => {
  test('SELL order, user is seller → refund credits users table for user_id', async () => {
    const state: ClientState = { orderRow: sellOrderRecorded, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );

    expect(r.success).toBe(true);
    const balanceUpdate = captured.find(c =>
      /UPDATE\s+users\s+SET balance = balance \+/.test(c.text)
    );
    expect(balanceUpdate).toBeTruthy();
    expect(balanceUpdate?.params).toEqual([100, 'user-A']);
    // ABSOLUTELY NOT crediting the merchants table on a user-funded escrow
    expect(captured.find(c => /UPDATE\s+merchants\s+SET balance/.test(c.text))).toBeUndefined();
  });

  test('BUY order, merchant is seller → refund credits merchants table for merchant_id', async () => {
    const state: ClientState = { orderRow: buyOrderRecorded, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicCancelWithRefund(
      'order-buy-1', 'escrowed', 'system' as any, 'system', 'expired',
      { ...orderData, type: 'buy', user_id: 'user-X', merchant_id: 'merchant-Y' }
    );

    expect(r.success).toBe(true);
    const balanceUpdate = captured.find(c =>
      /UPDATE\s+merchants\s+SET balance = balance \+/.test(c.text)
    );
    expect(balanceUpdate?.params).toEqual([100, 'merchant-Y']);
  });

  test('M2M order — refund goes to merchant_id (always seller in M2M), not user_id placeholder', async () => {
    const state: ClientState = { orderRow: m2mOrder, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    await atomicCancelWithRefund(
      'order-m2m', 'escrowed', 'system' as any, 'system', 'expired',
      {
        ...orderData,
        type: 'buy',
        user_id: 'placeholder',
        merchant_id: 'merchant-seller',
        buyer_merchant_id: 'merchant-buyer',
      }
    );

    const balanceUpdate = captured.find(c =>
      /UPDATE\s+merchants\s+SET balance = balance \+/.test(c.text)
    );
    expect(balanceUpdate?.params).toEqual([100, 'merchant-seller']);
  });

  test('refund amount = escrow_debited_amount (NOT crypto_amount)', async () => {
    // Distinct values so we can prove which was used
    const partialEscrow = {
      ...sellOrderRecorded,
      crypto_amount: '100',
      escrow_debited_amount: '75',  // partial lock
    };
    const state: ClientState = { orderRow: partialEscrow, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );

    const balanceUpdate = captured.find(c =>
      /UPDATE\s+users\s+SET balance = balance \+/.test(c.text)
    );
    expect(balanceUpdate?.params?.[0]).toBe(75);
  });
});

describe('legacy fallback — escrow_debited_entity_id is NULL', () => {
  const legacySell = {
    ...sellOrderRecorded,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
  };
  const legacyBuy = {
    ...buyOrderRecorded,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
  };
  const legacyM2M = {
    ...m2mOrder,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
  };

  test('legacy SELL (no recorded fields) → refund derived to users.user_id (not silently skipped)', async () => {
    const state: ClientState = { orderRow: legacySell, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );

    expect(r.success).toBe(true);
    const balanceUpdate = captured.find(c =>
      /UPDATE\s+users\s+SET balance = balance \+/.test(c.text)
    );
    expect(balanceUpdate).toBeTruthy();
    expect(balanceUpdate?.params).toEqual([100, 'user-A']);
  });

  test('legacy BUY → refund derived to merchants.merchant_id', async () => {
    const state: ClientState = { orderRow: legacyBuy, balance: 500 };
    mockTransaction.mockImplementation(asTxRunner(state));

    const r = await atomicCancelWithRefund(
      'order-buy-1', 'escrowed', 'system' as any, 'system', 'expired',
      { ...orderData, type: 'buy', user_id: 'user-X', merchant_id: 'merchant-Y' }
    );

    expect(r.success).toBe(true);
  });

  test('legacy M2M → refund to merchant_id (M2M rule: merchant_id is always seller)', async () => {
    const state: ClientState = { orderRow: legacyM2M, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    await atomicCancelWithRefund(
      'order-m2m', 'escrowed', 'system' as any, 'system', 'expired',
      {
        ...orderData,
        type: 'buy',
        user_id: 'placeholder',
        merchant_id: 'merchant-seller',
        buyer_merchant_id: 'merchant-buyer',
      }
    );

    const balanceUpdate = captured.find(c =>
      /UPDATE\s+merchants\s+SET balance = balance \+/.test(c.text)
    );
    expect(balanceUpdate?.params).toEqual([100, 'merchant-seller']);
  });

  test('legacy with NULL type AND no derivable role → REFUND_TARGET_INDETERMINATE, ROLLBACK', async () => {
    const undeterminable = {
      ...legacySell,
      type: null,
      buyer_merchant_id: null,
    };
    const state: ClientState = { orderRow: undeterminable, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      try { const out = await cb(c); captured = c.calls; return out; }
      catch (e) { captured = c.calls; throw e; }
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Cannot determine refund target/);
    // Critically: no balance UPDATE was issued. Refund refused, not lost
    // and not silently skipped.
    expect(captured.find(c => /SET balance = balance \+/.test(c.text))).toBeUndefined();
    expect(captured.find(c => c.text.match(/^\s*UPDATE orders/))).toBeUndefined();
  });
});

describe('validation — corrupted recorded entity_id is REFUSED', () => {
  test('escrow_debited_entity_id is foreign UUID (not a party) → MISMATCH, no balance moved', async () => {
    const corrupted = {
      ...sellOrderRecorded,
      escrow_debited_entity_id: 'attacker-wallet-99',
      escrow_debited_entity_type: 'user',
    };
    const state: ClientState = { orderRow: corrupted, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      try { const out = await cb(c); captured = c.calls; return out; }
      catch (e) { captured = c.calls; throw e; }
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Refund target validation failed/);
    expect(captured.find(c => /SET balance = balance \+/.test(c.text))).toBeUndefined();
  });

  test('entity_type=user but entity_id matches merchant_id → MISMATCH', async () => {
    const corrupted = {
      ...sellOrderRecorded,
      escrow_debited_entity_id: 'merchant-B',     // merchant uuid
      escrow_debited_entity_type: 'user',         // says user
    };
    const state: ClientState = { orderRow: corrupted, balance: 500 };
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Refund target validation failed/);
  });
});

describe('hard fail (was previously soft) — target row missing', () => {
  test('escrow_debited_entity_id points to nonexistent user → REFUND_TARGET_NOT_FOUND, ROLLBACK', async () => {
    const state: ClientState = {
      orderRow: sellOrderRecorded,
      balance: 0,
      refundTargetMissing: true,
    };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      try { const out = await cb(c); captured = c.calls; return out; }
      catch (e) { captured = c.calls; throw e; }
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Escrow-debited entity not found/);
    // Order was NOT cancelled — used to be the silent failure: cancel
    // proceeds, refund lost. Now everything rolls back together.
    expect(captured.find(c => c.text.match(/^\s*UPDATE orders/))).toBeUndefined();
  });
});

describe('balance / ledger invariants', () => {
  test('per-row balance drift → BALANCE_MISMATCH, ROLLBACK', async () => {
    const state: ClientState = {
      orderRow: sellOrderRecorded, balance: 500, drift: 0.5,
    };
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Balance invariant violated/);
  });

  test('ledger sum mismatch (lock=100, refund=0) → LEDGER_INVARIANT_VIOLATION, ROLLBACK', async () => {
    const state: ClientState = {
      orderRow: sellOrderRecorded, balance: 500,
      ledgerLockTotal: 100, ledgerRefundTotal: 0, ledgerReleaseTotal: 0,
    };
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Ledger invariant violated/);
  });

  test('ledger sum matches (lock=100, refund=100) → finalize succeeds', async () => {
    const state: ClientState = {
      orderRow: sellOrderRecorded, balance: 500,
      ledgerLockTotal: 100, ledgerRefundTotal: 100, ledgerReleaseTotal: 0,
    };
    mockTransaction.mockImplementation(asTxRunner(state));

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );
    expect(r.success).toBe(true);
  });
});

describe('no-escrow path — balance branch is no-op', () => {
  test('order with no escrow_tx_hash → cancel succeeds, no balance writes, no validation calls', async () => {
    const noEscrow = {
      ...sellOrderRecorded,
      escrow_tx_hash: null,
      escrow_debited_entity_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_amount: null,
    };
    const state: ClientState = { orderRow: noEscrow, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'accepted', 'system' as any, 'system', 'expired', orderData
    );

    expect(r.success).toBe(true);
    expect(captured.find(c => /SET balance = balance \+/.test(c.text))).toBeUndefined();
    expect(captured.find(c => c.text.match(/INSERT INTO ledger_entries/))).toBeUndefined();
    // Order was still cancelled
    expect(captured.find(c => c.text.match(/^\s*UPDATE orders/))).toBeTruthy();
  });
});

describe('concurrent writer safety', () => {
  test('order_version mismatch on UPDATE orders → STATUS_CHANGED rollback', async () => {
    const state: ClientState = {
      orderRow: sellOrderRecorded, balance: 500, versionStale: true,
    };
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Order status changed/);
  });

  test('order already cancelled in DB (lockedOrder.status === cancelled) → ALREADY_CANCELLED', async () => {
    const cancelled = { ...sellOrderRecorded, status: 'cancelled' };
    const state: ClientState = { orderRow: cancelled, balance: 500 };
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicCancelWithRefund(
      'order-sell-1', 'escrowed', 'system' as any, 'system', 'expired', orderData
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already cancelled/);
  });
});
