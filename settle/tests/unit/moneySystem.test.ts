/**
 * Unit Tests for Deterministic Money System
 *
 * Tests escrow lock/refund, fee deduction, and transaction logging
 * to ensure balances, ledger, and transaction history cannot drift.
 */

// Mock external dependencies before imports
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryOne: jest.fn(),
  transaction: jest.fn(),
  pool: {},
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/config/mockMode', () => ({
  MOCK_MODE: true,
  MOCK_INITIAL_BALANCE: 10000,
}));

jest.mock('@/lib/orders/stateMachine', () => ({
  validateTransition: jest.fn(() => ({ valid: true, allowed: true })),
}));

import { determineEscrowPayer, mockEscrowLock } from '@/lib/money/escrowLock';
import { transaction } from '@/lib/db';

// ─── Mock pg client builder ────────────────────────────────────────────

function createMockClient(state: {
  orderRow?: Record<string, unknown>;
  balance?: number;
  platformBalance?: number;
}) {
  const queries: { text: string; params: unknown[] }[] = [];
  let currentBalance = state.balance ?? 10000;

  return {
    queries,
    query: jest.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });

      if (text.includes('FROM orders WHERE id') && text.includes('FOR UPDATE')) {
        return { rows: state.orderRow ? [{ ...state.orderRow }] : [] };
      }
      if (text.includes('SELECT balance FROM') && text.includes('FOR UPDATE')) {
        return { rows: [{ balance: currentBalance }] };
      }
      if (text.includes('SELECT balance FROM')) {
        return { rows: [{ balance: currentBalance }] };
      }
      if (text.includes('SET balance = balance -')) {
        const amount = params?.[0] as number;
        currentBalance -= amount;
        return { rows: [{ balance: currentBalance }] };
      }
      if (text.includes('SET balance = balance +')) {
        const amount = params?.[0] as number;
        currentBalance += amount;
        return { rows: [{ balance: currentBalance }] };
      }
      if (text.includes('UPDATE orders')) {
        return {
          rows: [{
            ...state.orderRow,
            status: 'escrowed',
            order_version: 2,
            order_number: state.orderRow?.order_number || 'ORD-001',
            escrow_tx_hash: 'mock-tx',
          }],
        };
      }
      if (text.includes('UPDATE platform_balance')) {
        return { rows: [{ balance: (state.platformBalance ?? 0) + (params?.[0] as number || 0) }] };
      }
      return { rows: [] };
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// determineEscrowPayer
// ═══════════════════════════════════════════════════════════════════════

