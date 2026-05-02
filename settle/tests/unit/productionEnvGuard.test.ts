/**
 * Production env-var startup gate.
 *
 * Verifies the contract:
 *   - All three required vars at expected values → ok, no throw
 *   - Any missing/wrong → throw (enforce) OR warn (warn mode)
 *   - SKIP_PRODUCTION_ENV_CHECK=true short-circuits with a loud warn
 *   - Failure summary names every wrong var (not just the first)
 *   - REQUIRED_VARS exposes exactly the three the security review demands
 */

import {
  REQUIRED_VARS,
  checkProductionSecurityEnv,
  assertProductionSecurityEnv,
} from '@/lib/security/productionEnvGuard';

const GOOD_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  LOGIN_NONCE_REQUIRED: 'true',
  WALLET_OWNERSHIP_STRICT: 'true',
};

function withEnv(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  // Build a fresh env object the helper reads directly — avoids mutating
  // process.env across tests.
  const e: Record<string, string | undefined> = { ...GOOD_ENV };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  return e;
}

describe('REQUIRED_VARS — exact security contract', () => {
  test('contains exactly three entries', () => {
    expect(REQUIRED_VARS).toHaveLength(3);
  });

  test('NODE_ENV → production', () => {
    const v = REQUIRED_VARS.find((x) => x.name === 'NODE_ENV');
    expect(v?.expected).toBe('production');
  });

  test('LOGIN_NONCE_REQUIRED → true', () => {
    const v = REQUIRED_VARS.find((x) => x.name === 'LOGIN_NONCE_REQUIRED');
    expect(v?.expected).toBe('true');
  });

  test('WALLET_OWNERSHIP_STRICT → true', () => {
    const v = REQUIRED_VARS.find((x) => x.name === 'WALLET_OWNERSHIP_STRICT');
    expect(v?.expected).toBe('true');
  });

  test('every entry carries a non-empty reason (for the failure summary)', () => {
    for (const v of REQUIRED_VARS) {
      expect(typeof v.reason).toBe('string');
      expect(v.reason.length).toBeGreaterThan(10);
    }
  });
});

describe('checkProductionSecurityEnv — pure check', () => {
  test('all three at expected values → ok=true, failures=[]', () => {
    const r = checkProductionSecurityEnv(withEnv({}));
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  test('NODE_ENV unset → flagged with actual=null', () => {
    const r = checkProductionSecurityEnv(withEnv({ NODE_ENV: undefined }));
    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.name === 'NODE_ENV');
    expect(f).toBeTruthy();
    expect(f!.expected).toBe('production');
    expect(f!.actual).toBeNull();
  });

  test('NODE_ENV=development → flagged with actual="development"', () => {
    const r = checkProductionSecurityEnv(withEnv({ NODE_ENV: 'development' }));
    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.name === 'NODE_ENV');
    expect(f!.actual).toBe('development');
  });

  test('LOGIN_NONCE_REQUIRED=false → flagged', () => {
    const r = checkProductionSecurityEnv(withEnv({ LOGIN_NONCE_REQUIRED: 'false' }));
    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.name === 'LOGIN_NONCE_REQUIRED');
    expect(f!.actual).toBe('false');
  });

  test('WALLET_OWNERSHIP_STRICT unset → flagged', () => {
    const r = checkProductionSecurityEnv(withEnv({ WALLET_OWNERSHIP_STRICT: undefined }));
    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.name === 'WALLET_OWNERSHIP_STRICT');
    expect(f!.actual).toBeNull();
  });

  test('all three wrong → all three reported (not just the first)', () => {
    const r = checkProductionSecurityEnv({});
    expect(r.failures).toHaveLength(3);
    const names = r.failures.map((x) => x.name).sort();
    expect(names).toEqual(['LOGIN_NONCE_REQUIRED', 'NODE_ENV', 'WALLET_OWNERSHIP_STRICT']);
  });

  test('"true" with leading/trailing whitespace is NOT accepted (exact match)', () => {
    // Common deploy-config bug: yaml multiline coercion adds whitespace.
    const r = checkProductionSecurityEnv(withEnv({ LOGIN_NONCE_REQUIRED: ' true' }));
    expect(r.ok).toBe(false);
  });

  test('values are case-sensitive — "True" / "PRODUCTION" do not pass', () => {
    expect(
      checkProductionSecurityEnv(withEnv({ NODE_ENV: 'PRODUCTION' })).ok
    ).toBe(false);
    expect(
      checkProductionSecurityEnv(withEnv({ LOGIN_NONCE_REQUIRED: 'True' })).ok
    ).toBe(false);
  });
});

