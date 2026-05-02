/**
 * Wallet-injection guard — assertWalletOwnership contract (strict-only).
 *
 * Three accept paths:
 *   - auth_match (Option A): walletAddress equals actor's verified wallet
 *   - signature  (Option B): valid signature over canonical binding message
 *   - no_check_needed: caller passed no wallet to validate
 *
 * Reject paths (ALWAYS reject — there is no warn-only allow-through):
 *   - mismatch + no signature → reject (regardless of env)
 *   - actor has no wallet on file + no signature → reject
 *   - signature provided but invalid → reject
 *
 * The previous lax/dual-mode rollout (WALLET_OWNERSHIP_STRICT=false) has
 * been removed. The env var is no longer read by the helper. The
 * `alwaysStrict` parameter is retained as a no-op for caller backward
 * compat; setting it true or false changes nothing.
 */

const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({ query: (...a: unknown[]) => mockQuery(...a) }));

const mockVerifySig = jest.fn();
jest.mock('@/lib/solana/verifySignature', () => ({
  verifyWalletSignature: (...a: unknown[]) => mockVerifySig(...a),
}));

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('@/lib/logger', () => ({ logger: mockLog }));

import {
  assertWalletOwnership,
  buildOrderBindingMessage,
  getActorWallet,
} from '@/lib/auth/walletOwnership';

const USER = { actorType: 'user' as const, actorId: 'user-1' };
const MERCHANT = { actorType: 'merchant' as const, actorId: 'merch-1' };
const WALLET_AUTH = 'AUTH-WALLET-AAA';
const WALLET_OTHER = 'OTHER-WALLET-BBB';
const ORDER_ID = 'order-42';

beforeEach(() => {
  jest.clearAllMocks();
  // Strict-only: env var is no longer consulted. Set every flavor to prove
  // each test below behaves identically regardless of what's in the env.
  delete process.env.WALLET_OWNERSHIP_STRICT;
});

describe('buildOrderBindingMessage matches frontend format', () => {
  test('Confirm action — matches useOrderActions.ts:382 format byte-for-byte', () => {
    expect(buildOrderBindingMessage('Confirm', ORDER_ID, WALLET_AUTH))
      .toBe(`Confirm order ${ORDER_ID} - I will send fiat payment. Wallet: ${WALLET_AUTH}`);
  });
  test('Claim action — matches useOrderActions.ts:290 format', () => {
    expect(buildOrderBindingMessage('Claim', ORDER_ID, WALLET_AUTH))
      .toBe(`Claim order ${ORDER_ID} - I will send fiat payment. Wallet: ${WALLET_AUTH}`);
  });
});

describe('getActorWallet', () => {
  test('user → SELECT users.wallet_address', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    const w = await getActorWallet(USER);
    expect(w).toBe(WALLET_AUTH);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM users WHERE id = \$1/);
  });
  test('merchant → SELECT merchants.wallet_address', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    const w = await getActorWallet(MERCHANT);
    expect(w).toBe(WALLET_AUTH);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM merchants WHERE id = \$1/);
  });
  test('compliance / system → null (cannot own a wallet via this lookup)', async () => {
    expect(await getActorWallet({ actorType: 'compliance', actorId: 'c-1' })).toBeNull();
    expect(await getActorWallet({ actorType: 'system', actorId: 's-1' })).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
  test('user with no wallet on file → null', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: null }]);
    expect(await getActorWallet(USER)).toBeNull();
  });
});

describe('assertWalletOwnership — accept paths', () => {
  test('no walletAddress in body → no_check_needed', async () => {
    const r = await assertWalletOwnership({ auth: USER, walletAddress: undefined });
    expect(r).toEqual({ ok: true, source: 'no_check_needed' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('Option A: wallet matches auth wallet → auth_match', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    const r = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_AUTH,
    });
    expect(r).toEqual({ ok: true, source: 'auth_match' });
    expect(mockVerifySig).not.toHaveBeenCalled();
  });

  test('Option B: different wallet but valid signature → signature', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    mockVerifySig.mockResolvedValueOnce(true);

    const r = await assertWalletOwnership({
      auth: MERCHANT,
      walletAddress: WALLET_OTHER,
      orderId: ORDER_ID,
      signature: 'sig-good',
      signatureAction: 'Confirm',
    });

    expect(r).toEqual({ ok: true, source: 'signature' });
    const verifyCall = mockVerifySig.mock.calls[0];
    expect(verifyCall[0]).toBe(WALLET_OTHER);
    expect(verifyCall[1]).toBe('sig-good');
    expect(verifyCall[2]).toBe(
      `Confirm order ${ORDER_ID} - I will send fiat payment. Wallet: ${WALLET_OTHER}`
    );
  });
});

