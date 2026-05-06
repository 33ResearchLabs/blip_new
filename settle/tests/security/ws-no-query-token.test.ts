/**
 * WebSocket auth — query-string token is rejected (B6).
 *
 * `extractToken` in src/realtime/wsAuth.ts must NOT honour `?token=...`
 * in any environment. Auth flows over `Authorization: Bearer` or the
 * `Sec-WebSocket-Protocol` subprotocol field.
 *
 * Run: tsx settle/tests/security/ws-no-query-token.test.ts
 */

import assert from 'node:assert';
import type { IncomingMessage } from 'http';
import { extractToken } from '../../src/realtime/wsAuth.ts';

function fakeReq(opts: { url?: string; headers?: Record<string, string> }): IncomingMessage {
  return {
    url: opts.url ?? '/ws/chat',
    headers: opts.headers ?? {},
  } as unknown as IncomingMessage;
}

function run(env: 'production' | 'development') {
  const previous = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = env;
  try {
    // T1: query-string token is REJECTED in both envs
    {
      const t = extractToken(fakeReq({ url: '/ws/chat?token=secret-from-url' }));
      assert.strictEqual(t, null, `[${env}] query-string token must be rejected`);
    }

    // T2: ?token= alongside other params still rejected
    {
      const t = extractToken(
        fakeReq({ url: '/ws/chat?actorType=user&actorId=u1&token=leaky' }),
      );
      assert.strictEqual(t, null, `[${env}] mixed query params still rejected`);
    }

    // T3: Authorization: Bearer is honoured
    {
      const t = extractToken(
        fakeReq({ headers: { authorization: 'Bearer good-token' } }),
      );
      assert.strictEqual(t, 'good-token', `[${env}] Bearer header honoured`);
    }

    // T4: Sec-WebSocket-Protocol subprotocol is honoured
    {
      const t = extractToken(
        fakeReq({ headers: { 'sec-websocket-protocol': 'bearer, sub-token' } }),
      );
      assert.strictEqual(t, 'sub-token', `[${env}] subprotocol honoured`);
    }

    // T5: no auth at all → null
    {
      const t = extractToken(fakeReq({}));
      assert.strictEqual(t, null, `[${env}] no auth → null`);
    }
  } finally {
    (process.env as any).NODE_ENV = previous;
  }
}

run('development');
run('production');
console.log('ws-no-query-token: ALL TESTS PASSED');
