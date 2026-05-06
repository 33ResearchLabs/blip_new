/**
 * atomicFinalizeDispute — atomicity + correct-entity refund (Issues C2 + C3).
 *
 * Verifies the contract:
 *   - Single transaction wraps order lock, refund, status update, dispute
 *     update, order_events, notification_outbox, chat_messages.
 *   - Refund credits escrow_debited_entity_id (NEVER merchant_id) — proven
 *     by a SELL order where seller=user_id ≠ merchant_id.
 *   - Refund amount equals escrow_debited_amount.
 *   - 'user' / 'split' resolutions do NOT touch balances.
 *   - Concurrent writer (order_version mismatch) → caller-friendly error.
 *   - Balance post-invariant trips ROLLBACK.
 *   - Order not in 'disputed' status → idempotent error envelope.
 */

const mockTransaction = jest.fn();
jest.mock('@/lib/db', () => ({
  transaction: (cb: (client: any) => Promise<any>) => mockTransaction(cb),
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

import { atomicFinalizeDispute } from '@/lib/orders/atomicFinalizeDispute';

const COMPLIANCE = { id: 'comp-42', name: 'Audit Bot', role: 'compliance' };

// ── Fake pg client ──────────────────────────────────────────────────────

interface ClientState {
  orderRow: Record<string, unknown> | null;
  balance: number;
  // when set, returns a stale/wrong post-update balance to trip BALANCE_MISMATCH
  drift?: number;
  // when set, the UPDATE orders RETURNING * returns 0 rows (concurrent change)
  versionStale?: boolean;
  // when set, the SELECT balance FOR UPDATE returns no rows
  refundTargetMissing?: boolean;
  // ── Ledger invariant fixtures (Patch A) ─────────────────────────────
  // When provided, the SUM query returns these totals. Otherwise it
  // returns empty rows (the "legacy data, lock_total=0" branch).
  ledgerLockTotal?: number;
  ledgerReleaseTotal?: number;
  // refundTotal observed AFTER our INSERT — set this to a value that
  // does NOT equal lockTotal-releaseTotal to trip LEDGER_INVARIANT_VIOLATION.
  ledgerRefundTotal?: number;
}

function createClient(state: ClientState) {
  const calls: { text: string; params: unknown[] }[] = [];
  let bal = state.balance;

  const client = {
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
        // Post-invariant verify read — apply optional drift to prove the
        // balance check actually catches divergence.
        return { rows: [{ balance: bal + (state.drift ?? 0) }] };
      }
      if (text.match(/^\s*UPDATE orders/) && text.includes('RETURNING *')) {
        if (state.versionStale) return { rows: [] };
        const updated = {
          ...state.orderRow,
          status: text.match(/SET status = \$1/) ? params?.[0] : 'cancelled',
          order_version: ((state.orderRow as any)?.order_version ?? 1) + 1,
        };
        return { rows: [updated] };
      }
      if (text.match(/UPDATE disputes/)) return { rows: [] };
      if (text.match(/INSERT INTO order_events/)) return { rows: [] };
      if (text.match(/INSERT INTO notification_outbox/)) return { rows: [] };
      if (text.match(/INSERT INTO chat_messages/)) return { rows: [] };
      if (text.match(/INSERT INTO ledger_entries/)) return { rows: [] };
      // Ledger invariant SUM query (Patch A). When the test sets ledger
      // totals, return them; otherwise empty rows → "legacy" skip path.
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
      return { rows: [] };
    }),
  };
  return client;
}

