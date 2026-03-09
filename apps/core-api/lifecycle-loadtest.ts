/**
 * Full Lifecycle Load Test for Core API
 *
 * Simulates complete order transactions end-to-end:
 *   create → accept → escrow → payment_sent → release(complete)
 *
 * payment_confirmed is transient — release goes directly from payment_sent.
 * Each lifecycle = 5 sequential HTTP calls. Many lifecycles run concurrently.
 * Ramps through increasing lifecycles/sec to find the breaking point.
 *
 * Usage:
 *   npx tsx lifecycle-loadtest.ts
 *   CLUSTER_SIZE=4 npx tsx lifecycle-loadtest.ts   # if running 4 workers
 */
import { execSync } from 'child_process';

const BASE_PORT = parseInt(process.env.CORE_API_PORT || '4010', 10);
const NUM_WORKERS = parseInt(process.env.CLUSTER_SIZE || '8', 10);
const PORTS = Array.from({ length: NUM_WORKERS }, (_, i) => BASE_PORT + i);
let rrIndex = 0;
function nextUrl(): string {
  const port = PORTS[rrIndex % PORTS.length];
  rrIndex++;
  return `http://localhost:${port}`;
}

// 20 test merchants — each has their own balance row = less row lock contention
const TEST_MERCHANTS = [
  { id: 'a0000001-0000-0000-0000-000000000000', offerId: 'b0000001-0000-0000-0000-000000000000' },
  { id: 'a0000002-0000-0000-0000-000000000000', offerId: 'b0000003-0000-0000-0000-000000000000' },
  { id: 'a0000003-0000-0000-0000-000000000000', offerId: 'b0000005-0000-0000-0000-000000000000' },
  { id: 'a0000004-0000-0000-0000-000000000000', offerId: 'b0000007-0000-0000-0000-000000000000' },
  { id: 'a0000005-0000-0000-0000-000000000000', offerId: 'b0000009-0000-0000-0000-000000000000' },
  { id: 'a0000006-0000-0000-0000-000000000000', offerId: 'b0000011-0000-0000-0000-000000000000' },
  { id: 'a0000007-0000-0000-0000-000000000000', offerId: 'b0000013-0000-0000-0000-000000000000' },
  { id: 'a0000008-0000-0000-0000-000000000000', offerId: 'b0000015-0000-0000-0000-000000000000' },
  { id: 'a0000009-0000-0000-0000-000000000000', offerId: 'b0000017-0000-0000-0000-000000000000' },
  { id: 'a000000a-0000-0000-0000-000000000000', offerId: 'b0000019-0000-0000-0000-000000000000' },
  { id: 'a000000b-0000-0000-0000-000000000000', offerId: 'b0000021-0000-0000-0000-000000000000' },
  { id: 'a000000c-0000-0000-0000-000000000000', offerId: 'b0000023-0000-0000-0000-000000000000' },
  { id: 'a000000d-0000-0000-0000-000000000000', offerId: 'b0000025-0000-0000-0000-000000000000' },
  { id: 'a000000e-0000-0000-0000-000000000000', offerId: 'b0000027-0000-0000-0000-000000000000' },
  { id: 'a000000f-0000-0000-0000-000000000000', offerId: 'b0000029-0000-0000-0000-000000000000' },
  { id: 'a0000010-0000-0000-0000-000000000000', offerId: 'b0000031-0000-0000-0000-000000000000' },
  { id: 'a0000011-0000-0000-0000-000000000000', offerId: 'b0000033-0000-0000-0000-000000000000' },
  { id: 'a0000012-0000-0000-0000-000000000000', offerId: 'b0000035-0000-0000-0000-000000000000' },
  { id: 'a0000013-0000-0000-0000-000000000000', offerId: 'b0000037-0000-0000-0000-000000000000' },
  { id: 'a0000014-0000-0000-0000-000000000000', offerId: 'b0000039-0000-0000-0000-000000000000' },
];
const TEST_USER = 'e0e9d384-1b22-45e4-8a11-41fbcc9a318a';

// Unique fiat amount to identify test orders for cleanup (must be > 0, max 2 decimals)
const TEST_FIAT = 0.37;
const TEST_CRYPTO = 0.1;

