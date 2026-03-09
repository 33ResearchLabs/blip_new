/**
 * Request ID Hook Tests
 *
 * Verifies that the Fastify request ID system:
 * 1. Reads x-request-id from incoming headers via genReqId
 * 2. Generates a UUID when header is missing
 * 3. Returns x-request-id in response headers via onRequest hook
 * 4. Makes request.id available in route handlers
 *
 * Run: tsx apps/core-api/tests/requestId.test.ts
 */

import Fastify from 'fastify';
import assert from 'assert';
import { registerRequestIdHeader, genReqId } from '../src/hooks/requestId.js';

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

function buildApp() {
  const app = Fastify({ logger: false, genReqId });
  registerRequestIdHeader(app);
  return app;
}

// ── Tests ──

test('echoes provided x-request-id header', async () => {
  const app = buildApp();
  app.get('/test', async (request) => {
    return { requestId: request.id };
  });

  const res = await app.inject({
    method: 'GET',
    url: '/test',
    headers: { 'x-request-id': 'test-123' },
  });

  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['x-request-id'], 'test-123');
  const body = JSON.parse(res.body);
  assert.strictEqual(body.requestId, 'test-123');
  await app.close();
});

test('generates UUID when x-request-id is missing', async () => {
  const app = buildApp();
  app.get('/test', async (request) => {
    return { requestId: request.id };
  });

  const res = await app.inject({
    method: 'GET',
    url: '/test',
  });

  assert.strictEqual(res.statusCode, 200);
  const responseReqId = res.headers['x-request-id'] as string;
  assert.ok(responseReqId, 'x-request-id header should be present');
  // UUID format: 8-4-4-4-12 hex chars
  assert.match(responseReqId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

  const body = JSON.parse(res.body);
  assert.strictEqual(body.requestId, responseReqId);
  await app.close();
});

test('ignores empty x-request-id header and generates UUID', async () => {
  const app = buildApp();
  app.get('/test', async (request) => {
    return { requestId: request.id };
  });

  const res = await app.inject({
    method: 'GET',
    url: '/test',
    headers: { 'x-request-id': '' },
  });

  assert.strictEqual(res.statusCode, 200);
  const responseReqId = res.headers['x-request-id'] as string;
  assert.ok(responseReqId.length > 0, 'should generate a non-empty ID');
  assert.match(responseReqId, /^[0-9a-f]{8}-/);
  await app.close();
});

test('request.id is accessible in POST handler', async () => {
  const app = buildApp();
  app.post('/action', async (request) => {
    return { captured: request.id };
  });

  const res = await app.inject({
    method: 'POST',
    url: '/action',
    headers: { 'x-request-id': 'trace-abc-456' },
    payload: { action: 'test' },
  });

  const body = JSON.parse(res.body);
  assert.strictEqual(body.captured, 'trace-abc-456');
  assert.strictEqual(res.headers['x-request-id'], 'trace-abc-456');
  await app.close();
});

test('genReqId reads header correctly', () => {
  const id1 = genReqId({ headers: { 'x-request-id': 'my-id' } });
  assert.strictEqual(id1, 'my-id');

  const id2 = genReqId({ headers: {} });
  assert.match(id2, /^[0-9a-f]{8}-/);

  const id3 = genReqId({ headers: { 'x-request-id': '' } });
  assert.match(id3, /^[0-9a-f]{8}-/);
});

// ── Runner ──

async function run() {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${t.name}`);
      console.error(`    ${(err as Error).message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

console.log('Request ID Hook Tests');
console.log('─'.repeat(40));
run();
