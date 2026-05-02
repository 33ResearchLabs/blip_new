/**
 * Arbitration AuthZ regression test (B4).
 *
 * Pure unit test of `assertArbitrationAccess` semantics, exercised via
 * the route module so it stays in sync with the production code.
 *
 *   - GET  by non-compliance non-participant → 403
 *   - POST by non-compliance                  → 403 (mutate is compliance-only)
 *   - PATCH by non-compliance                 → 403
 *   - GET  by participant                     → reaches DB layer (not 403)
 *
 * The DB layer is mocked at the @/lib/db boundary so this test does NOT
 * need a live Postgres.
 *
 * Run: tsx settle/tests/security/arbitration-authz.test.ts
 */

import assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import Module from 'node:module';

// ── Mock @/lib/db before importing the route ─────────────────────────
const ORDER_ID = randomUUID();
const USER_ID = randomUUID();
const MERCHANT_ID = randomUUID();
const OUTSIDER_ID = randomUUID();

const requireOriginal = Module.createRequire(import.meta.url);
const Mod: any = Module;
const originalLoad = Mod._load;
Mod._load = function patched(spec: string, parent: any, isMain: boolean) {
  if (spec === '@/lib/db' || spec.endsWith('/lib/db')) {
    return {
      query: async (sql: string, params: unknown[]) => {
        if (/FROM orders/i.test(sql)) {
          return [{ user_id: USER_ID, merchant_id: MERCHANT_ID, buyer_merchant_id: null }];
        }
        if (/FROM dispute_arbitrations/i.test(sql)) return [];
        if (/FROM disputes/i.test(sql)) return [];
        return [];
      },
    };
  }
  return originalLoad.call(this, spec, parent, isMain);
};

// Also mock requireAuth for deterministic actor injection
let injectedAuth: { actorType: string; actorId: string } = { actorType: 'user', actorId: OUTSIDER_ID };
Mod._load = (function (prev: any) {
  return function patched(spec: string, parent: any, isMain: boolean) {
    if (spec === '@/lib/middleware/auth' || spec.endsWith('/middleware/auth')) {
      return {
        requireAuth: async () => injectedAuth,
        forbiddenResponse: (msg: string) =>
          new Response(JSON.stringify({ success: false, error: msg }), { status: 403 }),
      };
    }
    return prev.call(this, spec, parent, isMain);
  };
})(Mod._load);

// Mock arbiter repo so POST/PATCH would otherwise reach DB
Mod._load = (function (prev: any) {
  return function patched(spec: string, parent: any, isMain: boolean) {
    if (spec === '@/lib/arbiters/repository') {
      return {
        selectArbitersForDispute: async () => ({ arbitration: {}, selectedArbiters: [] }),
        getArbitrationDetails: async () => null,
        checkAndConcludeArbitration: async () => undefined,
        initializeArbiterTables: async () => undefined,
      };
    }
    if (spec === '@/lib/arbiters/types') return { VOTING_CONFIG: {} };
    return prev.call(this, spec, parent, isMain);
  };
})(Mod._load);

const route = await import('../../src/app/api/disputes/[id]/arbitration/route.js');

function buildRequest(headers: Record<string, string> = {}): any {
  return {
    headers: new Headers(headers),
    cookies: { get: () => undefined },
    nextUrl: { pathname: '/api/disputes/x/arbitration' },
  };
}

async function main() {
  const params = Promise.resolve({ id: ORDER_ID });

  // ── T1: outsider GET → 403 ──
  injectedAuth = { actorType: 'user', actorId: OUTSIDER_ID };
  {
    const res: any = await (route as any).GET(buildRequest(), { params });
    assert.strictEqual(res.status, 403, 'outsider GET must be 403');
  }

  // ── T2: outsider POST → 403 (mutate compliance-only) ──
  injectedAuth = { actorType: 'user', actorId: OUTSIDER_ID };
  {
    const res: any = await (route as any).POST(buildRequest(), { params });
    assert.strictEqual(res.status, 403, 'outsider POST must be 403');
  }

  // ── T3: participant POST → 403 (still mutate-only) ──
  injectedAuth = { actorType: 'user', actorId: USER_ID };
  {
    const res: any = await (route as any).POST(buildRequest(), { params });
    assert.strictEqual(res.status, 403, 'participant POST must be 403 — compliance-only');
  }

  // ── T4: outsider PATCH → 403 ──
  injectedAuth = { actorType: 'merchant', actorId: OUTSIDER_ID };
  {
    const res: any = await (route as any).PATCH(buildRequest(), { params });
    assert.strictEqual(res.status, 403, 'outsider PATCH must be 403');
  }

  // ── T5: participant GET → does NOT 403 (reaches DB layer, returns 200/404) ──
  injectedAuth = { actorType: 'user', actorId: USER_ID };
  {
    const res: any = await (route as any).GET(buildRequest(), { params });
    assert.notStrictEqual(res.status, 403, 'participant GET must not be 403');
  }

  // ── T6: compliance POST → does NOT 403 ──
  injectedAuth = { actorType: 'compliance', actorId: randomUUID() };
  {
    const res: any = await (route as any).POST(buildRequest(), { params });
    assert.notStrictEqual(res.status, 403, 'compliance POST must not be 403');
  }

  console.log('arbitration-authz: ALL TESTS PASSED');
}

main().catch((err) => {
  console.error('arbitration-authz FAILED:', err);
  process.exit(1);
});