// payment_confirmed is transient — release goes directly from payment_sent → completed
const STEPS = ['create', 'accept', 'escrow', 'pay_sent', 'release'] as const;
type Step = (typeof STEPS)[number];

interface StepResult {
  step: Step;
  ok: boolean;
  latencyMs: number;
  status: number;
  error?: string;
}

interface LifecycleResult {
  success: boolean;
  totalMs: number;
  steps: StepResult[];
  failedAt?: Step;
  orderId?: string;
}

async function timedFetch(
  url: string,
  opts?: RequestInit
): Promise<{ ok: boolean; status: number; latencyMs: number; body: any; error?: string }> {
  const start = performance.now();
  try {
    const res = await fetch(url, opts);
    const body = await res.json();
    return { ok: res.ok, status: res.status, latencyMs: performance.now() - start, body };
  } catch (err: unknown) {
    return { ok: false, status: 0, latencyMs: performance.now() - start, body: null, error: (err as Error).message };
  }
}

let lifecycleSeq = 0;

async function runLifecycle(): Promise<LifecycleResult> {
  const seq = lifecycleSeq++;
  const steps: StepResult[] = [];
  const start = performance.now();
  const json = { 'Content-Type': 'application/json' };

  // Round-robin across 10 merchants — each has its own balance row (zero contention)
  const merchant = TEST_MERCHANTS[seq % TEST_MERCHANTS.length];
  const merchantId = merchant.id;
  const offerId = merchant.offerId;

  // Step 1: Create order
  const c = await timedFetch(nextUrl() + '/v1/orders', {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      user_id: TEST_USER,
      merchant_id: merchantId,
      offer_id: offerId,
      type: 'buy',
      payment_method: 'bank',
      crypto_amount: TEST_CRYPTO,
      fiat_amount: TEST_FIAT,
      rate: 3.67,
    }),
  });
  steps.push({ step: 'create', ok: c.ok, latencyMs: c.latencyMs, status: c.status, error: c.error });
  if (!c.ok) return { success: false, totalMs: performance.now() - start, steps, failedAt: 'create' };

  const orderId = c.body.data.id;

  // Step 2: Accept (merchant)
  const a = await timedFetch(nextUrl() + `/v1/orders/${orderId}`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ status: 'accepted', actor_type: 'merchant', actor_id: merchantId }),
  });
  steps.push({ step: 'accept', ok: a.ok, latencyMs: a.latencyMs, status: a.status, error: a.error });
  if (!a.ok) return { success: false, totalMs: performance.now() - start, steps, failedAt: 'accept', orderId };

  // Step 3: Escrow lock (merchant deposits USDC)
  const e = await timedFetch(nextUrl() + `/v1/orders/${orderId}/escrow`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      tx_hash: `mock_lt_${seq}`,
      actor_type: 'merchant',
      actor_id: merchantId,
    }),
  });
  steps.push({ step: 'escrow', ok: e.ok, latencyMs: e.latencyMs, status: e.status, error: e.error });
  if (!e.ok) return { success: false, totalMs: performance.now() - start, steps, failedAt: 'escrow', orderId };

  // Step 4: Payment sent (user sends fiat offchain)
  const ps = await timedFetch(nextUrl() + `/v1/orders/${orderId}`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ status: 'payment_sent', actor_type: 'user', actor_id: TEST_USER }),
  });
  steps.push({ step: 'pay_sent', ok: ps.ok, latencyMs: ps.latencyMs, status: ps.status, error: ps.error });
  if (!ps.ok) return { success: false, totalMs: performance.now() - start, steps, failedAt: 'pay_sent', orderId };

  // Step 5: Release escrow → order completed (skips transient payment_confirmed)
  const r = await timedFetch(nextUrl() + `/v1/orders/${orderId}/events`, {
    method: 'POST',
    headers: { ...json, 'x-actor-type': 'merchant', 'x-actor-id': merchantId },
    body: JSON.stringify({ event_type: 'release', tx_hash: `mock_rel_${seq}` }),
  });
  steps.push({ step: 'release', ok: r.ok, latencyMs: r.latencyMs, status: r.status, error: r.error });
  if (!r.ok) return { success: false, totalMs: performance.now() - start, steps, failedAt: 'release', orderId };

  return { success: true, totalMs: performance.now() - start, steps, orderId };
}

