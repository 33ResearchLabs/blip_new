/**
 * Ownership helper — unit tests for assertActorOwnership /
 * assertActorIsParticipant. No DB. Verifies the rejection contract:
 *
 *   - missing x-actor-id  → 403
 *   - id mismatch         → 403
 *   - type mismatch       → 403
 *   - match               → null (caller proceeds)
 *
 * Run: tsx apps/core-api/tests/ownership.test.ts
 */

import assert from 'node:assert';
import Fastify from 'fastify';
import { assertActorOwnership, assertActorIsParticipant } from '../src/ownership.js';

interface Captured {
  statusCode: number;
  body: { success: boolean; error?: string };
}

function makeApp() {
  const app = Fastify({ logger: false });

  app.post<{ Body: { expectedId: string; expectedType?: string } }>(
    '/owner-check',
    async (request, reply) => {
      const fail = assertActorOwnership(request, reply, {
        expectedActorId: request.body.expectedId,
        expectedActorType: request.body.expectedType,
        context: 'unit_test',
      });
      if (fail) return fail;
      return reply.send({ success: true, data: { ok: true } });
    },
  );

  app.post<{ Body: { candidates: string[] } }>(
    '/participant-check',
    async (request, reply) => {
      const fail = assertActorIsParticipant(
        request,
        reply,
        request.body.candidates,
        'unit_test',
      );
      if (fail) return fail;
      return reply.send({ success: true, data: { ok: true } });
    },
  );

  return app;
}

async function call(
  app: ReturnType<typeof makeApp>,
  url: string,
  payload: unknown,
  headers: Record<string, string>,
): Promise<Captured> {
  const res = await app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', ...headers },
    payload,
  });
  return { statusCode: res.statusCode, body: res.json() };
}

async function main(): Promise<void> {
  const app = makeApp();
  let passed = 0;
  const check = (name: string, cond: boolean, ctx?: unknown) => {
    if (!cond) {
      console.error(`FAIL: ${name}`, ctx ?? '');
      process.exit(1);
    }
    console.log(`  ✓ ${name}`);
    passed++;
  };

  console.log('Ownership helper — unit tests');

  // ── assertActorOwnership ──
  const owner = await call(
    app,
    '/owner-check',
    { expectedId: 'alice', expectedType: 'user' },
    { 'x-actor-id': 'alice', 'x-actor-type': 'user' },
  );
  check('match: id+type → 2xx', owner.statusCode === 200 && owner.body.success === true);

  const ownerNoType = await call(
    app,
    '/owner-check',
    { expectedId: 'alice' },
    { 'x-actor-id': 'alice' },
  );
  check('match: id only (no expectedType) → 2xx', ownerNoType.statusCode === 200);

  const ownerHeaderTypeIgnored = await call(
    app,
    '/owner-check',
    { expectedId: 'alice' },
    { 'x-actor-id': 'alice', 'x-actor-type': 'user' },
  );
  check(
    'header type present but no expectedType → still 2xx (type only checked when expected)',
    ownerHeaderTypeIgnored.statusCode === 200,
  );

  const noHeader = await call(
    app,
    '/owner-check',
    { expectedId: 'alice' },
    {},
  );
  check(
    'missing x-actor-id → 403',
    noHeader.statusCode === 403 && noHeader.body.error === 'Actor identity required',
  );

  const idMismatch = await call(
    app,
    '/owner-check',
    { expectedId: 'alice' },
    { 'x-actor-id': 'mallory' },
  );
  check(
    'id mismatch → 403',
    idMismatch.statusCode === 403 &&
      idMismatch.body.error === 'Actor identity does not match resource owner',
  );

  const typeMismatch = await call(
    app,
    '/owner-check',
    { expectedId: 'alice', expectedType: 'merchant' },
    { 'x-actor-id': 'alice', 'x-actor-type': 'user' },
  );
  check(
    'type mismatch → 403',
    typeMismatch.statusCode === 403 &&
      typeMismatch.body.error === 'Actor type does not match resource',
  );

  // Empty-string header is treated as missing (defensive: prevents `===''` matches)
  const emptyHeader = await call(
    app,
    '/owner-check',
    { expectedId: '' },
    { 'x-actor-id': '' },
  );
  check(
    'empty x-actor-id rejected even when expected is empty (no implicit-equality bypass)',
    emptyHeader.statusCode === 403,
  );

  // ── assertActorIsParticipant ──
  const partOk = await call(
    app,
    '/participant-check',
    { candidates: ['alice', 'bob'] },
    { 'x-actor-id': 'bob' },
  );
  check('participant present → 2xx', partOk.statusCode === 200);

  const partMiss = await call(
    app,
    '/participant-check',
    { candidates: ['alice', 'bob'] },
    { 'x-actor-id': 'mallory' },
  );
  check(
    'participant absent → 403',
    partMiss.statusCode === 403 && partMiss.body.error === 'Not authorized for this resource',
  );

  const partNoHeader = await call(
    app,
    '/participant-check',
    { candidates: ['alice', 'bob'] },
    {},
  );
  check('missing x-actor-id on participant check → 403', partNoHeader.statusCode === 403);

  const partAllNullCandidates = await call(
    app,
    '/participant-check',
    { candidates: [] },
    { 'x-actor-id': 'alice' },
  );
  check('no valid candidates → 403 (cannot match empty set)', partAllNullCandidates.statusCode === 403);

  await app.close();
  console.log(`\nPASS — ${passed} ownership-helper checks`);
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