function asTxRunner(state: ClientState) {
  return async (cb: (client: any) => Promise<any>) => {
    const client = createClient(state);
    return await cb(client);
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────

// SELL order: seller=user, buyer=merchant. escrow_debited_entity_id MUST be
// the user. If the buggy code refunded to merchant_id, this fixture catches it.
const sellOrderUserSeller = {
  id: 'order-sell-1',
  order_number: 1001,
  type: 'sell',
  status: 'disputed',
  user_id: 'user-seller-A',
  merchant_id: 'merchant-buyer-B',
  buyer_merchant_id: null,
  crypto_amount: '100.00',
  crypto_currency: 'USDT',
  order_version: 5,
  escrow_tx_hash: 'tx-abc',
  escrow_debited_entity_id: 'user-seller-A',   // ← the user, NOT merchant_id
  escrow_debited_entity_type: 'user',
  escrow_debited_amount: '100.00',
  escrow_debited_at: '2026-04-29T00:00:00Z',
};

// BUY order: seller=merchant, buyer=user. escrow_debited_entity_id = merchant.
const buyOrderMerchantSeller = {
  ...sellOrderUserSeller,
  id: 'order-buy-2',
  type: 'buy',
  user_id: 'user-buyer-X',
  merchant_id: 'merchant-seller-Y',
  escrow_debited_entity_id: 'merchant-seller-Y',
  escrow_debited_entity_type: 'merchant',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateTransition.mockReturnValue({ valid: true });
});

describe('refund target — credits escrow_debited_entity_id, never merchant_id', () => {
  test('SELL order, resolution=merchant → refund goes to user (seller), not merchant', async () => {
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    mockTransaction.mockImplementation(asTxRunner(state));

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
    expect(r.refundedTo).toEqual({
      entityId: 'user-seller-A',
      entityType: 'user',
      amount: 100,
    });
    expect(r.refundedTo!.entityId).not.toBe('merchant-buyer-B');
  });

  test('BUY order, resolution=merchant → refund goes to merchant (seller)', async () => {
    const state: ClientState = { orderRow: buyOrderMerchantSeller, balance: 500 };
    mockTransaction.mockImplementation(asTxRunner(state));

    const r = await atomicFinalizeDispute({
      orderId: 'order-buy-2',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
    expect(r.refundedTo).toEqual({
      entityId: 'merchant-seller-Y',
      entityType: 'merchant',
      amount: 100,
    });
  });

  test('refund debits the right *table* — users, not merchants, when seller is a user', async () => {
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    const balanceLock = captured.find(c =>
      c.text.includes('SELECT balance FROM') && c.text.includes('FOR UPDATE')
    );
    const balanceUpdate = captured.find(c =>
      /UPDATE\s+users\s+SET balance = balance \+/.test(c.text)
    );
    expect(balanceLock?.text).toMatch(/FROM users/);
    expect(balanceUpdate).toBeTruthy();
    expect(captured.find(c => /UPDATE\s+merchants\s+SET balance/.test(c.text))).toBeUndefined();
  });
});

describe('atomicity — single transaction, correct order, all writes inside', () => {
  test('happy path executes lock → balance lock → balance update → invariant → ledger → orders → disputes → events → outbox → chat', async () => {
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
      notes: 'seller wins',
    });

    const seq = captured.map(c => {
      if (c.text.includes('FROM orders WHERE id') && c.text.includes('FOR UPDATE')) return 'order_lock';
      if (c.text.includes('SELECT balance FROM') && c.text.includes('FOR UPDATE')) return 'balance_lock';
      if (/UPDATE\s+(users|merchants)\s+SET balance = balance \+/.test(c.text)) return 'balance_update';
      if (c.text.includes('SELECT balance FROM')) return 'balance_verify';
      if (c.text.includes('INSERT INTO ledger_entries')) return 'ledger';
      if (/^\s*UPDATE orders/.test(c.text)) return 'order_status';
      if (c.text.includes('UPDATE disputes')) return 'dispute_status';
      if (c.text.includes('INSERT INTO order_events')) return 'order_events';
      if (c.text.includes('INSERT INTO notification_outbox')) return 'outbox';
      if (c.text.includes('INSERT INTO chat_messages')) return 'chat';
      return null;
    }).filter(Boolean);

    expect(seq).toEqual([
      'order_lock',
      'balance_lock',
      'balance_update',
      'balance_verify',
      'ledger',
      'order_status',
      'dispute_status',
      'order_events',
      'outbox',
      'chat',
    ]);
  });

  test('mockTransaction is called exactly once — proves single transaction', async () => {
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    mockTransaction.mockImplementation(asTxRunner(state));

    await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('release / split — no balance changes', () => {
  test("resolution='user' (release) → status=completed, no SELECT balance, no UPDATE balance", async () => {
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'user',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
    expect(r.newStatus).toBe('completed');
    expect(r.refundedTo).toBeUndefined();
    expect(captured.find(c => c.text.includes('SELECT balance'))).toBeUndefined();
    expect(captured.find(c => /SET balance/.test(c.text))).toBeUndefined();
    expect(captured.find(c => c.text.includes('INSERT INTO ledger_entries'))).toBeUndefined();
  });

  test("resolution='split' → status=completed, no balance writes", async () => {
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'split',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
    expect(r.newStatus).toBe('completed');
    expect(captured.find(c => /SET balance/.test(c.text))).toBeUndefined();
  });
});

describe('rollback paths', () => {
  test('order not found → ROLLBACK, no partial writes', async () => {
    const state: ClientState = { orderRow: null, balance: 0 };
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'missing',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });
    expect(r.success).toBe(false);
    expect(r.error).toBe('Order not found');
  });

  test('order not in disputed state → 4xx-mappable error', async () => {
    const state: ClientState = {
      orderRow: { ...sellOrderUserSeller, status: 'completed' },
      balance: 500,
    };
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Cannot finalize dispute for order in 'completed' status/);
  });

  test('concurrent writer: order_version mismatch → STATUS_CHANGED_CONCURRENT', async () => {
    const state: ClientState = {
      orderRow: sellOrderUserSeller, balance: 500, versionStale: true,
    };
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Order status changed/);
  });

  test('balance post-invariant fails → BALANCE_MISMATCH, ROLLBACK', async () => {
    const state: ClientState = {
      orderRow: sellOrderUserSeller, balance: 500, drift: 0.5,
    };
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Balance invariant violated/);
  });

  test('refund target entity missing → REFUND_TARGET_NOT_FOUND, ROLLBACK', async () => {
    const state: ClientState = {
      orderRow: sellOrderUserSeller, balance: 0, refundTargetMissing: true,
    };
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Escrow-debited entity not found/);
  });

  test('state machine rejects transition → STATUS_TRANSITION_INVALID', async () => {
    mockValidateTransition.mockReturnValueOnce({ valid: false, error: 'forbidden' });
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Order status changed/);
  });
});