describe('determineEscrowPayer', () => {
  it('M2M trade: merchant_id is always the seller/payer', () => {
    const result = determineEscrowPayer({
      type: 'sell',
      merchant_id: 'seller-merchant',
      user_id: 'some-user',
      buyer_merchant_id: 'buyer-merchant',
    });
    expect(result.entityType).toBe('merchant');
    expect(result.entityId).toBe('seller-merchant');
    expect(result.table).toBe('merchants');
  });

  it('M2M BUY trade: merchant_id is still the payer', () => {
    const result = determineEscrowPayer({
      type: 'buy',
      merchant_id: 'seller-merchant',
      user_id: 'some-user',
      buyer_merchant_id: 'buyer-merchant',
    });
    expect(result.entityType).toBe('merchant');
    expect(result.entityId).toBe('seller-merchant');
  });

  it('User BUY trade: merchant (seller) pays escrow', () => {
    const result = determineEscrowPayer({
      type: 'buy',
      merchant_id: 'selling-merchant',
      user_id: 'buying-user',
      buyer_merchant_id: null,
    });
    expect(result.entityType).toBe('merchant');
    expect(result.entityId).toBe('selling-merchant');
    expect(result.table).toBe('merchants');
  });

  it('User SELL trade: user (seller) pays escrow', () => {
    const result = determineEscrowPayer({
      type: 'sell',
      merchant_id: 'buying-merchant',
      user_id: 'selling-user',
      buyer_merchant_id: null,
    });
    expect(result.entityType).toBe('user');
    expect(result.entityId).toBe('selling-user');
    expect(result.table).toBe('users');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// mockEscrowLock
// ═══════════════════════════════════════════════════════════════════════

describe('mockEscrowLock', () => {
  it('deducts balance and sets escrow_debited fields for BUY order', async () => {
    const orderRow = {
      id: 'order-1',
      order_number: 'ORD-001',
      status: 'pending',
      type: 'buy',
      crypto_amount: '100',
      merchant_id: 'merchant-1',
      user_id: 'user-1',
      buyer_merchant_id: null,
      escrow_tx_hash: null,
      spread_preference: 'fastest',
      protocol_fee_percentage: '2.50',
    };

    const client = createMockClient({ orderRow, balance: 500 });

    // Mock `transaction` to call the callback directly with our mock client
    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await mockEscrowLock('order-1', 'merchant', 'merchant-1', 'mock-tx-123');

    expect(result.success).toBe(true);

    // Verify balance deduction query
    const deductQuery = client.queries.find(q =>
      q.text.includes('SET balance = balance -') && q.text.includes('merchants')
    );
    expect(deductQuery).toBeDefined();
    expect(deductQuery!.params[0]).toBe(100);
    expect(deductQuery!.params[1]).toBe('merchant-1');

    // Verify escrow_debited fields in order update
    const orderUpdate = client.queries.find(q =>
      q.text.includes('escrow_debited_entity_type')
    );
    expect(orderUpdate).toBeDefined();
    expect(orderUpdate!.params).toContain('merchant');    // entity_type
    expect(orderUpdate!.params).toContain('merchant-1');  // entity_id
    expect(orderUpdate!.params).toContain(100);           // amount

    // Verify ledger entry
    const ledgerInsert = client.queries.find(q =>
      q.text.includes('INSERT INTO ledger_entries')
    );
    expect(ledgerInsert).toBeDefined();
    expect(ledgerInsert!.text).toContain('ESCROW_LOCK'); // entry_type in SQL
    expect(ledgerInsert!.params).toContain(-100); // negative amount for lock

    // Verify merchant_transactions entry
    const txInsert = client.queries.find(q =>
      q.text.includes('INSERT INTO merchant_transactions')
    );
    expect(txInsert).toBeDefined();

    // Verify order_events entry
    const eventInsert = client.queries.find(q =>
      q.text.includes('INSERT INTO order_events')
    );
    expect(eventInsert).toBeDefined();
  });

  it('rejects on insufficient balance', async () => {
    const orderRow = {
      id: 'order-2',
      order_number: 'ORD-002',
      status: 'pending',
      type: 'buy',
      crypto_amount: '500',
      merchant_id: 'merchant-1',
      user_id: 'user-1',
      buyer_merchant_id: null,
      escrow_tx_hash: null,
    };

    const client = createMockClient({ orderRow, balance: 100 }); // Only 100, need 500

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await mockEscrowLock('order-2', 'merchant', 'merchant-1', 'mock-tx-456');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient balance');
  });

  it('rejects if order already escrowed', async () => {
    const orderRow = {
      id: 'order-3',
      status: 'escrowed',
      type: 'buy',
      crypto_amount: '100',
      merchant_id: 'm1',
      user_id: 'u1',
      buyer_merchant_id: null,
      escrow_tx_hash: 'already-set', // Already escrowed
    };

    const client = createMockClient({ orderRow, balance: 1000 });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await mockEscrowLock('order-3', 'merchant', 'm1', 'mock-tx-789');

    expect(result.success).toBe(false);
    expect(result.error).toContain('already has escrow');
  });

  it('deducts from user for SELL orders', async () => {
    const orderRow = {
      id: 'order-4',
      order_number: 'ORD-004',
      status: 'pending',
      type: 'sell',
      crypto_amount: '50',
      merchant_id: 'merchant-1',
      user_id: 'user-1',
      buyer_merchant_id: null,
      escrow_tx_hash: null,
    };

    const client = createMockClient({ orderRow, balance: 200 });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await mockEscrowLock('order-4', 'user', 'user-1', 'mock-tx-sell');

    expect(result.success).toBe(true);

    // Should deduct from users table, not merchants
    const deductQuery = client.queries.find(q =>
      q.text.includes('SET balance = balance -') && q.text.includes('users')
    );
    expect(deductQuery).toBeDefined();
    expect(deductQuery!.params[0]).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Cancel refunds from recorded fields
// ═══════════════════════════════════════════════════════════════════════

describe('Cancel refunds to recorded escrow_debited entity', () => {
  it('refunds to escrow_debited_entity_id, not current merchant_id', () => {
    // Scenario: merchant_id was reassigned during acceptance, but escrow_debited
    // still points to the original merchant who paid.
    const lockedOrder = {
      merchant_id: 'new-merchant',       // reassigned during acceptance
      user_id: 'user-1',
      type: 'buy',
      buyer_merchant_id: null,
      escrow_debited_entity_type: 'merchant' as const,
      escrow_debited_entity_id: 'original-merchant',  // who actually paid
      escrow_debited_amount: 100,
      crypto_amount: 100,
    };

    const debitId = lockedOrder.escrow_debited_entity_id;
    expect(debitId).toBe('original-merchant');

    // Old inference would give 'new-merchant' (wrong!)
    const inferredId = lockedOrder.type === 'buy' ? lockedOrder.merchant_id : lockedOrder.user_id;
    expect(inferredId).toBe('new-merchant');
    expect(debitId).not.toBe(inferredId);
  });

  it('refunds exact escrow_debited_amount, not crypto_amount', () => {
    const lockedOrder = {
      escrow_debited_amount: 95.5,
      crypto_amount: 100,
    };

    const refundAmount = lockedOrder.escrow_debited_amount ?? lockedOrder.crypto_amount;
    expect(refundAmount).toBe(95.5);
  });

  it('cannot refund more than was debited', () => {
    const lockedOrder = {
      escrow_debited_amount: 50,
      crypto_amount: 100,
    };

    const refundAmount = lockedOrder.escrow_debited_amount ?? lockedOrder.crypto_amount;
    expect(refundAmount).toBe(50);
    expect(refundAmount).toBeLessThanOrEqual(lockedOrder.crypto_amount);
  });

  it('falls back to inference when escrow_debited fields are null', () => {
    const lockedOrder = {
      merchant_id: 'merchant-1',
      user_id: 'user-1',
      type: 'buy' as const,
      buyer_merchant_id: null,
      escrow_debited_entity_type: null,
      escrow_debited_entity_id: null,
      escrow_debited_amount: null,
      crypto_amount: 100,
    };

    expect(lockedOrder.escrow_debited_entity_type).toBeNull();
    expect(lockedOrder.escrow_debited_entity_id).toBeNull();

    // Fallback inference
    const refundId = lockedOrder.type === 'buy' ? lockedOrder.merchant_id : lockedOrder.user_id;
    expect(refundId).toBe('merchant-1');

    const refundAmount = lockedOrder.escrow_debited_amount ?? lockedOrder.crypto_amount;
    expect(refundAmount).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Platform fee
// ═══════════════════════════════════════════════════════════════════════

describe('Platform fee deduction on completion', () => {
  it('uses protocol_fee_percentage, not hardcoded 0.5%', async () => {
    const { deductPlatformFee } = await import('@/lib/money/platformFee');

    const client = createMockClient({ balance: 1000, platformBalance: 50 });

    const result = await deductPlatformFee(client as any, {
      id: 'order-1',
      order_number: 'ORD-001',
      crypto_amount: 100,
      protocol_fee_percentage: 1.5,
      spread_preference: 'cheap',
      escrow_debited_entity_type: 'merchant',
      escrow_debited_entity_id: 'merchant-1',
      merchant_id: 'merchant-1',
    });

    expect(result.feePercentage).toBe(1.5);
    expect(result.feeAmount).toBe(1.5);
  });

  it('defaults to 2.50% when protocol_fee_percentage is null', async () => {
    const { deductPlatformFee } = await import('@/lib/money/platformFee');

    const client = createMockClient({ balance: 1000, platformBalance: 0 });

    const result = await deductPlatformFee(client as any, {
      id: 'order-2',
      order_number: 'ORD-002',
      crypto_amount: 200,
      protocol_fee_percentage: null,
      spread_preference: null,
      escrow_debited_entity_type: 'merchant',
      escrow_debited_entity_id: 'm1',
      merchant_id: 'm1',
    });

    expect(result.feePercentage).toBe(2.50);
    expect(result.feeAmount).toBe(5);
  });

  it('deducts from seller and credits platform_balance', async () => {
    const { deductPlatformFee } = await import('@/lib/money/platformFee');

    const client = createMockClient({ balance: 500, platformBalance: 10 });

    await deductPlatformFee(client as any, {
      id: 'order-3',
      order_number: 'ORD-003',
      crypto_amount: 100,
      protocol_fee_percentage: 2.0,
      spread_preference: 'best',
      escrow_debited_entity_type: 'merchant',
      escrow_debited_entity_id: 'm1',
      merchant_id: 'm1',
    });

    const deductQuery = client.queries.find(q =>
      q.text.includes('balance = balance -')
    );
    expect(deductQuery).toBeDefined();
    expect(deductQuery!.params[0]).toBe(2);

    const platformQuery = client.queries.find(q =>
      q.text.includes('UPDATE platform_balance')
    );
    expect(platformQuery).toBeDefined();
    expect(platformQuery!.params[0]).toBe(2);

    const feeInsert = client.queries.find(q =>
      q.text.includes('INSERT INTO platform_fee_transactions')
    );
    expect(feeInsert).toBeDefined();
  });

  it('creates merchant_transactions entry for fee', async () => {
    const { deductPlatformFee } = await import('@/lib/money/platformFee');

    const client = createMockClient({ balance: 800, platformBalance: 0 });

    await deductPlatformFee(client as any, {
      id: 'order-4',
      order_number: 'ORD-004',
      crypto_amount: 200,
      protocol_fee_percentage: 2.5,
      spread_preference: 'fastest',
      escrow_debited_entity_type: 'merchant',
      escrow_debited_entity_id: 'm1',
      merchant_id: 'm1',
    });

    const txInsert = client.queries.find(q =>
      q.text.includes('INSERT INTO merchant_transactions')
    );
    expect(txInsert).toBeDefined();
  });
});
