/**
 * Atomic dispute PROPOSE — regression for the legacy `/api/compliance/disputes/[id]/resolve`
 * route (Patch B).
 *
 * BEFORE the fix the route fired three top-level statements with NO transaction:
 *   1. UPDATE disputes (status='investigating', proposed_resolution, ...)
 *   2. (catch fallback) UPDATE disputes WITHOUT enum cast — could double-write
 *   3. INSERT INTO chat_messages
 *
 * If step 1 succeeded and step 3 crashed (pool error, statement timeout), the
 * dispute would sit in 'investigating' state but no chat message ever appeared
 * to the parties. Worse, the catch-fallback could partially overwrite a row.
 *
 * This test verifies:
 *   - transaction() is invoked exactly once
 *   - both UPDATE disputes AND INSERT chat_messages run on the SAME client
 *     (proven by capturing client.calls and checking ordering)
 *   - the SAVEPOINT-based fallback is preserved when the enum cast UPDATE
 *     errors, AND the chat_messages INSERT still runs
 */

const mockTransaction = jest.fn();
const mockQuery = jest.fn();
const mockQueryOne = jest.fn();

jest.mock('@/lib/db', () => ({
  transaction: (cb: (client: unknown) => Promise<unknown>) => mockTransaction(cb),
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
}));

jest.mock('@/lib/middleware/auth', () => ({
  requireAuth: jest.fn(async () => ({
    actorType: 'compliance',
    actorId: 'comp-1',
    complianceId: 'comp-1',
  })),
}));

jest.mock('@/lib/middleware/rateLimit', () => ({
  checkRateLimit: jest.fn(async () => null),
  STRICT_LIMIT: { maxRequests: 5, windowMs: 60000 },
}));

jest.mock('@/lib/auditLog', () => ({
  auditLog: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Force the Next.js server runtime polyfills
import { POST } from '@/app/api/compliance/disputes/[id]/resolve/route';

interface CapturedCall { text: string; params: unknown[] }

function buildClient(opts: { failEnumCast?: boolean } = {}) {
  const calls: CapturedCall[] = [];
  return {
    calls,
    query: jest.fn(async (text: string, params?: unknown[]) => {
      calls.push({ text, params: params ?? [] });
      // Simulate the dispute_status enum being missing (legacy DB) → first
      // UPDATE throws, route should ROLLBACK TO SAVEPOINT and retry.
      if (
        opts.failEnumCast &&
        text.includes("status = 'investigating'::dispute_status")
      ) {
        throw new Error('type "dispute_status" does not exist');
      }
      return { rows: [] };
    }),
  };
}

function makeRequest(body: object) {
  return {
    json: async () => body,
  } as unknown as import('next/server').NextRequest;
}

const params = Promise.resolve({ id: 'order-X' });

beforeEach(() => {
  jest.clearAllMocks();
  // Default: dispute exists, status='disputed' (not 'resolved' / 'investigating')
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM disputes d') && sql.includes('JOIN orders')) {
      return [{
        status: 'disputed',
        user_id: 'user-1',
        merchant_id: 'merch-1',
        order_id: 'order-X',
        crypto_amount: '100',
      }];
    }
    return [];
  });
  mockQueryOne.mockResolvedValue({ has_compliance_access: true });
});