describe('assertProductionSecurityEnv — enforce mode', () => {
  function makeLogger() {
    return {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  }

  test('all good → returns ok=true, no throw, info-logged', () => {
    const log = makeLogger();
    const r = assertProductionSecurityEnv({ mode: 'enforce', env: withEnv({}), logger: log });
    expect(r.ok).toBe(true);
    expect(log.info).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  test('NODE_ENV missing → throws with INSECURE_PRODUCTION_CONFIG code', () => {
    const log = makeLogger();
    expect(() =>
      assertProductionSecurityEnv({
        mode: 'enforce',
        env: withEnv({ NODE_ENV: undefined }),
        logger: log,
      })
    ).toThrow(/INSECURE CONFIGURATION/);

    try {
      assertProductionSecurityEnv({
        mode: 'enforce',
        env: withEnv({ NODE_ENV: undefined }),
        logger: log,
      });
    } catch (err) {
      expect((err as { code?: string }).code).toBe('INSECURE_PRODUCTION_CONFIG');
      expect((err as { failures?: unknown[] }).failures).toHaveLength(1);
    }
    expect(log.error).toHaveBeenCalled();
  });

  test('throw message names EVERY wrong var', () => {
    const log = makeLogger();
    try {
      assertProductionSecurityEnv({ mode: 'enforce', env: {}, logger: log });
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('NODE_ENV');
      expect(msg).toContain('LOGIN_NONCE_REQUIRED');
      expect(msg).toContain('WALLET_OWNERSHIP_STRICT');
      // And gives the actual values (here: <unset>)
      expect(msg).toMatch(/<unset>/);
    }
  });

  test('LOGIN_NONCE_REQUIRED=false → throws and logs reason', () => {
    const log = makeLogger();
    expect(() =>
      assertProductionSecurityEnv({
        mode: 'enforce',
        env: withEnv({ LOGIN_NONCE_REQUIRED: 'false' }),
        logger: log,
      })
    ).toThrow();
    const errCall = log.error.mock.calls.flat().join(' ');
    expect(errCall).toContain('LOGIN_NONCE_REQUIRED');
    expect(errCall).toMatch(/replay protection/i);
  });
});

describe('assertProductionSecurityEnv — warn mode (dev startups)', () => {
  function makeLogger() {
    return {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  }

  test('failures + warn mode → does NOT throw, warn-logs the same summary', () => {
    const log = makeLogger();
    const r = assertProductionSecurityEnv({
      mode: 'warn',
      env: withEnv({ NODE_ENV: 'development' }),
      logger: log,
    });
    expect(r.ok).toBe(false);
    expect(r.failures.length).toBeGreaterThan(0);
    expect(log.warn).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  test('all good + warn mode → still info-logs and returns ok', () => {
    const log = makeLogger();
    const r = assertProductionSecurityEnv({ mode: 'warn', env: withEnv({}), logger: log });
    expect(r.ok).toBe(true);
    expect(log.info).toHaveBeenCalled();
  });
});

describe('assertProductionSecurityEnv — escape hatch', () => {
  function makeLogger() {
    return {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
  }

  test('SKIP_PRODUCTION_ENV_CHECK=true → does not throw EVEN with all vars wrong, warn-logs loudly', () => {
    const log = makeLogger();
    const r = assertProductionSecurityEnv({
      mode: 'enforce',
      env: { SKIP_PRODUCTION_ENV_CHECK: 'true' },
      logger: log,
    });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    const warnText = log.warn.mock.calls.flat().join(' ');
    expect(warnText).toMatch(/SKIP_PRODUCTION_ENV_CHECK/);
    expect(warnText).toMatch(/BYPASSED|Never use/i);
  });

  test('SKIP_PRODUCTION_ENV_CHECK=true_but_misspelled → does NOT bypass', () => {
    const log = makeLogger();
    expect(() =>
      assertProductionSecurityEnv({
        mode: 'enforce',
        env: { SKIP_PRODUCTION_ENV_CHECK: 'yes' },
        logger: log,
      })
    ).toThrow();
  });

  test('SKIP_PRODUCTION_ENV_CHECK=true respected even in warn mode (no double-log clutter)', () => {
    const log = makeLogger();
    const r = assertProductionSecurityEnv({
      mode: 'warn',
      env: { SKIP_PRODUCTION_ENV_CHECK: 'true' },
      logger: log,
    });
    expect(r.skipped).toBe(true);
  });
});
