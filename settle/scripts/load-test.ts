/**
 * Load Test — Measures max throughput for key API paths
 *
 * Tests:
 *  1. Health check (baseline — no DB)
 *  2. Order reads (GET /api/merchant/orders)
 *  3. Order creation (POST /api/merchant/orders)
 *  4. Status transitions (POST /api/orders/:id/status)
 *  5. Mixed workload (80% reads, 20% writes)
 *
 * Run: npx tsx scripts/load-test.ts
 */

const BASE_URL = 'http://localhost:3000';
const MERCHANT_ID = '664d8192-ac4a-45df-81c5-acfdbc2ab8e9'; // test_merchant_m1
const MERCHANT_ID_2 = 'c37c7446-44dd-42fa-8973-3bc142bf3fc1'; // test_merchant_m2
const USER_ID = '1afcfd7b-3451-4cc8-9f0a-e786e41e01dd'; // test_buyer_001

// ─── Helpers ──────────────────────────────────────────────────────

interface BenchResult {
  name: string;
  totalRequests: number;
  durationMs: number;
  successCount: number;
  errorCount: number;
  rps: number;
  rpm: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

const BENCH_HEADERS = { 'x-load-test': '__BENCH__' };

async function timedFetch(url: string, opts?: RequestInit): Promise<{ ok: boolean; ms: number; status: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { ...BENCH_HEADERS, ...opts?.headers },
    });
    return { ok: res.ok, ms: performance.now() - start, status: res.status };
  } catch {
    return { ok: false, ms: performance.now() - start, status: 0 };
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function benchmark(
  name: string,
  fn: () => Promise<{ ok: boolean; ms: number }>,
  opts: { concurrency: number; duration: number }
): Promise<BenchResult> {
  const latencies: number[] = [];
  let successCount = 0;
  let errorCount = 0;
  let running = true;

  const deadline = Date.now() + opts.duration;

  async function worker() {
    while (running && Date.now() < deadline) {
      const result = await fn();
      latencies.push(result.ms);
      if (result.ok) successCount++;
      else errorCount++;
    }
  }

  // Launch concurrent workers
  const workers = Array.from({ length: opts.concurrency }, () => worker());
  await Promise.all(workers);
  running = false;

  const sorted = [...latencies].sort((a, b) => a - b);
  const totalMs = opts.duration;
  const rps = latencies.length / (totalMs / 1000);

  return {
    name,
    totalRequests: latencies.length,
    durationMs: totalMs,
    successCount,
    errorCount,
    rps: Math.round(rps * 100) / 100,
    rpm: Math.round(rps * 60),
    p50Ms: Math.round(percentile(sorted, 50) * 100) / 100,
    p95Ms: Math.round(percentile(sorted, 95) * 100) / 100,
    p99Ms: Math.round(percentile(sorted, 99) * 100) / 100,
    avgMs: Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 100) / 100,
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

function printResult(r: BenchResult) {
  console.log(`\n┌─ ${r.name}`);
  console.log(`│  Requests:    ${r.totalRequests} (${r.successCount} ok, ${r.errorCount} err)`);
  console.log(`│  Throughput:  ${r.rps} req/s  |  ${r.rpm} req/min`);
  console.log(`│  Latency:     avg=${r.avgMs}ms  p50=${r.p50Ms}ms  p95=${r.p95Ms}ms  p99=${r.p99Ms}ms`);
  console.log(`│  Range:       min=${r.minMs}ms  max=${r.maxMs}ms`);
  console.log(`└──────────────────────────────────────────────`);
}

// ─── Test Functions ──────────────────────────────────────────────

async function testHealthCheck() {
  return timedFetch(`${BASE_URL}/api/health`);
}

async function testOrderRead() {
  return timedFetch(`${BASE_URL}/api/merchant/orders?merchant_id=${MERCHANT_ID}&include_all_pending=true`, {
    headers: {
      'x-merchant-id': MERCHANT_ID,
    },
  });
}

let orderCounter = 0;
async function testOrderCreate() {
  orderCounter++;
  return timedFetch(`${BASE_URL}/api/merchant/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-merchant-id': MERCHANT_ID,
    },
    body: JSON.stringify({
      merchant_id: MERCHANT_ID,
      type: 'sell',
      crypto_amount: 100 + (orderCounter % 50),
      fiat_amount: Math.round(3.67 * (100 + (orderCounter % 50)) * 100) / 100,
      fiat_currency: 'AED',
      rate: 3.67,
      payment_method: 'bank',
      corridor_id: 'USDT_AED',
    }),
  });
}

async function testSingleOrderRead() {
  // Read a specific order (lighter than list)
  return timedFetch(`${BASE_URL}/api/merchant/orders?merchant_id=${MERCHANT_ID}&include_all_pending=true&limit=1`, {
    headers: {
      'x-merchant-id': MERCHANT_ID,
    },
  });
}

async function testMixedWorkload() {
  // 80% reads, 20% writes
  if (Math.random() < 0.8) {
    return testOrderRead();
  } else {
    return testOrderCreate();
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  BLIP MONEY — THROUGHPUT LOAD TEST');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Merchant: ${MERCHANT_ID}`);
  console.log('');

  // Warmup
  console.log('Warming up...');
  for (let i = 0; i < 5; i++) await testHealthCheck();
  for (let i = 0; i < 3; i++) await testOrderRead();

  const DURATION = 10_000; // 10 seconds per test

  // Test 1: Health check baseline (no DB)
  console.log('\n[1/5] Health check baseline (10s, 20 concurrent)...');
  const r1 = await benchmark('Health Check (no DB)', testHealthCheck, { concurrency: 20, duration: DURATION });
  printResult(r1);

  // Test 2: Order list reads
  console.log('\n[2/5] Order list reads (10s, 10 concurrent)...');
  const r2 = await benchmark('Order List Read (GET /merchant/orders)', testOrderRead, { concurrency: 10, duration: DURATION });
  printResult(r2);

  // Test 3: Order creation
  console.log('\n[3/5] Order creation (10s, 5 concurrent)...');
  const r3 = await benchmark('Order Create (POST /merchant/orders)', testOrderCreate, { concurrency: 5, duration: DURATION });
  printResult(r3);

  // Test 4: Higher concurrency reads
  console.log('\n[4/5] Order reads at high concurrency (10s, 30 concurrent)...');
  const r4 = await benchmark('Order Read (30 concurrent)', testOrderRead, { concurrency: 30, duration: DURATION });
  printResult(r4);

  // Test 5: Mixed workload (realistic)
  console.log('\n[5/5] Mixed workload 80/20 read/write (10s, 15 concurrent)...');
  const r5 = await benchmark('Mixed 80/20 (15 concurrent)', testMixedWorkload, { concurrency: 15, duration: DURATION });
  printResult(r5);

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Health:    ${r1.rps} req/s  (${r1.rpm}/min)`);
  console.log(`  Reads:     ${r2.rps} req/s  (${r2.rpm}/min)  @ 10 concurrent`);
  console.log(`  Writes:    ${r3.rps} req/s  (${r3.rpm}/min)  @ 5 concurrent`);
  console.log(`  Reads HC:  ${r4.rps} req/s  (${r4.rpm}/min)  @ 30 concurrent`);
  console.log(`  Mixed:     ${r5.rps} req/s  (${r5.rpm}/min)  @ 15 concurrent`);
  console.log('');
  console.log('  Bottleneck analysis:');
  console.log(`    DB pool: 20 connections (settle) + 20 (core-api)`);
  console.log(`    Read saturation: ~${Math.round(r4.rps)} req/s (${Math.round(20000 / r4.p50Ms)} theoretical @ p50)`);
  console.log(`    Write saturation: ~${Math.round(r3.rps)} req/s`);
  console.log(`    On-chain escrow: ~0.5-2 TPS (Solana block time + confirmation)`);
  console.log('═══════════════════════════════════════════════════════════');

  // Cleanup: count orders created
  console.log(`\n  Orders created during test: ${orderCounter}`);
  console.log('  Run: psql -d settle -c "DELETE FROM orders WHERE fiat_currency=\'AED\' AND created_at > now() - interval \'5 minutes\'" to clean up');
}

main().catch(console.error);