// --- Aggregation ---

interface PhaseResult {
  label: string;
  targetLps: number;
  totalLifecycles: number;
  successCount: number;
  errorCount: number;
  durationMs: number;
  actualLps: number;
  avgTotalMs: number;
  stepLatencies: Record<Step, { avg: number; p50: number; p95: number; p99: number; max: number }>;
  errorsByStep: Record<string, number>;
  errors: Record<string, number>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runPhase(label: string, lps: number, durationSec: number): Promise<PhaseResult> {
  const intervalMs = 1000 / lps;
  const total = lps * durationSec;
  const results: LifecycleResult[] = [];

  const startTime = performance.now();
  const promises: Promise<void>[] = [];

  for (let i = 0; i < total; i++) {
    const delay = i * intervalMs;
    promises.push(
      new Promise<void>((resolve) => {
        setTimeout(async () => {
          const result = await runLifecycle();
          results.push(result);
          resolve();
        }, delay);
      })
    );
  }

  await Promise.all(promises);
  const totalDuration = performance.now() - startTime;

  // Aggregate results
  let successCount = 0;
  let errorCount = 0;
  const stepArrays: Record<Step, number[]> = {
    create: [], accept: [], escrow: [], pay_sent: [], release: [],
  };
  const errorsByStep: Record<string, number> = {};
  const errors: Record<string, number> = {};
  const totalTimes: number[] = [];

  for (const r of results) {
    if (r.success) {
      successCount++;
      totalTimes.push(r.totalMs);
    } else {
      errorCount++;
      const key = r.failedAt || 'unknown';
      errorsByStep[key] = (errorsByStep[key] || 0) + 1;
    }

    for (const s of r.steps) {
      if (s.ok) stepArrays[s.step].push(s.latencyMs);
      if (!s.ok) {
        const errKey = `${s.step}: ${s.error || 'HTTP ' + s.status}`;
        errors[errKey] = (errors[errKey] || 0) + 1;
      }
    }
  }

  const stepLatencies = {} as PhaseResult['stepLatencies'];
  for (const step of STEPS) {
    const arr = stepArrays[step].sort((a, b) => a - b);
    stepLatencies[step] = {
      avg: Math.round(arr.reduce((a, b) => a + b, 0) / (arr.length || 1)),
      p50: Math.round(percentile(arr, 50)),
      p95: Math.round(percentile(arr, 95)),
      p99: Math.round(percentile(arr, 99)),
      max: Math.round(arr[arr.length - 1] || 0),
    };
  }

  return {
    label,
    targetLps: lps,
    totalLifecycles: total,
    successCount,
    errorCount,
    durationMs: Math.round(totalDuration),
    actualLps: Math.round((total / totalDuration) * 1000),
    avgTotalMs: Math.round(totalTimes.reduce((a, b) => a + b, 0) / (totalTimes.length || 1)),
    stepLatencies,
    errorsByStep,
    errors,
  };
}

function printPhaseResult(r: PhaseResult) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  ${r.label}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`  Target:      ${r.targetLps} lifecycles/s`);
  console.log(`  Actual:      ${r.actualLps} lifecycles/s`);
  console.log(`  Total:       ${r.totalLifecycles} lifecycles (${r.totalLifecycles * 5} HTTP calls)`);
  console.log(`  Duration:    ${(r.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Success:     ${r.successCount} | Errors: ${r.errorCount} (${((r.errorCount / r.totalLifecycles) * 100).toFixed(1)}%)`);
  console.log(`  Avg lifecycle: ${r.avgTotalMs}ms (all 5 steps)`);
  console.log(`  HTTP calls/s:  ~${r.actualLps * 5}`);
  console.log(`\n  Per-step latencies (ms):`);
  console.log('  ' + 'Step'.padEnd(16) + 'Avg'.padStart(8) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'Max'.padStart(8));
  console.log('  ' + '-'.repeat(56));
  for (const step of STEPS) {
    const s = r.stepLatencies[step];
    console.log(
      '  ' +
        step.padEnd(16) +
        String(s.avg).padStart(8) +
        String(s.p50).padStart(8) +
        String(s.p95).padStart(8) +
        String(s.p99).padStart(8) +
        String(s.max).padStart(8)
    );
  }

  if (r.errorCount > 0) {
    console.log(`\n  Failures by step:`);
    for (const [step, count] of Object.entries(r.errorsByStep)) {
      console.log(`    ${step}: ${count}`);
    }
    console.log(`  Error details:`);
    for (const [err, count] of Object.entries(r.errors).slice(0, 10)) {
      console.log(`    ${err}: ${count}`);
    }
  }
}

