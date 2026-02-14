#!/usr/bin/env tsx
/**
 * Load Test Runner — Phase 7
 *
 * Tests HTTP throughput, WS broadcast delivery, and outbox drain rate
 * against a running dev-local stack.
 *
 * Prerequisites:
 *   1. bash scripts/dev-local.sh  (running in another terminal)
 *   2. POST /api/test/reset + POST /api/test/seed  (or the script seeds for you)
 *
 * Usage:
 *   tsx scripts/load/run.ts [--rps 50] [--duration 10] [--ws-clients 5]
 */

import { WebSocket } from 'ws';

// ── Config ──

const SETTLE_URL = process.env.SETTLE_URL || 'http://localhost:3000';
const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4010';
const CORE_API_SECRET = process.env.CORE_API_SECRET || '';

function getArg(name: string, defaultVal: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? parseInt(process.argv[idx + 1], 10) : defaultVal;
}

const TARGET_RPS = getArg('rps', 50);
const DURATION_S = getArg('duration', 10);
const WS_CLIENTS = getArg('ws-clients', 5);

// ── Helpers ──

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (CORE_API_SECRET) h['x-core-api-secret'] = CORE_API_SECRET;
  return h;
}

async function jsonPost(url: string, body: unknown): Promise<{ status: number; data: any; latencyMs: number }> {
  const start = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const latencyMs = performance.now() - start;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, latencyMs };
}

async function jsonPatch(url: string, body: unknown): Promise<{ status: number; data: any; latencyMs: number }> {
  const start = performance.now();
  const res = await fetch(url, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const latencyMs = performance.now() - start;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, latencyMs };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Phase A: Seed ──

interface TestData {
  userId: string;
  merchantId: string;
  offerId: string;
  merchant2Id: string;
}

async function seedTestData(): Promise<TestData> {
  console.log('  Resetting test data...');
  await fetch(`${SETTLE_URL}/api/test/reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await sleep(500);

  console.log('  Seeding test data...');
  const res = await fetch(`${SETTLE_URL}/api/test/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: 'full' }),
  });
  const body = await res.json();

  if (!body.success) {
    throw new Error(`Seed failed: ${body.error}`);
  }

  const { users, merchants, offers } = body.data;
  return {
    userId: users[0].id,
    merchantId: merchants[0].id,
    merchant2Id: merchants[1]?.id || merchants[0].id,
    offerId: offers[0].id,
  };
}

// ── Phase B: HTTP Throughput ──

async function runHttpLoadTest(testData: TestData): Promise<{
  totalRequests: number;
  errors: number;
  durationMs: number;
  latencies: number[];
}> {
  const totalRequests = TARGET_RPS * DURATION_S;
  const intervalMs = 1000 / TARGET_RPS;
  const latencies: number[] = [];
  let errors = 0;
  const orderIds: string[] = [];

  console.log(`  Firing ${totalRequests} order create requests at ~${TARGET_RPS} rps...`);
  const start = performance.now();

  // Create orders
  const createPromises: Promise<void>[] = [];
  for (let i = 0; i < totalRequests; i++) {
    const delay = i * intervalMs;
    createPromises.push(
      sleep(delay).then(async () => {
        try {
          const res = await jsonPost(`${CORE_API_URL}/v1/orders`, {
            user_id: testData.userId,
            merchant_id: testData.merchantId,
            offer_id: testData.offerId,
            type: 'buy',
            payment_method: 'bank',
            crypto_amount: 10 + Math.random() * 90,
            fiat_amount: 100,
            rate: 3.67,
            payment_details: { bank_name: 'Load Test Bank' },
          });
          latencies.push(res.latencyMs);
          if (res.status >= 200 && res.status < 300 && res.data?.data?.id) {
            orderIds.push(res.data.data.id);
          } else {
            errors++;
          }
        } catch {
          errors++;
        }
      })
    );
  }

  await Promise.all(createPromises);

  // Transition a subset to accepted (up to 50% of created)
  const toAccept = orderIds.slice(0, Math.min(orderIds.length, Math.floor(totalRequests / 2)));
  console.log(`  Transitioning ${toAccept.length} orders to accepted...`);

  const acceptPromises: Promise<void>[] = [];
  for (let i = 0; i < toAccept.length; i++) {
    const delay = i * intervalMs;
    acceptPromises.push(
      sleep(delay).then(async () => {
        try {
          const res = await jsonPatch(`${CORE_API_URL}/v1/orders/${toAccept[i]}`, {
            status: 'accepted',
            actor_type: 'merchant',
            actor_id: testData.merchantId,
          });
          latencies.push(res.latencyMs);
          if (res.status >= 400) errors++;
        } catch {
          errors++;
        }
      })
    );
  }

  await Promise.all(acceptPromises);
  const durationMs = performance.now() - start;

  return { totalRequests: latencies.length, errors, durationMs, latencies: latencies.sort((a, b) => a - b) };
}

// ── Phase C: WS Broadcast ──