describe('assertWalletOwnership — strict-only reject paths', () => {
  test('mismatch + no signature → REJECT with reason "wallet differs…" (no env required)', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);

    const r = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_OTHER,
    });

    expect(r.ok).toBe(false);
    expect(r.source).toBe('auth_match');
    expect(r.reason).toMatch(/wallet differs from authenticated/);
    expect(mockLog.error).toHaveBeenCalled();
    // No "lax" warn — the lax allow-through is gone
    const warnCalls = mockLog.warn.mock.calls.flatMap(c => c);
    expect(warnCalls.find(x => typeof x === 'string' && x.includes('lax'))).toBeUndefined();
  });

  test('actor has no wallet on file + no signature → REJECT', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: null }]);

    const r = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_OTHER,
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no wallet on file/);
  });

  test('signature provided but INVALID → REJECT', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    mockVerifySig.mockResolvedValueOnce(false);

    const r = await assertWalletOwnership({
      auth: USER,
      walletAddress: WALLET_OTHER,
      orderId: ORDER_ID,
      signature: 'sig-bad',
      signatureAction: 'Confirm',
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalid signature/);
    expect(mockLog.error).toHaveBeenCalled();
  });

  test('WALLET_OWNERSHIP_STRICT=false in env → STILL rejects (env is no longer consulted)', async () => {
    process.env.WALLET_OWNERSHIP_STRICT = 'false';
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);

    const r = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_OTHER,
    });

    expect(r.ok).toBe(false);
    // Same reject path as the env-unset case above — proves the env var
    // does not control behavior any more.
  });

  test('alwaysStrict=false → STILL rejects (parameter is a no-op)', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);

    const r = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_OTHER,
      alwaysStrict: false,
    });

    expect(r.ok).toBe(false);
  });

  test('alwaysStrict=true → rejects (same as default; parameter is a no-op)', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);

    const r = await assertWalletOwnership({
      auth: USER,
      walletAddress: WALLET_OTHER,
      alwaysStrict: true,
    });

    expect(r.ok).toBe(false);
  });
});

describe('Option B canonical message — replay/spoof guard', () => {
  test('signature for orderId X cannot be replayed on orderId Y', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    mockVerifySig.mockImplementationOnce(async (_w, _sig, msg) => {
      return msg.includes(`order order-X-real`);
    });

    const r = await assertWalletOwnership({
      auth: USER,
      walletAddress: WALLET_OTHER,
      orderId: 'order-Y-different',
      signature: 'sig-for-X',
      signatureAction: 'Confirm',
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/invalid signature/);
  });

  test('signature for action=Claim cannot satisfy a Confirm verification', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    mockVerifySig.mockImplementationOnce(async (_w, _sig, msg) => {
      return msg.startsWith('Claim order');
    });

    const r = await assertWalletOwnership({
      auth: USER,
      walletAddress: WALLET_OTHER,
      orderId: ORDER_ID,
      signature: 'sig-for-claim',
      signatureAction: 'Confirm',
    });

    expect(r.ok).toBe(false);
  });
});

describe('source field — lax_allowed is gone from the type union', () => {
  test('every reject path returns source = auth_match or signature, never lax_allowed', async () => {
    // Mismatch
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    const r1 = await assertWalletOwnership({ auth: USER, walletAddress: WALLET_OTHER });
    expect(r1.source).not.toBe('lax_allowed' as never);
    expect(['auth_match', 'signature']).toContain(r1.source);

    // No wallet on file
    mockQuery.mockResolvedValueOnce([{ wallet_address: null }]);
    const r2 = await assertWalletOwnership({ auth: USER, walletAddress: WALLET_OTHER });
    expect(r2.source).not.toBe('lax_allowed' as never);

    // Bad signature
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    mockVerifySig.mockResolvedValueOnce(false);
    const r3 = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_OTHER,
      orderId: ORDER_ID, signature: 'bad', signatureAction: 'Confirm',
    });
    expect(r3.source).toBe('signature');
    expect(r3.source).not.toBe('lax_allowed' as never);
  });
});