describe('atomicity — single transaction, both writes on same client', () => {
  test('happy path: UPDATE disputes and INSERT chat_messages run on same client', async () => {
    let captured: CapturedCall[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const client = buildClient();
      const out = await cb(client);
      captured = client.calls;
      return out;
    });

    const res = await POST(
      makeRequest({
        resolution: 'user',
        complianceId: 'comp-1',
        notes: 'looks like buyer wins',
      }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(1);

    // Both writes are present, in order, on the SAME client (same `calls` array)
    const updIdx = captured.findIndex(c => c.text.match(/UPDATE disputes/));
    const chatIdx = captured.findIndex(c => c.text.match(/INSERT INTO chat_messages/));
    expect(updIdx).toBeGreaterThanOrEqual(0);
    expect(chatIdx).toBeGreaterThan(updIdx);

    // SAVEPOINT was used to wrap the enum-cast attempt
    const savepointIdx = captured.findIndex(c =>
      c.text.includes('SAVEPOINT propose_status_cast')
    );
    expect(savepointIdx).toBeGreaterThanOrEqual(0);
    expect(savepointIdx).toBeLessThan(updIdx);
  });

  test('fallback path: enum cast fails → ROLLBACK TO SAVEPOINT, retry without cast, chat INSERT still runs', async () => {
    let captured: CapturedCall[] = [];
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const client = buildClient({ failEnumCast: true });
      const out = await cb(client);
      captured = client.calls;
      return out;
    });

    const res = await POST(
      makeRequest({
        resolution: 'merchant',
        complianceId: 'comp-1',
        notes: 'seller wins',
      }),
      { params }
    );

    expect(res.status).toBe(200);

    // Sequence proves savepoint protocol:
    //   SAVEPOINT → UPDATE (cast, fails) → ROLLBACK TO SAVEPOINT → RELEASE → UPDATE (no cast) → INSERT chat
    const seq = captured.map(c => {
      if (c.text === 'SAVEPOINT propose_status_cast') return 'savepoint';
      if (c.text === 'ROLLBACK TO SAVEPOINT propose_status_cast') return 'rollback_to_sp';
      if (c.text === 'RELEASE SAVEPOINT propose_status_cast') return 'release_sp';
      if (c.text.includes("status = 'investigating'::dispute_status")) return 'update_with_cast';
      if (c.text.match(/UPDATE disputes/) && !c.text.includes('::dispute_status')) {
        return 'update_no_cast';
      }
      if (c.text.match(/INSERT INTO chat_messages/)) return 'insert_chat';
      return null;
    }).filter(Boolean);

    expect(seq).toEqual([
      'savepoint',
      'update_with_cast',
      'rollback_to_sp',
      'release_sp',
      'update_no_cast',
      'insert_chat',
    ]);
  });

  test('all writes use the SAME client instance', async () => {
    const client = buildClient();
    let observedClient: unknown = null;
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      observedClient = client;
      return cb(client);
    });

    await POST(
      makeRequest({
        resolution: 'split',
        complianceId: 'comp-1',
        splitPercentage: { user: 50, merchant: 50 },
      }),
      { params }
    );

    // The mock `client.query` is the only entry point — every call recorded
    // on `client.calls` is by definition on the same client. We assert that
    // both writes were made and the cb was given exactly that one client.
    expect(observedClient).toBe(client);
    expect(client.calls.find(c => c.text.match(/UPDATE disputes/))).toBeDefined();
    expect(client.calls.find(c => c.text.match(/INSERT INTO chat_messages/))).toBeDefined();
  });

  test('transaction is invoked exactly once per request (no nested or duplicate)', async () => {
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      const client = buildClient();
      return cb(client);
    });

    await POST(
      makeRequest({
        resolution: 'user',
        complianceId: 'comp-1',
      }),
      { params }
    );

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('rollback safety — failure inside transaction propagates', () => {
  test('chat INSERT throws → outer transaction rejects → 500, no half-applied state', async () => {
    mockTransaction.mockImplementation(async (cb: (c: unknown) => Promise<unknown>) => {
      // Real `transaction()` ROLLBACKs on throw. The mock simulates that by
      // simply propagating the error — the caller's catch turns it into 500.
      const client = {
        query: jest.fn(async (text: string) => {
          if (text.match(/INSERT INTO chat_messages/)) {
            throw new Error('chat insert blew up');
          }
          return { rows: [] };
        }),
      };
      return cb(client);
    });

    const res = await POST(
      makeRequest({
        resolution: 'user',
        complianceId: 'comp-1',
      }),
      { params }
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

describe('idempotency — already-resolved or already-proposed dispute is rejected before transaction', () => {
  test('already resolved → 400, transaction NOT opened', async () => {
    mockQuery.mockImplementationOnce(async () => ([{
      status: 'resolved',
      user_id: 'user-1',
      merchant_id: 'merch-1',
      order_id: 'order-X',
      crypto_amount: '100',
    }]));

    const res = await POST(
      makeRequest({ resolution: 'user', complianceId: 'comp-1' }),
      { params }
    );

    expect(res.status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('already in investigating (resolution proposed) → 409, transaction NOT opened', async () => {
    mockQuery.mockImplementationOnce(async () => ([{
      status: 'investigating',
      user_id: 'user-1',
      merchant_id: 'merch-1',
      order_id: 'order-X',
      crypto_amount: '100',
    }]));

    const res = await POST(
      makeRequest({ resolution: 'user', complianceId: 'comp-1' }),
      { params }
    );

    expect(res.status).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
