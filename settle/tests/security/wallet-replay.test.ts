/**
 * Wallet-signature replay protection — STRICT MODE (no fallback).
 *
 * Verifies the contract enforced by verifyWalletAuthRequest:
 *   - signature is checked (Ed25519 over the canonical login message)
 *   - timestamp is inside the ±5 min window
 *   - nonce must be present, unconsumed, unexpired, and bound to the wallet
 *   - nonce is consumed exactly once (replay → 401)
 *   - NO fallback path: missing nonce → 400 (the LOGIN_NONCE_REQUIRED env
 *     flag and the legacy signature-only branch were both deleted)
 *   - Redis fast-path is consulted but Postgres remains source-of-truth
 */

const mockQuery = jest.fn();
const mockQueryOne = jest.fn();

jest.mock('@/lib/db', () => ({
  query: (...a: unknown[]) => mockQuery(...a),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
}));

const mockVerifyWalletSignature = jest.fn();
jest.mock('@/lib/solana/verifySignature', () => ({
  verifyWalletSignature: (...a: unknown[]) => mockVerifyWalletSignature(...a),
}));

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();
const fakeRedis = {
  status: 'ready' as string,
  get: mockRedisGet,
  set: mockRedisSet,
  del: mockRedisDel,
};
jest.mock('@/lib/cache/redis', () => ({
  redis: fakeRedis,
  cache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), exists: jest.fn() },
}));

import {
  buildLoginMessage,
  consumeLoginNonce,
  verifyWalletAuthRequest,
  NONCE_TTL_SECONDS,
} from '@/lib/auth/loginNonce';

const WALLET = 'AbcdEfGh1234567890SolanaWalletAddress0000000';
const NONCE = 'a'.repeat(64);

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisSet.mockResolvedValue('OK');
  mockRedisDel.mockResolvedValue(1);
  mockRedisGet.mockResolvedValue(null);
  fakeRedis.status = 'ready';
});

