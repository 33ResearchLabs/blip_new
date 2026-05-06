/**
 * Settle idempotency — requireIdempotencyKey + post-execute gap closure (B1+B2).
 *
 * Pure unit test of the new idempotency module:
 *
 *   T1. `getIdempotencyKey` returns null when neither header is set,
 *       and the value when either `Idempotency-Key` or `X-Idempotency-Key`
 *       is set.
 *
 *   T2. `requireIdempotencyKey` returns a 400 NextResponse when the
 *       header is missing OR whitespace-only; null when present.
 *
 *   T3. `withIdempotency` no longer touches the database. The legacy
 *       post-execute storage gap is GONE — the wrapper is a pure
 *       pass-through whose `cached` flag is always false.
 *
 *   T4. Two concurrent invocations of the wrapper invoke `execute()`
 *       independently (settle no longer caches; core-api does the
 *       atomic dedup downstream). The wrapper itself never short-
 *       circuits — that is a property of the new design.
 *
 * Run: tsx settle/tests/security/idempotency-required.test.ts
 */

import assert from 'node:assert';
import {
  getIdempotencyKey,
  requireIdempotencyKey,
  withIdempotency,
} from '../../src/lib/idempotency.ts';

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://test.local/x', { headers });
}

async function main() {
  // ── T1: getIdempotencyKey ──
  assert.strictEqual(getIdempotencyKey(makeRequest({})), null);
  assert.strictEqual(
    getIdempotencyKey(makeRequest({ 'idempotency-key': 'abc' })),
    'abc',
  );
  assert.strictEqual(
    getIdempotencyKey(makeRequest({ 'x-idempotency-key': 'xyz' })),
    'xyz',
  );

  // ── T2a: missing header → 400 ──
  {
    const res = requireIdempotencyKey(makeRequest({}));
    assert.ok(res, 'missing header must return a NextResponse');
    assert.strictEqual(res!.status, 400, 'missing header must be 400');
  }

  // ── T2b: whitespace-only header → 400 ──
  {
    const res = requireIdempotencyKey(makeRequest({ 'idempotency-key': '   ' }));
    assert.ok(res, 'whitespace-only header must 400');
    assert.strictEqual(res!.status, 400);
  }

  // ── T2c: present header → null (pass) ──
  {
    const res = requireIdempotencyKey(makeRequest({ 'idempotency-key': 'k1' }));
    assert.strictEqual(res, null, 'valid header passes');
  }

  // ── T3: withIdempotency executes exactly once and returns result ──
  {
    let calls = 0;
    const out = await withIdempotency('k', 'create_order', null, async () => {
      calls++;
      return { data: { ok: true }, statusCode: 201 };
    });
    assert.strictEqual(calls, 1, 'execute called exactly once');
    assert.strictEqual(out.cached, false, 'cached flag is always false in new design');
    assert.strictEqual(out.statusCode, 201);
    assert.deepStrictEqual(out.data, { ok: true });
  }

  // ── T4: parallel invocations both reach execute (no hidden dedup) ──
  {
    let calls = 0;
    const exec = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { data: { n: calls }, statusCode: 200 };
    };
    await Promise.all([
      withIdempotency('same-key', 'create_order', null, exec),
      withIdempotency('same-key', 'create_order', null, exec),
    ]);
    assert.strictEqual(calls, 2, 'settle does not cache — both run; core-api dedups downstream');
  }

  console.log('idempotency-required: ALL TESTS PASSED');
}

main().catch((err) => {
  console.error('idempotency-required FAILED:', err);
  process.exit(1);
});
