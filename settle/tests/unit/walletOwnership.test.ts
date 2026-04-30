/**
 * Wallet-injection guard — assertWalletOwnership contract.
 *
 * Three accept paths:
 *   - auth_match (Option A): walletAddress equals actor's verified wallet
 *   - signature  (Option B): valid signature over canonical binding message
 *   - lax_allowed: strict-mode off, mismatch logged but allowed
 *
 * Two reject paths:
 *   - signature provided but invalid → reject regardless of strict mode
 *   - no match + no signature + strict=true → reject
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
  isWalletOwnershipStrict,
} from '@/lib/auth/walletOwnership';

const USER = { actorType: 'user' as const, actorId: 'user-1' };
const MERCHANT = { actorType: 'merchant' as const, actorId: 'merch-1' };
const WALLET_AUTH = 'AUTH-WALLET-AAA';
const WALLET_OTHER = 'OTHER-WALLET-BBB';
const ORDER_ID = 'order-42';

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.WALLET_OWNERSHIP_STRICT;
});

describe('isWalletOwnershipStrict', () => {
  test('defaults to false (dual-mode rollout)', () => {
    expect(isWalletOwnershipStrict()).toBe(false);
  });
  test('true when env=true', () => {
    process.env.WALLET_OWNERSHIP_STRICT = 'true';
    expect(isWalletOwnershipStrict()).toBe(true);
  });
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
    // No signature verification needed
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
    // Verifies the EXACT canonical message, not arbitrary text
    const verifyCall = mockVerifySig.mock.calls[0];
    expect(verifyCall[0]).toBe(WALLET_OTHER);
    expect(verifyCall[1]).toBe('sig-good');
    expect(verifyCall[2]).toBe(
      `Confirm order ${ORDER_ID} - I will send fiat payment. Wallet: ${WALLET_OTHER}`
    );
  });

  test('lax mode: mismatch + no signature → lax_allowed with WARN log', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);

    const r = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_OTHER,
    });

    expect(r.ok).toBe(true);
    expect(r.source).toBe('lax_allowed');
    const warnCalls = mockLog.warn.mock.calls.flatMap(c => c);
    const tag = warnCalls.find(x => typeof x === 'string' && x.includes('[security][wallet_inject]'));
    expect(tag).toBeTruthy();
  });
});

describe('assertWalletOwnership — reject paths', () => {
  test('strict mode: mismatch + no signature → ok=false with ERROR log', async () => {
    process.env.WALLET_OWNERSHIP_STRICT = 'true';
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);

    const r = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_OTHER,
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/wallet differs from authenticated/);
    expect(mockLog.error).toHaveBeenCalled();
  });

  test('strict mode: actor has no wallet on file + no signature → reject', async () => {
    process.env.WALLET_OWNERSHIP_STRICT = 'true';
    mockQuery.mockResolvedValueOnce([{ wallet_address: null }]);

    const r = await assertWalletOwnership({
      auth: USER, walletAddress: WALLET_OTHER,
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no wallet on file/);
  });

  test('signature provided but INVALID → reject regardless of strict flag', async () => {
    // Even in lax mode, a presented-but-invalid signature is never trusted.
    process.env.WALLET_OWNERSHIP_STRICT = 'false';
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

  test('alwaysStrict: forces strict regardless of env', async () => {
    process.env.WALLET_OWNERSHIP_STRICT = 'false'; // lax in env
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);

    const r = await assertWalletOwnership({
      auth: USER,
      walletAddress: WALLET_OTHER,
      alwaysStrict: true,    // ← release-time guard
    });

    expect(r.ok).toBe(false);
  });
});

describe('Option B canonical message — replay/spoof guard', () => {
  test('signature for orderId X cannot be replayed on orderId Y', async () => {
    mockQuery.mockResolvedValueOnce([{ wallet_address: WALLET_AUTH }]);
    // Mock simulates real verify: returns true ONLY when message matches
    // signature inputs (signed for order-X but presented as order-Y).
    mockVerifySig.mockImplementationOnce(async (_w, _sig, msg) => {
      return msg.includes(`order order-X-real`); // signed-for order
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
      return msg.startsWith('Claim order'); // signed for Claim
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