describe('strict-mode invariants (no fallback)', () => {
  test('isNonceRequired no longer exported — fallback flag was removed', async () => {
    // The export was deleted along with the legacy LOGIN_NONCE_REQUIRED path.
    // If a future change re-introduces it, this assertion will fail loudly.
    const mod = await import('@/lib/auth/loginNonce');
    expect((mod as Record<string, unknown>).isNonceRequired).toBeUndefined();
  });

  test('LOGIN_NONCE_REQUIRED=false env var no longer downgrades enforcement', async () => {
    // Even with the legacy flag set, strict behavior must hold.
    process.env.LOGIN_NONCE_REQUIRED = 'false';
    try {
      const r = await verifyWalletAuthRequest({
        walletAddress: WALLET,
        signature: 'sig',
        message: 'm',
        // @ts-expect-error — signature is `nonce: string`; pass empty to simulate stale clients
        nonce: '',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
      expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
    } finally {
      delete process.env.LOGIN_NONCE_REQUIRED;
    }
  });
});

describe('consumeLoginNonce — atomicity & replay rejection', () => {
  test('rejects when signed message does not contain Nonce: <hex>', async () => {
    const ok = await consumeLoginNonce(NONCE, WALLET, 'Sign this — no nonce in body');
    expect(ok).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  test('rejects malformed nonce values without hitting DB', async () => {
    expect(await consumeLoginNonce('', WALLET, `Nonce: ${NONCE}`)).toBe(false);
    expect(await consumeLoginNonce('x'.repeat(200), WALLET, 'Nonce: x')).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  test('Redis fast-path: wallet mismatch fails before Postgres', async () => {
    mockRedisGet.mockResolvedValueOnce('different-wallet');
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const ok = await consumeLoginNonce(NONCE, WALLET, msg);
    expect(ok).toBe(false);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  test('happy path: returns true and DELs Redis fast-path', async () => {
    mockRedisGet.mockResolvedValueOnce(WALLET);
    mockQueryOne.mockResolvedValueOnce({ nonce: NONCE });
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const ok = await consumeLoginNonce(NONCE, WALLET, msg);
    expect(ok).toBe(true);
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(mockRedisDel).toHaveBeenCalledWith(`login_nonce:${NONCE}`);
  });

  test('replay: second consume of the same nonce is rejected (PG returns null)', async () => {
    mockQueryOne.mockResolvedValueOnce({ nonce: NONCE }); // first consume
    mockQueryOne.mockResolvedValueOnce(null);              // replay
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    expect(await consumeLoginNonce(NONCE, WALLET, msg)).toBe(true);
    expect(await consumeLoginNonce(NONCE, WALLET, msg)).toBe(false);
  });

  test('Redis-down (status != ready): falls through to Postgres', async () => {
    fakeRedis.status = 'connecting';
    mockQueryOne.mockResolvedValueOnce({ nonce: NONCE });
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    expect(await consumeLoginNonce(NONCE, WALLET, msg)).toBe(true);
    expect(mockRedisGet).not.toHaveBeenCalled();
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
  });
});

describe('verifyWalletAuthRequest — full request contract', () => {
  test('400 when wallet/signature/message missing', async () => {
    const r = await verifyWalletAuthRequest({
      walletAddress: '', signature: '', message: '', nonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test('rejects request without nonce — no env-flag escape hatch', async () => {
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET,
      signature: 'sig',
      message: msg,
      // @ts-expect-error — strict signature requires `nonce: string`
      nonce: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/nonce/i);
    }
    // Crucially, signature verification MUST NOT have been attempted.
    // A captured (wallet, sig, message) triple is useless without a nonce.
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
  });

  test('rejects empty-string nonce (no soft acceptance)', async () => {
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: '',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
  });

  test('rejects null nonce (defensive — caller mistake)', async () => {
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET,
      signature: 'sig',
      message: msg,
      // @ts-expect-error — runtime defence against a bad caller
      nonce: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
  });

  test('rejects timestamp older than 5 min window', async () => {
    const old = Date.now() - (NONCE_TTL_SECONDS + 30) * 1000;
    const msg = buildLoginMessage(WALLET, NONCE, old);
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toMatch(/expired/i);
    }
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
  });

  test('rejects future timestamp outside the window', async () => {
    const future = Date.now() + (NONCE_TTL_SECONDS + 30) * 1000;
    const msg = buildLoginMessage(WALLET, NONCE, future);
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: NONCE,
    });
    expect(r.ok).toBe(false);
  });

  test('rejects message missing Timestamp:', async () => {
    const msg = `Sign this message to authenticate with Blip Money\n\nWallet: ${WALLET}\nNonce: ${NONCE}`;
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  test('happy path: in-window + valid sig + fresh nonce → ok', async () => {
    mockVerifyWalletSignature.mockResolvedValueOnce(true);
    mockRedisGet.mockResolvedValueOnce(WALLET);
    mockQueryOne.mockResolvedValueOnce({ nonce: NONCE });
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: NONCE,
    });
    expect(r.ok).toBe(true);
  });

  test('replay: same valid request rejected on second use', async () => {
    mockVerifyWalletSignature.mockResolvedValue(true);
    mockRedisGet.mockResolvedValueOnce(WALLET).mockResolvedValueOnce(null);
    mockQueryOne.mockResolvedValueOnce({ nonce: NONCE }).mockResolvedValueOnce(null);

    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const first = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: NONCE,
    });
    const second = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: NONCE,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(401);
  });

  test('attacker pairs valid sig with foreign wallet nonce → rejected', async () => {
    // Signature verifies for wallet A, but nonce belongs to wallet B in PG.
    // PG UPDATE will return null because (nonce, wallet=A) does not match.
    mockVerifyWalletSignature.mockResolvedValueOnce(true);
    mockRedisGet.mockResolvedValueOnce('attacker-wallet'); // Redis says wrong wallet
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });
});