// --- DB Setup ---

function setupDb() {
  try {
    const merchantIds = TEST_MERCHANTS.map((m) => `'${m.id}'`).join(', ');
    const offerIds = TEST_MERCHANTS.map((m) => `'${m.offerId}'`).join(', ');
    execSync(
      `psql -U zeus -d settle -c "UPDATE merchants SET balance = 1000000 WHERE id IN (${merchantIds})" 2>&1`,
      { stdio: 'pipe' }
    );
    execSync(
      `psql -U zeus -d settle -c "UPDATE merchant_offers SET available_amount = 1000000 WHERE id IN (${offerIds})" 2>&1`,
      { stdio: 'pipe' }
    );
    console.log(`  DB setup OK: ${TEST_MERCHANTS.length} merchants x 1M balance, ${TEST_MERCHANTS.length} offers x 1M liquidity`);
  } catch {
    console.error('  DB setup via psql failed. Continuing anyway...');
  }
}

function cleanupDb() {
  try {
    execSync(
      `psql -U zeus -d settle -c "
        DELETE FROM reputation_events WHERE metadata->>'order_id' IN (SELECT id::text FROM orders WHERE fiat_amount = ${TEST_FIAT} AND user_id = '${TEST_USER}');
        DELETE FROM notification_outbox WHERE order_id IN (SELECT id FROM orders WHERE fiat_amount = ${TEST_FIAT} AND user_id = '${TEST_USER}');
        DELETE FROM order_events WHERE order_id IN (SELECT id FROM orders WHERE fiat_amount = ${TEST_FIAT} AND user_id = '${TEST_USER}');
        DELETE FROM orders WHERE fiat_amount = ${TEST_FIAT} AND user_id = '${TEST_USER}';
      " 2>&1`,
      { stdio: 'pipe' }
    );
  } catch {
    // ignore cleanup errors
  }
}

// --- Main ---

