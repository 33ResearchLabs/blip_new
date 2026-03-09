/**
 * Unit Tests for Synthetic AED Conversion System
 *
 * Tests USDT ↔ sAED conversion with atomic transactions, idempotency,
 * exposure limits, and floor rounding to ensure deterministic behavior.
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

jest.mock('@/lib/db/repositories/transactions', () => ({
  createTransactionInTx: jest.fn(),
}));

import { atomicConvert } from '@/lib/money/syntheticConversion';
import { transaction } from '@/lib/db';
import { createTransactionInTx } from '@/lib/db/repositories/transactions';

// ─── Mock pg client builder ────────────────────────────────────────────

interface MockClientState {
  accountRow?: Record<string, unknown>;
  existingConversion?: Record<string, unknown>;
  balance?: number;
  sinrBalance?: number;
  rate?: number;
  maxExposure?: number | null;
}

function createMockClient(state: MockClientState) {
  const queries: { text: string; params: unknown[] }[] = [];
  let currentUsdtBalance = state.balance ?? 1000;
  let currentSinrBalance = state.sinrBalance ?? 0;

  return {
    queries,
    query: jest.fn(async (text: string, params?: unknown[]) => {
      queries.push({ text, params: params || [] });

      // Check idempotency - return existing conversion
      if (text.includes('FROM synthetic_conversions') && text.includes('idempotency_key')) {
        if (state.existingConversion) {
          return { rows: [state.existingConversion] };
        }
        return { rows: [] };
      }

      // Lock account row (FOR UPDATE)
      if (text.includes('FOR UPDATE')) {
        return {
          rows: [{
            balance: currentUsdtBalance,
            sinr_balance: currentSinrBalance,
            synthetic_rate: state.rate ?? 3.67,
            max_sinr_exposure: state.maxExposure !== undefined ? state.maxExposure : null,
            ...state.accountRow,
          }],
        };
      }

      // Update balances
      if (text.includes('SET balance = $1, sinr_balance = $2')) {
        currentUsdtBalance = params?.[0] as number;
        currentSinrBalance = params?.[1] as number;
        return { rows: [] };
      }

      // Insert conversion record
      if (text.includes('INSERT INTO synthetic_conversions')) {
        return { rows: [{ id: 'conv-123' }] };
      }

      // Insert ledger entry
      if (text.includes('INSERT INTO ledger_entries')) {
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// USDT → sAED Conversion
// ═══════════════════════════════════════════════════════════════════════

describe('atomicConvert - USDT to sAED', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('converts USDT to sAED with correct calculation', async () => {
    const client = createMockClient({
      balance: 100, // 100 USDT
      sinrBalance: 0,
      rate: 3.67,
      maxExposure: 10_000_000, // explicit high limit
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 1_000_000, // 1 USDT (in micro-USDT)
    });

    expect(result.success).toBe(true);
    expect(result.conversion).toBeDefined();

    // Verify amount calculation: floor(1_000_000 * 3.67 / 100) = 36_700 fils
    expect(result.conversion?.amountOut).toBe(36_700);

    // Verify balances updated
    const updateQuery = client.queries.find(q => q.text.includes('SET balance = $1, sinr_balance = $2'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery?.params[0]).toBe(99); // 100 - 1 USDT
    expect(updateQuery?.params[1]).toBe(36_700); // 0 + 36_700 fils
  });

  it('enforces exposure limit when set', async () => {
    const client = createMockClient({
      balance: 100,
      sinrBalance: 0,
      rate: 3.67,
      maxExposure: 200_000, // Max ~54 USDT worth of sAED
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    // Try to convert 10 USDT → 367_000 fils, but limit is 200_000
    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 10_000_000, // 10 USDT
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('EXPOSURE_LIMIT_EXCEEDED');
  });

  it('uses default exposure limit (90% of USDT * rate) when max_exposure is NULL', async () => {
    const client = createMockClient({
      balance: 1000, // 1000 USDT
      sinrBalance: 0,
      rate: 3.67,
      maxExposure: null,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    // Default limit: floor(1000 * 3.67 * 100 * 0.9) = 330_300 fils
    // Convert 9 USDT → floor(9_000_000 * 3.67 / 100) = 330_300 fils (exactly at limit)
    const result1 = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 9_000_000, // 9 USDT
    });

    expect(result1.success).toBe(true);

    // Convert 9.1 USDT → floor(9_100_000 * 3.67 / 100) = 333_970 fils (exceeds limit)
    const result2 = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 9_100_000, // 9.1 USDT
    });

    expect(result2.success).toBe(false);
    expect(result2.error).toBe('EXPOSURE_LIMIT_EXCEEDED');
  });

  it('rejects conversion with insufficient USDT balance', async () => {
    const client = createMockClient({
      balance: 0.5, // Only 0.5 USDT
      sinrBalance: 0,
      rate: 3.67,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 1_000_000, // Try to convert 1 USDT
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_BALANCE');
  });

  it('logs ledger entry and transaction record', async () => {
    const client = createMockClient({
      balance: 100,
      sinrBalance: 0,
      rate: 3.67,
      maxExposure: 10_000_000,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 1_000_000,
    });

    // Verify ledger entry created
    const ledgerQuery = client.queries.find(q => q.text.includes('INSERT INTO ledger_entries'));
    expect(ledgerQuery).toBeDefined();
    expect(ledgerQuery?.params).toContain('merchant');
    expect(ledgerQuery?.params).toContain('merchant-1');

    // Verify merchant_transactions record created
    expect(createTransactionInTx).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        merchant_id: 'merchant-1',
        type: 'synthetic_conversion',
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════
// sAED → USDT Conversion
// ═══════════════════════════════════════════════════════════════════════

describe('atomicConvert - sAED to USDT', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('converts sAED to USDT with correct calculation', async () => {
    const client = createMockClient({
      balance: 0,
      sinrBalance: 36_700, // 367 AED (36_700 fils)
      rate: 3.67,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'sinr_to_usdt',
      amountIn: 36_700, // 367 AED (in fils)
    });

    expect(result.success).toBe(true);
    expect(result.conversion).toBeDefined();

    // Verify amount calculation: floor(36_700 * 100 / 3.67) = 1_000_000 micro-USDT (1 USDT)
    expect(result.conversion?.amountOut).toBe(1_000_000);

    // Verify balances updated
    const updateQuery = client.queries.find(q => q.text.includes('SET balance = $1, sinr_balance = $2'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery?.params[0]).toBe(1); // 0 + 1 USDT
    expect(updateQuery?.params[1]).toBe(0); // 36_700 - 36_700 fils
  });

  it('rejects conversion with insufficient sAED balance', async () => {
    const client = createMockClient({
      balance: 100,
      sinrBalance: 5_000, // Only 50 AED (5_000 fils)
      rate: 3.67,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'sinr_to_usdt',
      amountIn: 10_000, // Try to convert 100 AED
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INSUFFICIENT_SAED_BALANCE');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Idempotency
// ═══════════════════════════════════════════════════════════════════════

describe('atomicConvert - Idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns existing conversion if idempotency key matches', async () => {
    const existingConv = {
      id: 'existing-conv-123',
      amount_in: 1_000_000,
      amount_out: 36_700,
      rate: 3.67,
      usdt_balance_after: 99,
      sinr_balance_after: 36_700,
    };

    const client = createMockClient({
      balance: 100,
      sinrBalance: 0,
      rate: 3.67,
      existingConversion: existingConv,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 1_000_000,
      idempotencyKey: 'test-key-123',
    });

    expect(result.success).toBe(true);
    expect(result.conversion?.id).toBe('existing-conv-123');

    // Should NOT create a new conversion
    const insertQuery = client.queries.find(q => q.text.includes('INSERT INTO synthetic_conversions'));
    expect(insertQuery).toBeUndefined();
  });

  it('creates new conversion if idempotency key is different', async () => {
    const client = createMockClient({
      balance: 100,
      sinrBalance: 0,
      rate: 3.67,
      maxExposure: 10_000_000,
      existingConversion: undefined, // No existing conversion
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 1_000_000,
      idempotencyKey: 'new-key-456',
    });

    expect(result.success).toBe(true);

    // Should create a new conversion
    const insertQuery = client.queries.find(q => q.text.includes('INSERT INTO synthetic_conversions'));
    expect(insertQuery).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Floor Rounding Safety
// ═══════════════════════════════════════════════════════════════════════

describe('atomicConvert - Floor Rounding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses floor rounding to prevent value creation', async () => {
    // Use a non-round amount to trigger floor rounding
    const client = createMockClient({
      balance: 100,
      sinrBalance: 0,
      rate: 3.67,
      maxExposure: 10_000_000,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    // Convert 0.333333 USDT to sAED
    const result1 = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 333_333, // 0.333333 USDT
    });

    expect(result1.success).toBe(true);
    const saedAmount = result1.conversion?.amountOut;

    // floor(333_333 * 3.67 / 100) = floor(12_233.3211) = 12_233
    expect(saedAmount).toBe(12_233);

    // Now convert back to USDT
    const client2 = createMockClient({
      balance: 0,
      sinrBalance: 12_233,
      rate: 3.67,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client2);
    });

    const result2 = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'sinr_to_usdt',
      amountIn: 12_233,
    });

    expect(result2.success).toBe(true);
    const usdtAmount = result2.conversion?.amountOut;

    // floor(12_233 * 100 / 3.67) = 333_324 (float64 rounding)
    expect(usdtAmount).toBe(333_324);

    // Verify we lost 9 micro-USDT in the round trip (prevents value creation)
    expect(usdtAmount).toBeLessThan(333_333);
  });

  it('always rounds down on USDT → sAED conversion', async () => {
    const client = createMockClient({
      balance: 100,
      sinrBalance: 0,
      rate: 3.67,
      maxExposure: 10_000_000,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 123_456, // 0.123456 USDT (non-round)
    });

    // floor(123_456 * 3.67 / 100) = floor(4_530.8352) = 4_530
    expect(result.conversion?.amountOut).toBe(4_530);
  });

  it('always rounds down on sAED → USDT conversion', async () => {
    const client = createMockClient({
      balance: 0,
      sinrBalance: 100_000,
      rate: 3.67,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'sinr_to_usdt',
      amountIn: 12_345, // 123.45 AED
    });

    // floor(12_345 * 100 / 3.67) = floor(336_376.02...) = 336_376
    expect(result.conversion?.amountOut).toBe(336_376);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════════════

describe('atomicConvert - Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects zero amount', async () => {
    const client = createMockClient({
      balance: 100,
      sinrBalance: 0,
      rate: 3.67,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_AMOUNT');
  });

  it('rejects negative amount', async () => {
    const client = createMockClient({
      balance: 100,
      sinrBalance: 0,
      rate: 3.67,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'merchant',
      accountId: 'merchant-1',
      direction: 'usdt_to_sinr',
      amountIn: -1000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_AMOUNT');
  });

  it('handles user account type correctly', async () => {
    const client = createMockClient({
      balance: 50,
      sinrBalance: 0,
      rate: 3.67,
      maxExposure: 10_000_000,
    });

    (transaction as jest.Mock).mockImplementation(async (cb: (c: unknown) => unknown) => {
      return cb(client);
    });

    const result = await atomicConvert({
      accountType: 'user',
      accountId: 'user-1',
      direction: 'usdt_to_sinr',
      amountIn: 1_000_000,
    });

    expect(result.success).toBe(true);

    // Verify it used users table
    const lockQuery = client.queries.find(q => q.text.includes('FOR UPDATE'));
    expect(lockQuery?.text).toContain('users');

    // Verify transaction log used user_id
    expect(createTransactionInTx).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        user_id: 'user-1',
        type: 'synthetic_conversion',
      })
    );
  });
});
