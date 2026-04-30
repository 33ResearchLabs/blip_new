/**
 * Security Test Suite: GET /api/merchant/[id] PII / secret projection
 *
 * Regression coverage for the P0 leak where SELECT * + no auth exposed
 * password_hash, totp_secret, balances, and PII for any merchant UUID.
 *
 * Three independent layers must hold — each test pins one of them.
 */

import {
  SAFE_MERCHANT_COLUMNS,
  serializeMerchant,
} from '../../src/lib/db/repositories/merchants';

const FORBIDDEN_COLUMNS = [
  'password_hash',
  'totp_secret',
  'totp_enabled',
  'totp_verified_at',
  'synthetic_rate',
  'max_sinr_exposure',
  'auto_accept_enabled',
  'auto_accept_max_amount',
  'telegram_chat_id',
];

describe('L3: SAFE_MERCHANT_COLUMNS projection allowlist', () => {
  test('allowlist contains no auth secrets or internal-only fields', () => {
    for (const forbidden of FORBIDDEN_COLUMNS) {
      expect(SAFE_MERCHANT_COLUMNS).not.toContain(forbidden);
    }
  });

  test('allowlist exposes the public profile fields the frontend needs', () => {
    // Dropping any of these silently breaks /merchant/settings, leaderboard, etc.
    // Pin the contract.
    const required = [
      'id',
      'display_name',
      'business_name',
      'avatar_url',
      'status',
      'rating',
      'total_trades',
      'is_online',
    ];
    for (const col of required) {
      expect(SAFE_MERCHANT_COLUMNS).toContain(col);
    }
  });

  test('allowlist has no duplicates', () => {
    const set = new Set(SAFE_MERCHANT_COLUMNS);
    expect(set.size).toBe(SAFE_MERCHANT_COLUMNS.length);
  });
});

describe('L4: serializeMerchant DTO allowlist (defense in depth)', () => {
  // Even if a future bug causes secrets to leak past the SQL projection,
  // the serializer must not echo them.
  const fullRow = {
    id: 'm-1',
    username: 'alice',
    display_name: 'Alice',
    business_name: 'Alice LLC',
    wallet_address: '4Nd1m...',
    avatar_url: null,
    bio: 'hi',
    email: 'a@b.com',
    rating: 4.8,
    total_trades: 12,
    balance: 1000,
    has_ops_access: false,
    has_compliance_access: false,
    tour_completed_at: null,
    // Hostile inputs — must NOT appear in the output:
    password_hash: '$2b$12$leaked-hash',
    totp_secret: 'JBSWY3DPEHPK3PXP',
    totp_enabled: true,
    totp_verified_at: new Date(),
    synthetic_rate: 98,
    max_sinr_exposure: 999999,
    auto_accept_enabled: true,
    telegram_chat_id: 12345,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const dto = serializeMerchant(fullRow);
  const dtoKeys = Object.keys(dto);
  const dtoJson = JSON.stringify(dto);

  test.each(FORBIDDEN_COLUMNS)('output has no key %s', (key) => {
    expect(dtoKeys).not.toContain(key);
  });

  test('output JSON does not contain the literal secret values', () => {
    expect(dtoJson).not.toContain('$2b$12$leaked-hash');
    expect(dtoJson).not.toContain('JBSWY3DPEHPK3PXP');
  });

  test('output retains expected public fields', () => {
    expect(dto.id).toBe('m-1');
    expect(dto.display_name).toBe('Alice');
    expect(dto.rating).toBe(4.8);
  });
});

describe('L3: getMerchantByIdSafe SQL inspection', () => {
  // We mock the underlying queryOne to capture the SQL string and assert
  // (a) no SELECT *, (b) no forbidden columns, (c) parameterized id.
  let capturedSql = '';
  let capturedParams: unknown[] = [];

  jest.isolateModules(() => {
    jest.doMock('../../src/lib/db', () => ({
      __esModule: true,
      query: jest.fn(),
      queryOne: jest.fn((sql: string, params: unknown[]) => {
        capturedSql = sql;
        capturedParams = params;
        return Promise.resolve(null);
      }),
    }));
    jest.doMock('../../src/lib/cache', () => ({
      __esModule: true,
      getCachedMerchant: (
        _id: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        loader: (id: string) => Promise<any>,
      ) => loader(_id),
      invalidateMerchantCache: jest.fn(),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getMerchantByIdSafe } = require('../../src/lib/db/repositories/merchants');
    return getMerchantByIdSafe('11111111-1111-1111-1111-111111111111');
  });

  test('SQL does not use SELECT *', () => {
    expect(capturedSql).not.toMatch(/SELECT\s+\*/i);
  });

  test.each(FORBIDDEN_COLUMNS)('SQL does not select column %s', (col) => {
    // Whole-word match — avoids false positives on substrings (e.g. "totp_enabled"
    // would match if we just searched for "totp"). \b also avoids matching inside
    // a longer identifier.
    const re = new RegExp(`\\b${col}\\b`, 'i');
    expect(capturedSql).not.toMatch(re);
  });

  test('SQL passes id as a bound parameter', () => {
    expect(capturedSql).toMatch(/WHERE\s+id\s*=\s*\$1/i);
    expect(capturedParams).toEqual(['11111111-1111-1111-1111-111111111111']);
  });
});