async function main() {
  console.log('================================================================');
  console.log('     FULL LIFECYCLE LOAD TEST');
  console.log('     create → accept → escrow → pay_sent → release');
  console.log('================================================================');
  console.log(`Workers: ports ${PORTS[0]}-${PORTS[PORTS.length - 1]} (${PORTS.length} processes)`);

  // Health check all workers
  let alive = 0;
  for (const port of PORTS) {
    const check = await timedFetch(`http://localhost:${port}/health`);
    if (check.ok) alive++;
  }
  if (alive === 0) {
    console.error('No workers reachable! Run: bash apps/core-api/cluster.sh');
    process.exit(1);
  }
  console.log(`${alive}/${PORTS.length} workers healthy\n`);

  // Setup DB
  console.log('Setting up test data...');
  setupDb();

  // Clean any leftover test data
  console.log('  Cleaning previous test orders...');
  cleanupDb();

  // Smoke test: single lifecycle
  console.log('\nSmoke test: single full lifecycle...');
  const smoke = await runLifecycle();
  if (!smoke.success) {
    console.error(`\nSmoke test FAILED at step: ${smoke.failedAt}`);
    for (const s of smoke.steps) {
      const icon = s.ok ? 'OK' : 'FAIL';
      console.log(`  ${s.step.padEnd(16)} ${icon}  ${Math.round(s.latencyMs)}ms  ${s.error || (s.ok ? '' : 'HTTP ' + s.status)}`);
    }
    process.exit(1);
  }
  console.log(`Smoke test OK (${Math.round(smoke.totalMs)}ms total, order: ${smoke.orderId})`);
  for (const s of smoke.steps) {
    console.log(`  ${s.step.padEnd(16)} ${Math.round(s.latencyMs)}ms`);
  }

  const results: PhaseResult[] = [];

  // Phase 1: Warm up — 50/s
  console.log('\n--- PHASE 1: 50 lifecycles/s (250 HTTP/s) ---');
  const r1 = await runPhase('50 lps (250 HTTP/s)', 50, 5);
  printPhaseResult(r1);
  results.push(r1);

  // Phase 2: Medium — 100/s
  console.log('\n--- PHASE 2: 100 lifecycles/s (500 HTTP/s) ---');
  const r2 = await runPhase('100 lps (500 HTTP/s)', 100, 5);
  printPhaseResult(r2);
  results.push(r2);

  if (r2.errorCount > r2.totalLifecycles * 0.1) {
    console.log('\n  >10% errors at 100/s -- stopping ramp');
  } else {
    // Phase 3: High — 500/s
    console.log('\n--- PHASE 3: 500 lifecycles/s (2500 HTTP/s) ---');
    const r3 = await runPhase('500 lps (2.5k HTTP/s)', 500, 3);
    printPhaseResult(r3);
    results.push(r3);

    if (r3.errorCount > r3.totalLifecycles * 0.1) {
      console.log('\n  >10% errors at 500/s -- stopping ramp');
    } else {
      // Phase 4: Very high — 1000/s
      console.log('\n--- PHASE 4: 1000 lifecycles/s (5000 HTTP/s) ---');
      const r4 = await runPhase('1000 lps (5k HTTP/s)', 1000, 3);
      printPhaseResult(r4);
      results.push(r4);
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(105));
  console.log('SUMMARY — Full Order Lifecycle (5 HTTP calls per lifecycle)');
  console.log('='.repeat(105));
  console.log(
    'Phase'.padEnd(24) +
      'Target'.padStart(7) +
      'Actual'.padStart(7) +
      'Total'.padStart(7) +
      'OK'.padStart(6) +
      'Fail'.padStart(6) +
      'Err%'.padStart(7) +
      'AvgMs'.padStart(8) +
      'HTTP/s'.padStart(8) +
      'SQL/s'.padStart(8) +
      '  Status'
  );
  console.log('-'.repeat(105));
  for (const r of results) {
    const errPct = ((r.errorCount / r.totalLifecycles) * 100).toFixed(1);
    const httpPerSec = r.actualLps * 5;
    const sqlPerSec = r.actualLps * 22; // ~22 SQL ops per lifecycle
    let status = 'OK';
    if (parseFloat(errPct) > 5) status = 'FAIL';
    else if (r.actualLps < r.targetLps * 0.8) status = 'SATURATED';

    console.log(
      r.label.padEnd(24) +
        String(r.targetLps).padStart(7) +
        String(r.actualLps).padStart(7) +
        String(r.totalLifecycles).padStart(7) +
        String(r.successCount).padStart(6) +
        String(r.errorCount).padStart(6) +
        (errPct + '%').padStart(7) +
        (r.avgTotalMs + 'ms').padStart(8) +
        String(httpPerSec).padStart(8) +
        ('~' + sqlPerSec).padStart(8) +
        '  ' +
        status
    );
  }
  console.log('='.repeat(105));

  // Per-step breakdown for best phase
  const best = results.filter((r) => r.errorCount <= r.totalLifecycles * 0.05).pop();
  if (best) {
    console.log(`\nBest clean phase step breakdown (${best.label}):`);
    console.log('  ' + 'Step'.padEnd(16) + 'Avg'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'Max'.padStart(8));
    for (const step of STEPS) {
      const s = best.stepLatencies[step];
      console.log(
        '  ' +
          step.padEnd(16) +
          (s.avg + 'ms').padStart(8) +
          (s.p95 + 'ms').padStart(8) +
          (s.p99 + 'ms').padStart(8) +
          (s.max + 'ms').padStart(8)
      );
    }
  }

  console.log(`\nTotal orders created: ${lifecycleSeq}`);
  console.log('Cleaning up test orders...');
  cleanupDb();
  console.log('Done.');
}

main().catch(console.error);