describe('no-escrow disputed order — refund branch is no-op, status flip still atomic', () => {
  test('merchant resolution on order with no escrow → success, no refund, status flips', async () => {
    const noEscrowOrder = {
      ...sellOrderUserSeller,
      escrow_tx_hash: null,
      escrow_debited_entity_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_amount: '0',
    };
    const state: ClientState = { orderRow: noEscrowOrder, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
    expect(r.newStatus).toBe('cancelled');
    expect(r.refundedTo).toBeUndefined();
    expect(captured.find(c => /SET balance/.test(c.text))).toBeUndefined();
    expect(captured.find(c => c.text.includes('UPDATE disputes'))).toBeTruthy();
    expect(captured.find(c => c.text.includes('INSERT INTO order_events'))).toBeTruthy();
  });
});

describe('legacy fallback — orders without escrow_debited_entity_id (pre-026)', () => {
  const legacySell = {
    ...sellOrderUserSeller,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
  };
  const legacyBuy = {
    ...buyOrderMerchantSeller,
    escrow_debited_entity_id: null,
    escrow_debited_entity_type: null,
    escrow_debited_amount: null,
  };

  test('legacy SELL → refund derived to user_id, refund executed', async () => {
    const state: ClientState = { orderRow: legacySell, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
    expect(r.refundedTo).toEqual({
      entityId: 'user-seller-A',
      entityType: 'user',
      amount: 100,
    });
    // Refund table is users (not merchants) — proves type was derived
    // correctly from order role even with no recorded fields.
    expect(captured.find(c => /UPDATE\s+users\s+SET balance/.test(c.text))).toBeTruthy();
    expect(captured.find(c => /UPDATE\s+merchants\s+SET balance/.test(c.text))).toBeUndefined();
  });

  test('legacy BUY → refund derived to merchant_id', async () => {
    const state: ClientState = { orderRow: legacyBuy, balance: 500 };
    mockTransaction.mockImplementation(asTxRunner(state));

    const r = await atomicFinalizeDispute({
      orderId: 'order-buy-2',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
    expect(r.refundedTo).toEqual({
      entityId: 'merchant-seller-Y',
      entityType: 'merchant',
      amount: 100,
    });
  });

  test('legacy with no type AND no buyer_merchant_id → REFUND_TARGET_INDETERMINATE', async () => {
    const undeterminable = {
      ...legacySell,
      type: null,
      buyer_merchant_id: null,
    };
    const state: ClientState = { orderRow: undeterminable, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { const out = await cb(c); captured = c.calls; return out; }
      catch (e) { captured = c.calls; throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Cannot determine refund target/);
    // Critically — NO balance UPDATE occurred. Refund refused, not misdirected.
    expect(captured.find(c => /SET balance = balance \+/.test(c.text))).toBeUndefined();
  });
});

describe('refund target validation — REFUSE on mismatch', () => {
  test('recorded entity_id is foreign (not a party to the trade) → mismatch, no balance moved', async () => {
    const corrupted = {
      ...sellOrderUserSeller,
      escrow_debited_entity_id: 'attacker-wallet-id',
      escrow_debited_entity_type: 'user',
    };
    const state: ClientState = { orderRow: corrupted, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { const out = await cb(c); captured = c.calls; return out; }
      catch (e) { captured = c.calls; throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Refund target validation failed/);
    expect(captured.find(c => /SET balance = balance \+/.test(c.text))).toBeUndefined();
  });

  test('recorded entity_type=user but entity_id matches merchant_id → mismatch, no balance moved', async () => {
    const wrongType = {
      ...sellOrderUserSeller,
      escrow_debited_entity_id: 'merchant-buyer-B',  // matches merchant_id
      escrow_debited_entity_type: 'user',            // but says user
    };
    const state: ClientState = { orderRow: wrongType, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { const out = await cb(c); captured = c.calls; return out; }
      catch (e) { captured = c.calls; throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Refund target validation failed/);
    expect(captured.find(c => /SET balance = balance \+/.test(c.text))).toBeUndefined();
  });
});

describe('on-chain tx hashes flow into the order UPDATE', () => {
  test('refund_tx_hash provided → included in UPDATE orders', async () => {
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    let captured: any[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
      refundTxHash: 'refund-tx-xyz',
    });

    const orderUpd = captured.find(c => /^\s*UPDATE orders/.test(c.text) && c.text.includes('RETURNING *'));
    expect(orderUpd?.text).toMatch(/refund_tx_hash =/);
    expect(orderUpd?.params).toContain('refund-tx-xyz');
  });
});

describe('ledger invariant post-condition (Patch A — system-level conservation)', () => {
  test('lock=100, release=0, refund=100 → invariant holds, finalize succeeds', async () => {
    const state: ClientState = {
      orderRow: sellOrderUserSeller,
      balance: 500,
      ledgerLockTotal: 100,
      ledgerReleaseTotal: 0,
      ledgerRefundTotal: 100,
    };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
    // Invariant query was issued, AFTER the ledger insert
    const invariantIdx = captured.findIndex(c =>
      c.text.includes('SELECT entry_type') && c.text.includes('FROM ledger_entries')
    );
    const ledgerInsertIdx = captured.findIndex(c =>
      c.text.includes('INSERT INTO ledger_entries')
    );
    expect(invariantIdx).toBeGreaterThan(-1);
    expect(invariantIdx).toBeGreaterThan(ledgerInsertIdx);
  });

  test('lock=100, release=0, refund=0 (refund somehow did not register) → LEDGER_INVARIANT_VIOLATION, ROLLBACK', async () => {
    const state: ClientState = {
      orderRow: sellOrderUserSeller,
      balance: 500,
      ledgerLockTotal: 100,
      ledgerReleaseTotal: 0,
      ledgerRefundTotal: 0,
    };
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Ledger invariant violated/);
  });

  test('lock=100, release=50, refund=50 → invariant holds (split scenario, mid-history)', async () => {
    const state: ClientState = {
      orderRow: sellOrderUserSeller,
      balance: 500,
      ledgerLockTotal: 100,
      ledgerReleaseTotal: 50,
      ledgerRefundTotal: 50,
    };
    mockTransaction.mockImplementation(asTxRunner(state));

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(true);
  });

  test('lock=100, release=0, refund=200 (over-refund) → LEDGER_INVARIANT_VIOLATION, ROLLBACK', async () => {
    const state: ClientState = {
      orderRow: sellOrderUserSeller,
      balance: 500,
      ledgerLockTotal: 100,
      ledgerReleaseTotal: 0,
      ledgerRefundTotal: 200,
    };
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      try { return await cb(c); } catch (e) { throw e; }
    });

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Ledger invariant violated/);
  });

  test('no ledger rows at all (legacy data) → invariant SKIPPED (warn-only), finalize succeeds', async () => {
    // ledgerLockTotal undefined → SUM query returns []
    const state: ClientState = {
      orderRow: sellOrderUserSeller,
      balance: 500,
    };
    mockTransaction.mockImplementation(asTxRunner(state));

    const r = await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'merchant',
      complianceMember: COMPLIANCE,
    });

    // No rollback — legacy orders predate the ledger and can't be checked.
    // Per-row balance invariant still ran and passed.
    expect(r.success).toBe(true);
  });

  test('release-only resolution (resolution=user) → ledger invariant query NOT issued (no refund branch)', async () => {
    const state: ClientState = { orderRow: sellOrderUserSeller, balance: 500 };
    let captured: { text: string; params: unknown[] }[] = [];
    mockTransaction.mockImplementation(async (cb: any) => {
      const c = createClient(state);
      const out = await cb(c);
      captured = c.calls;
      return out;
    });

    await atomicFinalizeDispute({
      orderId: 'order-sell-1',
      resolution: 'user',
      complianceMember: COMPLIANCE,
    });

    // The invariant query lives inside the refund branch. 'user' resolution
    // does no refund → no ledger SELECT either.
    expect(captured.find(c =>
      c.text.includes('SELECT entry_type') && c.text.includes('FROM ledger_entries')
    )).toBeUndefined();
  });
});