async function runWsBroadcastTest(testData: TestData): Promise<{
  clients: number;
  totalMessages: number;
  avgLatencyMs: number;
}> {
  const wsUrl = `ws://localhost:4010/ws/orders`;
  const clients: WebSocket[] = [];
  let totalMessages = 0;
  const msgTimestamps: number[] = [];

  // Connect WS clients
  console.log(`  Connecting ${WS_CLIENTS} WS clients...`);
  for (let i = 0; i < WS_CLIENTS; i++) {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'subscribe', actorType: 'merchant', actorId: `load-merchant-${i}` }));
        ws.once('message', () => {
          clearTimeout(timer);
          clients.push(ws);
          resolve();
        });
      });
      ws.on('error', () => {
        clearTimeout(timer);
        reject(new Error('WS connect error'));
      });
    });
  }

  // Also subscribe one client as the actual merchant
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(wsUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe', actorType: 'merchant', actorId: testData.merchantId }));
      ws.once('message', () => {
        clients.push(ws);
        resolve();
      });
    });
  });

  // Listen for messages on all clients
  for (const ws of clients) {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'order_event') {
          totalMessages++;
          msgTimestamps.push(performance.now());
        }
      } catch { /* ignore */ }
    });
  }

  // Create some orders to trigger broadcasts
  const broadcastOrders = 20;
  console.log(`  Creating ${broadcastOrders} orders to trigger broadcasts...`);
  const broadcastStart = performance.now();

  for (let i = 0; i < broadcastOrders; i++) {
    await jsonPost(`${CORE_API_URL}/v1/orders`, {
      user_id: testData.userId,
      merchant_id: testData.merchantId,
      offer_id: testData.offerId,
      type: 'buy',
      payment_method: 'bank',
      crypto_amount: 10 + Math.random() * 90,
      fiat_amount: 100,
      rate: 3.67,
      payment_details: { bank_name: 'WS Test Bank' },
    });
  }

  // Wait for messages to arrive
  await sleep(2000);
  const broadcastEnd = performance.now();

  // Cleanup
  for (const ws of clients) ws.close();

  const avgLatencyMs = msgTimestamps.length > 0
    ? (broadcastEnd - broadcastStart) / msgTimestamps.length * 1000
    : 0;

  return {
    clients: WS_CLIENTS + 1,
    totalMessages,
    avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
  };
}

// ── Phase D: Outbox Drain ──

async function runOutboxDrainTest(): Promise<{
  pendingBefore: number;
  drainTimeMs: number;
  drainRate: number;
}> {
  // Check current outbox state
  const res = await fetch(`${CORE_API_URL}/debug/outbox?status=pending&limit=1`, { headers: headers() });
  const outboxData = await res.json();
  const pendingBefore = outboxData.counts?.pending || 0;

  if (pendingBefore === 0) {
    return { pendingBefore: 0, drainTimeMs: 0, drainRate: 0 };
  }

  console.log(`  Waiting for ${pendingBefore} outbox rows to drain...`);
  const start = performance.now();
  const maxWaitMs = 60000;

  while (performance.now() - start < maxWaitMs) {
    await sleep(1000);
    const check = await fetch(`${CORE_API_URL}/debug/outbox?status=pending&limit=1`, { headers: headers() });
    const data = await check.json();
    const remaining = data.counts?.pending || 0;
    if (remaining === 0) break;
  }

  const drainTimeMs = performance.now() - start;
  const drainRate = pendingBefore / (drainTimeMs / 1000);

  return {
    pendingBefore,
    drainTimeMs: Math.round(drainTimeMs),
    drainRate: Math.round(drainRate * 10) / 10,
  };
}

// ── Main ──

async function main() {
  console.log('\n=== Load Test ===');
  console.log(`Target: ${TARGET_RPS} rps, ${DURATION_S}s duration, ${WS_CLIENTS} WS clients`);
  console.log(`Core API: ${CORE_API_URL}`);
  console.log(`Settle:   ${SETTLE_URL}\n`);

  // Health check
  try {
    const health = await fetch(`${CORE_API_URL}/health`);
    if (!health.ok) throw new Error(`Core API unhealthy: ${health.status}`);
  } catch (err: any) {
    console.error(`Core API not reachable at ${CORE_API_URL}: ${err.message}`);
    console.error('Start with: bash scripts/dev-local.sh');
    process.exit(1);
  }

  // Seed
  console.log('[1/4] Seeding test data...');
  let testData: TestData;
  try {
    testData = await seedTestData();
    console.log(`  user=${testData.userId.slice(0, 8)}  merchant=${testData.merchantId.slice(0, 8)}  offer=${testData.offerId.slice(0, 8)}\n`);
  } catch (err: any) {
    console.error(`Seed failed: ${err.message}`);
    process.exit(1);
  }

  // HTTP load
  console.log('[2/4] HTTP throughput test...');
  const http = await runHttpLoadTest(testData);
  console.log();

  // WS broadcast
  console.log('[3/4] WS broadcast test...');
  const ws = await runWsBroadcastTest(testData);
  console.log();

  // Outbox drain
  console.log('[4/4] Outbox drain test...');
  const outbox = await runOutboxDrainTest();
  console.log();

  // Report
  const rps = Math.round((http.totalRequests / (http.durationMs / 1000)) * 10) / 10;
  console.log('=== Load Test Results ===');
  console.log(`HTTP:   ${http.totalRequests} reqs, ${http.errors} errors, ${rps} rps, p50=${Math.round(percentile(http.latencies, 50))}ms, p95=${Math.round(percentile(http.latencies, 95))}ms`);
  console.log(`WS:     ${ws.clients} clients, ${ws.totalMessages} msgs received`);
  console.log(`Outbox: ${outbox.pendingBefore} rows drained in ${(outbox.drainTimeMs / 1000).toFixed(1)}s (${outbox.drainRate} rows/sec)`);
  console.log();

  process.exit(http.errors > http.totalRequests * 0.1 ? 1 : 0);
}

main().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
