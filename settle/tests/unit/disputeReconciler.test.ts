/**
 * disputeReconciler — on-chain-status → DB-finalize mapping, idempotency, and
 * backoff behaviour. atomicFinalizeDispute and the Solana connection are mocked;
 * we assert the reconciler reads the authoritative Trade.status and only
 * finalizes for terminal states, never double-paying or touching finalized rows.
 */

const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({ query: (...a: unknown[]) => mockQuery(...a) }));

const mockFinalize = jest.fn();
jest.mock('@/lib/orders/atomicFinalizeDispute', () => ({
  atomicFinalizeDispute: (...a: unknown[]) => mockFinalize(...a),
}));

jest.mock('@/lib/solana/escrow', () => ({ getConnection: jest.fn() }));
jest.mock('@/lib/solana/v2/pdas', () => ({
  findTradePda: jest.fn(() => [{ toBase58: () => 'tradePda' }]),
}));
jest.mock('@/lib/workerHealth', () => ({ runWorkerTick: jest.fn() }));
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { reconcileOneDispute, findReconcileCandidates } from '@/workers/disputeReconciler';

// A valid base58 wallet so `new PublicKey(...)` succeeds inside the reconciler.
const WALLET = 'FD4MqhLuobg1KFCXDok46PjMPWjPSL6P9wzLkwSvV9dr';
const candidate = (over: Partial<any> = {}) => ({
  id: 'order-1',
  escrow_creator_wallet: WALLET,
  escrow_trade_id: 7,
  dispute_reconcile_attempts: 0,
  ...over,
});

// Fake trade account with `status` at byte offset 120 (null = account absent).
function tradeAccount(status: number) {
  const data = Buffer.alloc(130);
  data[120] = status;
  return { data };
}
function fakeConn(status: number | null) {
  return {
    getAccountInfo: jest.fn(async () => (status === null ? null : tradeAccount(status))),
    getSignaturesForAddress: jest.fn(async () => [{ signature: 'sigABC' }]),
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue([]);
});

describe('reconcileOneDispute — on-chain status mapping', () => {
  test('Released (5) → resolution=user, finalize with releaseTxHash', async () => {
    mockFinalize.mockResolvedValue({ success: true });
    const out = await reconcileOneDispute(fakeConn(5), candidate());

    expect(out.action).toBe('finalized');
    expect(out.resolution).toBe('user');
    const arg = mockFinalize.mock.calls[0][0];
    expect(arg.resolution).toBe('user');
    expect(arg.releaseTxHash).toBe('sigABC');
    expect(arg.refundTxHash).toBeUndefined();
    expect(arg.requireSettlementTx).toBe(false);
    expect(arg.complianceMember.id).toBe('00000000-0000-0000-0000-000000000000');
  });

  test('Refunded (6) → resolution=merchant, finalize with refundTxHash', async () => {
    mockFinalize.mockResolvedValue({ success: true });
    const out = await reconcileOneDispute(fakeConn(6), candidate());

    expect(out.action).toBe('finalized');
    expect(out.resolution).toBe('merchant');
    const arg = mockFinalize.mock.calls[0][0];
    expect(arg.refundTxHash).toBe('sigABC');
    expect(arg.releaseTxHash).toBeUndefined();
  });

  test('Disputed (4) → not settled: NO finalize, records a backoff attempt', async () => {
    const out = await reconcileOneDispute(fakeConn(4), candidate());

    expect(out.action).toBe('not_settled');
    expect(mockFinalize).not.toHaveBeenCalled();
    // recordAttempt fired an UPDATE … dispute_reconcile_after
    expect(mockQuery).toHaveBeenCalled();
    expect(String(mockQuery.mock.calls[0][0])).toMatch(/dispute_reconcile_after/);
  });

  test('trade account unreadable/closed (null) → unreadable, NO finalize', async () => {
    const out = await reconcileOneDispute(fakeConn(null), candidate());

    expect(out.action).toBe('unreadable');
    expect(mockFinalize).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalled();
  });
});

describe('reconcileOneDispute — idempotency / never re-finalize', () => {
  test('helper rejects already-terminal order → already_finalized (treated as success)', async () => {
    mockFinalize.mockResolvedValue({
      success: false,
      error: "Cannot finalize dispute for order in 'completed' status",
    });
    const out = await reconcileOneDispute(fakeConn(5), candidate());

    expect(out.action).toBe('already_finalized');
    // No backoff attempt recorded for an already-finalized order.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('concurrent status change → already_finalized', async () => {
    mockFinalize.mockResolvedValue({
      success: false,
      error: 'Order status changed — finalization no longer valid. Refresh and retry.',
    });
    const out = await reconcileOneDispute(fakeConn(6), candidate());
    expect(out.action).toBe('already_finalized');
  });

  test('genuine finalize error → error + backoff recorded', async () => {
    mockFinalize.mockResolvedValue({ success: false, error: 'Balance invariant violated' });
    const out = await reconcileOneDispute(fakeConn(5), candidate());

    expect(out.action).toBe('error');
    expect(mockQuery).toHaveBeenCalled(); // backoff attempt recorded
  });
});

describe('findReconcileCandidates — coercion', () => {
  test('bigint escrow_trade_id (string from pg) is coerced to a number', async () => {
    mockQuery.mockResolvedValue([
      { id: 'o1', escrow_creator_wallet: WALLET, escrow_trade_id: '7', dispute_reconcile_attempts: 0 },
    ]);
    const rows = await findReconcileCandidates(10);
    expect(rows[0].escrow_trade_id).toBe(7);
    expect(typeof rows[0].escrow_trade_id).toBe('number');
  });
});
