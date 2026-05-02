/**
 * Wallet login — Domain / URI binding tests.
 *
 * Verifies that signed login messages are bound to this server's origin via
 * a `Domain:` line in the canonical message:
 *
 *   - matching Domain                                    → accepted
 *   - mismatched Domain                                  → 401
 *   - mismatched URI (Domain ok)                         → 401
 *   - missing Domain (legacy), default lax mode          → accepted + warn
 *   - missing Domain (legacy), strict mode (env flag)    → 401
 *   - env-overridden Domain (custom origin)              → matches custom
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

jest.mock('@/lib/cache/redis', () => ({
  redis: {
    status: 'ready',
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
  },
  cache: { get: jest.fn(), set: jest.fn(), del: jest.fn(), exists: jest.fn() },
}));

import {
  buildLoginMessage,
  verifyWalletAuthRequest,
  assertDomainBinding,
} from '@/lib/auth/loginNonce';

const WALLET = 'AbcdEfGh1234567890SolanaWalletAddress0000000';
const NONCE = 'a'.repeat(64);

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  // Restore env to a known baseline before each test so previous overrides
  // don't leak across cases.
  process.env = { ...ORIGINAL_ENV };
  delete process.env.LOGIN_DOMAIN;
  delete process.env.LOGIN_URI;
  delete process.env.LOGIN_STRICT_DOMAIN;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('assertDomainBinding — pure-function checks', () => {
  test('accepts message whose Domain matches expected default (blip.money)', () => {
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    expect(assertDomainBinding(msg)).toBeNull();
  });

  test('rejects message with wrong Domain even at the right URI', () => {
    const phishingMsg = buildLoginMessage(WALLET, NONCE, Date.now(), 'evil.example', 'https://blip.money');
    const result = assertDomainBinding(phishingMsg);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
    expect(result?.error).toMatch(/Domain does not match/);
  });

  test('rejects message whose URI disagrees with expected (Domain ok)', () => {
    const msg = buildLoginMessage(WALLET, NONCE, Date.now(), 'blip.money', 'https://staging.blip.money');
    const result = assertDomainBinding(msg);
    expect(result).not.toBeNull();
    expect(result?.error).toMatch(/URI does not match/);
  });

  test('lax mode: legacy message without Domain line is accepted', () => {
    const legacyMsg =
      `Sign this message to authenticate with Blip Money\n\n` +
      `Wallet: ${WALLET}\nTimestamp: ${Date.now()}\nNonce: ${NONCE}`;
    expect(assertDomainBinding(legacyMsg)).toBeNull();
  });

  test('strict mode: legacy message without Domain is rejected', () => {
    process.env.LOGIN_STRICT_DOMAIN = 'true';
    const legacyMsg =
      `Sign this message to authenticate with Blip Money\n\n` +
      `Wallet: ${WALLET}\nTimestamp: ${Date.now()}\nNonce: ${NONCE}`;
    const result = assertDomainBinding(legacyMsg);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
    expect(result?.error).toMatch(/missing Domain/);
  });

  test('env override: server can require a custom Domain (e.g. staging)', () => {
    process.env.LOGIN_DOMAIN = 'staging.blip.money';
    process.env.LOGIN_URI = 'https://staging.blip.money';
    const stagingMsg = buildLoginMessage(WALLET, NONCE, Date.now());
    expect(stagingMsg).toContain('Domain: staging.blip.money');
    expect(assertDomainBinding(stagingMsg)).toBeNull();

    // A signature for the prod Domain should now be rejected on staging.
    const prodMsg = buildLoginMessage(WALLET, NONCE, Date.now(), 'blip.money', 'https://blip.money');
    expect(assertDomainBinding(prodMsg)).not.toBeNull();
  });

  test('whitespace tolerance: trims declared Domain/URI before compare', () => {
    const msgWithSpaces =
      `Sign this message to authenticate with Blip Money\n\n` +
      `Domain:    blip.money   \n` +
      `URI:    https://blip.money   \n` +
      `Wallet: ${WALLET}\nTimestamp: ${Date.now()}\nNonce: ${NONCE}`;
    expect(assertDomainBinding(msgWithSpaces)).toBeNull();
  });
});

describe('verifyWalletAuthRequest — domain binding integration', () => {
  test('rejects cross-origin signed message before signature/nonce checks', async () => {
    const phishMsg = buildLoginMessage(WALLET, NONCE, Date.now(), 'evil.example');
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: phishMsg, nonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toMatch(/Domain/i);
    }
    // Domain mismatch must short-circuit BEFORE expensive signature
    // verification and BEFORE consuming the nonce.
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  test('strict mode: legacy domain-less message rejected end-to-end', async () => {
    process.env.LOGIN_STRICT_DOMAIN = 'true';
    const legacyMsg =
      `Sign this message to authenticate with Blip Money\n\n` +
      `Wallet: ${WALLET}\nTimestamp: ${Date.now()}\nNonce: ${NONCE}`;
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: legacyMsg, nonce: NONCE,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
    expect(mockVerifyWalletSignature).not.toHaveBeenCalled();
  });

  test('lax mode: legacy domain-less message proceeds to signature check', async () => {
    const legacyMsg =
      `Sign this message to authenticate with Blip Money\n\n` +
      `Wallet: ${WALLET}\nTimestamp: ${Date.now()}\nNonce: ${NONCE}`;
    mockVerifyWalletSignature.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ nonce: NONCE });
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: legacyMsg, nonce: NONCE,
    });
    expect(r.ok).toBe(true);
    expect(mockVerifyWalletSignature).toHaveBeenCalled();
  });

  test('happy path: domain-bound message with valid sig + nonce → ok', async () => {
    mockVerifyWalletSignature.mockResolvedValueOnce(true);
    mockQueryOne.mockResolvedValueOnce({ nonce: NONCE });
    const msg = buildLoginMessage(WALLET, NONCE, Date.now());
    const r = await verifyWalletAuthRequest({
      walletAddress: WALLET, signature: 'sig', message: msg, nonce: NONCE,
    });
    expect(r.ok).toBe(true);
  });
});
