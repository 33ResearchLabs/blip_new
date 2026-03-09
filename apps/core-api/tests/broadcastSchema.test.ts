/**
 * WS Broadcast Schema Validation Tests (LOCK #5)
 *
 * Verifies that broadcastOrderEvent validates payloads with Zod schemas
 * and blocks invalid payloads for the 5 critical events.
 *
 * Run: npx tsx apps/core-api/tests/broadcastSchema.test.ts
 */

import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';
import assert from 'assert';
import {
  initWebSocketServer,
  broadcastOrderEvent,
  closeWebSocketServer,
} from '../src/ws/broadcast.js';
import { SCHEMA_VERSION } from 'settlement-core';

let server: Server;
let port: number;
let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

// ── Helpers ──

function connect(actorType: string, actorId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/orders`);
    const timer = setTimeout(() => reject(new Error('Connect timeout')), 3000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', actorType, actorId }));
      ws.once('message', () => {
        clearTimeout(timer);
        resolve(ws);
      });
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(data.toString())); } catch { resolve(data.toString()); }
    });
  });
}

function expectNoMessage(ws: WebSocket, waitMs = 400): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, waitMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        const timer2 = setTimeout(resolve, waitMs);
        ws.once('message', (data2) => {
          clearTimeout(timer2);
          reject(new Error(`Unexpected message: ${data2.toString()}`));
        });
        return;
      }
      reject(new Error(`Unexpected message: ${data.toString()}`));
    });
  });
}

function closeAll(...sockets: WebSocket[]) {
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
}

// ── Test Cases ──

test('valid ORDER_CREATED payload broadcasts successfully', async () => {
  const ws = await connect('merchant', 'merchant-schema-1');
  try {
    const msgP = waitForMessage(ws);
    broadcastOrderEvent({
      event_type: 'ORDER_CREATED',
      order_id: 'order-schema-1',
      status: 'pending',
      minimal_status: 'open',
      order_version: 1,
      merchantId: 'merchant-schema-1',
      userId: 'user-schema-1',
    });
    const msg = await msgP;
    assert.strictEqual(msg.event_type, 'ORDER_CREATED');
    assert.strictEqual(msg.order_id, 'order-schema-1');
  } finally {
    closeAll(ws);
  }
});

test('schema_version is present in broadcast messages', async () => {
  const ws = await connect('merchant', 'merchant-schema-2');
  try {
    const msgP = waitForMessage(ws);
    broadcastOrderEvent({
      event_type: 'ORDER_CREATED',
      order_id: 'order-schema-2',
      status: 'pending',
      minimal_status: 'open',
      order_version: 1,
      merchantId: 'merchant-schema-2',
    });
    const msg = await msgP;
    assert.strictEqual(msg.schema_version, SCHEMA_VERSION, `Expected schema_version=${SCHEMA_VERSION}`);
  } finally {
    closeAll(ws);
  }
});

test('missing order_id blocks validated event', async () => {
  const ws = await connect('merchant', 'merchant-schema-3');
  try {
    broadcastOrderEvent({
      event_type: 'ORDER_CREATED',
      order_id: '',  // empty = invalid (min(1))
      status: 'pending',
      minimal_status: 'open',
      order_version: 1,
      merchantId: 'merchant-schema-3',
    });
    await expectNoMessage(ws);
  } finally {
    closeAll(ws);
  }
});

test('missing order_version blocks validated event', async () => {
  const ws = await connect('merchant', 'merchant-schema-4');
  try {
    broadcastOrderEvent({
      event_type: 'ORDER_ESCROWED',
      order_id: 'order-schema-4',
      status: 'escrowed',
      minimal_status: 'escrowed',
      order_version: undefined as any,  // missing
      merchantId: 'merchant-schema-4',
    });
    await expectNoMessage(ws);
  } finally {
    closeAll(ws);
  }
});

test('non-validated event (ORDER_ACCEPTED) passes through', async () => {
  const ws = await connect('merchant', 'merchant-schema-5');
  try {
    const msgP = waitForMessage(ws);
    broadcastOrderEvent({
      event_type: 'ORDER_ACCEPTED',  // not in the validated 5
      order_id: 'order-schema-5',
      status: 'accepted',
      minimal_status: 'active',
      order_version: 2,
      merchantId: 'merchant-schema-5',
    });
    const msg = await msgP;
    assert.strictEqual(msg.event_type, 'ORDER_ACCEPTED');
    assert.strictEqual(msg.schema_version, SCHEMA_VERSION);
  } finally {
    closeAll(ws);
  }
});

test('valid ORDER_ESCROWED payload broadcasts successfully', async () => {
  const ws = await connect('merchant', 'merchant-schema-6');
  try {
    const msgP = waitForMessage(ws);
    broadcastOrderEvent({
      event_type: 'ORDER_ESCROWED',
      order_id: 'order-schema-6',
      status: 'escrowed',
      minimal_status: 'escrowed',
      order_version: 2,
      merchantId: 'merchant-schema-6',
      userId: 'user-schema-6',
    });
    const msg = await msgP;
    assert.strictEqual(msg.event_type, 'ORDER_ESCROWED');
  } finally {
    closeAll(ws);
  }
});

test('valid ORDER_PAYMENT_SENT payload broadcasts successfully', async () => {
  const ws = await connect('merchant', 'merchant-schema-7');
  try {
    const msgP = waitForMessage(ws);
    broadcastOrderEvent({
      event_type: 'ORDER_PAYMENT_SENT',
      order_id: 'order-schema-7',
      status: 'payment_sent',
      minimal_status: 'payment_sent',
      order_version: 3,
      merchantId: 'merchant-schema-7',
      userId: 'user-schema-7',
    });
    const msg = await msgP;
    assert.strictEqual(msg.event_type, 'ORDER_PAYMENT_SENT');
  } finally {
    closeAll(ws);
  }
});

test('valid ORDER_COMPLETED payload broadcasts successfully', async () => {
  const ws = await connect('merchant', 'merchant-schema-8');
  try {
    const msgP = waitForMessage(ws);
    broadcastOrderEvent({
      event_type: 'ORDER_COMPLETED',
      order_id: 'order-schema-8',
      status: 'completed',
      minimal_status: 'completed',
      order_version: 5,
      merchantId: 'merchant-schema-8',
      userId: 'user-schema-8',
    });
    const msg = await msgP;
    assert.strictEqual(msg.event_type, 'ORDER_COMPLETED');
  } finally {
    closeAll(ws);
  }
});

test('valid ORDER_DISPUTED payload broadcasts successfully', async () => {
  const ws = await connect('merchant', 'merchant-schema-9');
  try {
    const msgP = waitForMessage(ws);
    broadcastOrderEvent({
      event_type: 'ORDER_DISPUTED',
      order_id: 'order-schema-9',
      status: 'disputed',
      minimal_status: 'disputed',
      order_version: 4,
      merchantId: 'merchant-schema-9',
      userId: 'user-schema-9',
    });
    const msg = await msgP;
    assert.strictEqual(msg.event_type, 'ORDER_DISPUTED');
  } finally {
    closeAll(ws);
  }
});

test('empty status blocks validated event', async () => {
  const ws = await connect('merchant', 'merchant-schema-10');
  try {
    broadcastOrderEvent({
      event_type: 'ORDER_COMPLETED',
      order_id: 'order-schema-10',
      status: '',  // empty = invalid
      minimal_status: 'completed',
      order_version: 5,
      merchantId: 'merchant-schema-10',
    });
    await expectNoMessage(ws);
  } finally {
    closeAll(ws);
  }
});

// ── Runner ──

async function run() {
  process.env.LOG_LEVEL = 'silent';

  server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      initWebSocketServer(server);
      resolve();
    });
  });

  console.log(`\nWS Broadcast Schema Validation Tests (port ${port})\n`);

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err: any) {
      failed++;
      console.log(`  ✗ ${t.name}`);
      console.log(`    ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  closeWebSocketServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
