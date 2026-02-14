/**
 * WS Broadcast Targeting Tests
 *
 * Verifies that broadcastOrderEvent delivers messages only to the correct
 * subscribers based on actor type and order event type.
 *
 * Run: tsx apps/core-api/tests/wsBroadcast.test.ts
 */

import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';
import assert from 'assert';
import {
  initWebSocketServer,
  broadcastOrderEvent,
  closeWebSocketServer,
} from '../src/ws/broadcast.js';

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
      try {
        resolve(JSON.parse(data.toString()));
      } catch {
        resolve(data.toString());
      }
    });
  });
}

function expectNoMessage(ws: WebSocket, waitMs = 400): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, waitMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      const msg = JSON.parse(data.toString());
      // Ignore ping messages from heartbeat
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        // Re-listen
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

test('merchant receives events for their orders', async () => {
  const merchantWs = await connect('merchant', 'merchant-1');
  try {
    broadcastOrderEvent({
      event_type: 'ORDER_ESCROWED',
      order_id: 'order-1',
      status: 'escrowed',
      minimal_status: 'escrowed',
      order_version: 2,
      merchantId: 'merchant-1',
      userId: 'user-1',
    });

    const msg = await waitForMessage(merchantWs);
    assert.strictEqual(msg.type, 'order_event');
    assert.strictEqual(msg.order_id, 'order-1');
    assert.strictEqual(msg.event_type, 'ORDER_ESCROWED');
  } finally {
    closeAll(merchantWs);
  }
});

test('unrelated merchant does NOT receive targeted events', async () => {
  const merchantWs = await connect('merchant', 'merchant-2');
  try {
    broadcastOrderEvent({
      event_type: 'ORDER_PAYMENT_SENT',
      order_id: 'order-1',
      status: 'payment_sent',
      minimal_status: 'payment_sent',
      order_version: 3,
      merchantId: 'merchant-1',
      userId: 'user-1',
    });

    // ORDER_PAYMENT_SENT is not a broadcast event, merchant-2 shouldn't get it
    await expectNoMessage(merchantWs);
  } finally {
    closeAll(merchantWs);
  }
});

test('ALL merchants receive ORDER_CREATED broadcast', async () => {
  const m1 = await connect('merchant', 'merchant-A');
  const m2 = await connect('merchant', 'merchant-B');
  try {
    // Register listeners BEFORE broadcast to avoid race condition
    const p1 = waitForMessage(m1);
    const p2 = waitForMessage(m2);

    broadcastOrderEvent({
      event_type: 'ORDER_CREATED',
      order_id: 'order-99',
      status: 'pending',
      minimal_status: 'open',
      order_version: 1,
      merchantId: 'merchant-A',
      userId: 'user-X',
    });

    const [msg1, msg2] = await Promise.all([p1, p2]);
    assert.strictEqual(msg1.order_id, 'order-99');
    assert.strictEqual(msg2.order_id, 'order-99');
  } finally {
    closeAll(m1, m2);
  }
});

test('ALL merchants receive ORDER_CANCELLED broadcast', async () => {
  const m1 = await connect('merchant', 'merchant-C');
  const m2 = await connect('merchant', 'merchant-D');
  try {
    // Register listeners BEFORE broadcast to avoid race condition
    const p1 = waitForMessage(m1);
    const p2 = waitForMessage(m2);

    broadcastOrderEvent({
      event_type: 'ORDER_CANCELLED',
      order_id: 'order-50',
      status: 'cancelled',
      minimal_status: 'cancelled',
      order_version: 5,
      merchantId: 'merchant-C',
      userId: 'user-Y',
    });

    const [msg1, msg2] = await Promise.all([p1, p2]);
    assert.strictEqual(msg1.event_type, 'ORDER_CANCELLED');
    assert.strictEqual(msg2.event_type, 'ORDER_CANCELLED');
  } finally {
    closeAll(m1, m2);
  }
});

test('user receives events for their orders', async () => {
  const userWs = await connect('user', 'user-1');
  try {
    broadcastOrderEvent({
      event_type: 'ORDER_ESCROWED',
      order_id: 'order-5',
      status: 'escrowed',
      minimal_status: 'escrowed',
      order_version: 3,
      merchantId: 'merchant-1',
      userId: 'user-1',
    });

    const msg = await waitForMessage(userWs);
    assert.strictEqual(msg.order_id, 'order-5');
  } finally {
    closeAll(userWs);
  }
});

test('unrelated user does NOT receive other user events', async () => {
  const otherUserWs = await connect('user', 'user-2');
  try {
    broadcastOrderEvent({
      event_type: 'ORDER_ESCROWED',
      order_id: 'order-5',
      status: 'escrowed',
      minimal_status: 'escrowed',
      order_version: 3,
      merchantId: 'merchant-1',
      userId: 'user-1',
    });

    await expectNoMessage(otherUserWs);
  } finally {
    closeAll(otherUserWs);
  }
});

// ── Runner ──

async function run() {
  // Suppress settlement-core logger during tests
  process.env.LOG_LEVEL = 'silent';

  server = createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as any).port;
      initWebSocketServer(server);
      resolve();
    });
  });

  console.log(`\nWS Broadcast Targeting Tests (port ${port})\n`);

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
    // Small delay between tests for socket cleanup
    await new Promise((r) => setTimeout(r, 100));
  }

  closeWebSocketServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
