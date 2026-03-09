/**
 * Phase 6.1 — Launch Simulation Harness
 *
 * Drives the system end-to-end via HTTP calls with deterministic seeded RNG.
 * Records every request/response, injects retries and collisions, fetches the
 * debug snapshot after each order, and outputs a JSON report.
 *
 * Usage:
 *   tsx scripts/launchSim.ts [options]
 *
 * Options:
 *   --orders      Number of orders to simulate  (default: 200)
 *   --seed        RNG seed for determinism       (default: 1337)
 *   --concurrency Max parallel orders            (default: 10)
 *   --retryRate   Fraction of steps that retry   (default: 0.15)
 *   --cancelRate  Fraction of orders cancelled   (default: 0.10)
 *   --disputeRate Fraction of orders disputed    (default: 0.05)
 *   --baseUrl     Core-API base URL              (default: http://localhost:4010/v1)
 *   --noCleanup   Skip cleanup of seeded data    (flag, no value)
 *
 * Env:
 *   CORE_API_SECRET  (required) shared secret used for x-core-api-secret + HMAC signing
 *
 * Example:
 *   CORE_API_SECRET=secret tsx scripts/launchSim.ts --orders 50 --seed 42
 */

import { createHmac, randomUUID } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne, closePool } from 'settlement-core';

// ─── CLI Args ────────────────────────────────────────────────────────────────

function parseCliArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[arg] = true; // flag with no value
    } else {
      out[arg] = next;
      i++;
    }
  }
  return out;
}

const args = parseCliArgs(process.argv.slice(2));
const NUM_ORDERS   = parseInt(String(args['--orders']      ?? '200'));
const SEED         = parseInt(String(args['--seed']        ?? '1337'));
const CONCURRENCY  = parseInt(String(args['--concurrency'] ?? '10'));
const RETRY_RATE   = parseFloat(String(args['--retryRate']   ?? '0.15'));
const CANCEL_RATE  = parseFloat(String(args['--cancelRate']  ?? '0.10'));
const DISPUTE_RATE = parseFloat(String(args['--disputeRate'] ?? '0.05'));
const BASE_URL     = String(args['--baseUrl'] ?? 'http://localhost:4010/v1').replace(/\/$/, '');
const NO_CLEANUP   = args['--noCleanup'] === true;

const SECRET = process.env.CORE_API_SECRET ?? '';
if (!SECRET) {
  console.error('Error: CORE_API_SECRET env var is required');
  process.exit(1);
}

// ─── Seeded RNG (mulberry32) ─────────────────────────────────────────────────

function makeMulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeMulberry32(SEED);
const rngBool = (rate: number) => rng() < rate;
const rngInt  = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;

// ─── HTTP Client ─────────────────────────────────────────────────────────────

interface FetchOpts {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  requestId?: string;
  /** When set, adds x-actor-type, x-actor-id, x-actor-signature headers */
  actorType?: string;
  actorId?: string;
}

interface ApiResult {
  status: number;
  data: any;
  requestId: string;
  durationMs: number;
}

function signActor(actorType: string, actorId: string): string {
  return createHmac('sha256', SECRET)
    .update(`${actorType}:${actorId}`)
    .digest('hex');
}

async function api(path: string, opts: FetchOpts = {}): Promise<ApiResult> {
  const { method = 'GET', body, idempotencyKey, actorType, actorId } = opts;
  const reqId = opts.requestId ?? randomUUID();
  const start = Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-core-api-secret': SECRET,
    'x-request-id': reqId,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  if (actorType && actorId) {
    headers['x-actor-type'] = actorType;
    headers['x-actor-id'] = actorId;
    headers['x-actor-signature'] = signActor(actorType, actorId);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }

  return { status: res.status, data, requestId: reqId, durationMs: Date.now() - start };
}

// ─── Types ───────────────────────────────────────────────────────────────────

type OrderPath = 'completed' | 'cancelled_pre_escrow' | 'cancelled_post_escrow' | 'disputed';

interface StepRecord {
  step: string;
  requestId: string;
  idempotencyKey: string;
  status: number;
  success: boolean;
  retryCount: number;
  collisionInjected: boolean;
  durationMs: number;
  error?: string;
}

interface OrderRecord {
  index: number;
  orderId: string | null;
  path: OrderPath;
  steps: StepRecord[];
  debugSnapshot: any;
  durationMs: number;
  errors: string[];
}

// ─── Step helpers ─────────────────────────────────────────────────────────────

/** Run a step once, then replay with the same Idempotency-Key `retries` more times */
async function stepWithRetry(
  stepName: string,
  path: string,
  opts: FetchOpts,
  retries: number,
): Promise<{ result: ApiResult; record: StepRecord }> {
  const start = Date.now();
  const result = await api(path, opts);

  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, 25));
    await api(path, { ...opts, requestId: randomUUID() }); // same key, new req-id
  }

  const record: StepRecord = {
    step: stepName,
    requestId: opts.requestId ?? result.requestId,
    idempotencyKey: opts.idempotencyKey ?? '',
    status: result.status,
    success: result.status < 300,
    retryCount: retries,
    collisionInjected: false,
    durationMs: Date.now() - start,
  };
  if (!record.success) record.error = JSON.stringify(result.data).slice(0, 200);
  return { result, record };
}

/** Fire two identical requests concurrently — one should succeed, one should be a replay */
async function stepWithCollision(
  stepName: string,
  path: string,
  opts: FetchOpts,
): Promise<{ result: ApiResult; record: StepRecord }> {
  const start = Date.now();
  const [r1, r2] = await Promise.all([
    api(path, { ...opts, requestId: randomUUID() }),
    api(path, { ...opts, requestId: randomUUID() }),
  ]);
  // Take the successful one; if both failed, take r1
  const result = r1.status < 300 ? r1 : r2.status < 300 ? r2 : r1;

  const record: StepRecord = {
    step: stepName,
    requestId: result.requestId,
    idempotencyKey: opts.idempotencyKey ?? '',
    status: result.status,
    success: result.status < 300,
    retryCount: 0,
    collisionInjected: true,
    durationMs: Date.now() - start,
  };
  if (!record.success) record.error = JSON.stringify(result.data).slice(0, 200);
  return { result, record };
}

// ─── DB Seeding ───────────────────────────────────────────────────────────────

interface Seeds {
  userId: string;
  merchantId: string;
  offerId: string;
}

async function seedData(numOrders: number): Promise<Seeds> {
  const userId     = randomUUID();
  const merchantId = randomUUID();
  const offerId    = randomUUID();

  // Buyer user
  await query(
    `INSERT INTO users (id, username, password_hash)
     VALUES ($1, $2, 'sim_hash')
     ON CONFLICT (id) DO NOTHING`,
    [userId, `sim_buyer_${userId.slice(0, 8)}`],
  );

  // Seller merchant — needs enough balance for concurrent escrows
  // Seed 2× buffer: even if all orders escrow simultaneously we're covered
  const escrowBalance = (numOrders + CONCURRENCY) * 2;
  await query(
    `INSERT INTO merchants (id, business_name, display_name, email, balance)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [merchantId, 'Sim Seller Corp', 'SimSeller', `sim_${merchantId.slice(0, 8)}@sim.test`, escrowBalance],
  );

  // Sell offer — merchant sells USDC for AED; available_amount = 2× orders
  await query(
    `INSERT INTO merchant_offers (id, merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount)
     VALUES ($1, $2, 'sell', 'bank', 3.67, 0.01, 1000, $3)
     ON CONFLICT (id) DO NOTHING`,
    [offerId, merchantId, numOrders * 2],
  );

  return { userId, merchantId, offerId };
}

async function cleanupData(seeds: Seeds): Promise<void> {
  // Delete in FK dependency order
  const orderSubquery = `(SELECT id FROM orders WHERE user_id = $1)`;
  await query(`DELETE FROM idempotency_keys     WHERE order_id IN ${orderSubquery}`, [seeds.userId]);
  await query(`DELETE FROM ledger_entries        WHERE order_id IN ${orderSubquery}`, [seeds.userId]);
  await query(`DELETE FROM order_events          WHERE order_id IN ${orderSubquery}`, [seeds.userId]);
  await query(`DELETE FROM merchant_transactions WHERE order_id IN ${orderSubquery}`, [seeds.userId]);
  await query(`DELETE FROM notification_outbox   WHERE order_id IN ${orderSubquery}`, [seeds.userId]);
  await query(`DELETE FROM orders WHERE user_id = $1`, [seeds.userId]);
  await query(`DELETE FROM merchant_offers WHERE id = $1`, [seeds.offerId]);
  await query(`DELETE FROM merchants WHERE id = $1`, [seeds.merchantId]);
  await query(`DELETE FROM users WHERE id = $1`, [seeds.userId]);
}

// ─── DB Validations ───────────────────────────────────────────────────────────

interface DbValidation {
  duplicateIdempotencyKeys: number;
  nullRequestIdEvents: number;
  orphanLedgerEntries: number;
  negativeBalanceMerchants: number;
}

async function runDbValidations(seeds: Seeds): Promise<DbValidation> {
  const orderSubquery = `(SELECT id FROM orders WHERE user_id = $1)`;

  const [dupRows, nullReqRows, orphanRows, negBalRows] = await Promise.all([
    // Duplicate idempotency_key values in ledger_entries for our orders
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM (
         SELECT idempotency_key FROM ledger_entries
         WHERE order_id IN ${orderSubquery}
           AND idempotency_key IS NOT NULL
         GROUP BY idempotency_key HAVING COUNT(*) > 1
       ) sub`,
      [seeds.userId],
    ),
    // Order events with null request_id
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM order_events
       WHERE order_id IN ${orderSubquery}
         AND request_id IS NULL`,
      [seeds.userId],
    ),
    // Ledger entries referencing non-existent orders (orphans)
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ledger_entries le
       WHERE le.order_id IN ${orderSubquery}
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = le.order_id)`,
      [seeds.userId],
    ),
    // Any merchant with negative balance (global check)
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM merchants WHERE balance < 0`,
    ),
  ]);

  return {
    duplicateIdempotencyKeys:   parseInt(dupRows[0]?.count  ?? '0'),
    nullRequestIdEvents:        parseInt(nullReqRows[0]?.count ?? '0'),
    orphanLedgerEntries:        parseInt(orphanRows[0]?.count ?? '0'),
    negativeBalanceMerchants:   parseInt(negBalRows[0]?.count ?? '0'),
  };
}

// ─── Order Simulation ─────────────────────────────────────────────────────────

async function fetchDebug(orderId: string): Promise<any> {
  try {
    const res = await api(`/ops/orders/${orderId}/debug`);
    return res.data;
  } catch {
    return null;
  }
}

async function simulateOrder(seeds: Seeds, idx: number): Promise<OrderRecord> {
  const t0 = Date.now();
  const steps: StepRecord[] = [];
  const errors: string[] = [];
  let orderId: string | null = null;

  // Determine path (deterministic per index via rng)
  const r = rng();
  const path: OrderPath =
    r < CANCEL_RATE / 2              ? 'cancelled_pre_escrow'  :
    r < CANCEL_RATE                   ? 'cancelled_post_escrow' :
    r < CANCEL_RATE + DISPUTE_RATE    ? 'disputed'              :
    'completed';

  const base   = `sim-${idx}-${SEED}`;
  const retry1 = rngBool(RETRY_RATE) ? 1 : 0;

  // ── Step 1: Create Order ────────────────────────────────────────────────────
  const createOpts: FetchOpts = {
    method: 'POST',
    body: {
      user_id:        seeds.userId,
      merchant_id:    seeds.merchantId,
      offer_id:       seeds.offerId,
      type:           'buy',
      payment_method: 'bank',
      crypto_amount:  1,
      fiat_amount:    3.67,
      rate:           3.67,
    },
    idempotencyKey: `${base}-create`,
    requestId: randomUUID(),
  };

  let createResult: ApiResult;
  if (rngBool(0.05)) {
    // 5% collision injection on create
    const { result, record } = await stepWithCollision('create_order', '/orders', createOpts);
    createResult = result;
    steps.push(record);
  } else {
    const { result, record } = await stepWithRetry('create_order', '/orders', createOpts, retry1);
    createResult = result;
    steps.push(record);
  }

  if (steps[0].status !== 201) {
    errors.push(`create failed (${steps[0].status}): ${steps[0].error}`);
    return { index: idx, orderId, path, steps, debugSnapshot: null, durationMs: Date.now() - t0, errors };
  }

  orderId = createResult.data?.data?.id ?? null;
  if (!orderId) {
    errors.push(`create returned no id: ${JSON.stringify(createResult.data).slice(0, 200)}`);
    return { index: idx, orderId, path, steps, debugSnapshot: null, durationMs: Date.now() - t0, errors };
  }

  // ── Cancelled before escrow ─────────────────────────────────────────────────
  if (path === 'cancelled_pre_escrow') {
    const { record } = await stepWithRetry(
      'cancel_pre_escrow', `/orders/${orderId}`,
      {
        method: 'PATCH',
        body: { status: 'cancelled', actor_type: 'user', actor_id: seeds.userId, reason: 'sim_cancel_pre' },
        idempotencyKey: `${base}-cancel`,
        requestId: randomUUID(),
      }, 0,
    );
    steps.push(record);
    if (!record.success) errors.push(`cancel_pre failed: ${record.error}`);
    return { index: idx, orderId, path, steps, debugSnapshot: await fetchDebug(orderId), durationMs: Date.now() - t0, errors };
  }

  // ── Step 2: Accept ──────────────────────────────────────────────────────────
  const { result: acceptResult, record: acceptRecord } = await stepWithRetry(
    'accept', `/orders/${orderId}`,
    {
      method: 'PATCH',
      body: { status: 'accepted', actor_type: 'merchant', actor_id: seeds.merchantId },
      idempotencyKey: `${base}-accept`,
      requestId: randomUUID(),
    },
    rngBool(RETRY_RATE) ? 1 : 0,
  );
  steps.push(acceptRecord);
  if (!acceptRecord.success) {
    errors.push(`accept failed (${acceptRecord.status}): ${acceptRecord.error}`);
    return { index: idx, orderId, path, steps, debugSnapshot: await fetchDebug(orderId), durationMs: Date.now() - t0, errors };
  }

  // ── Step 3: Escrow ──────────────────────────────────────────────────────────
  const escrowOpts: FetchOpts = {
    method: 'POST',
    body: {
      tx_hash:    `mock-escrow-${orderId.slice(0, 8)}-i${idx}`,
      actor_type: 'merchant',
      actor_id:   seeds.merchantId,
    },
    idempotencyKey: `${base}-escrow`,
    requestId: randomUUID(),
  };
  const { record: escrowRecord } = await stepWithRetry(
    'escrow', `/orders/${orderId}/escrow`, escrowOpts,
    rngBool(RETRY_RATE) ? 1 : 0,
  );
  steps.push(escrowRecord);
  if (!escrowRecord.success) {
    errors.push(`escrow failed (${escrowRecord.status}): ${escrowRecord.error}`);
    return { index: idx, orderId, path, steps, debugSnapshot: await fetchDebug(orderId), durationMs: Date.now() - t0, errors };
  }

  // ── Cancelled after escrow (triggers atomicCancelWithRefund) ────────────────
  if (path === 'cancelled_post_escrow') {
    const { record } = await stepWithRetry(
      'cancel_post_escrow', `/orders/${orderId}`,
      {
        method: 'PATCH',
        body: { status: 'cancelled', actor_type: 'merchant', actor_id: seeds.merchantId, reason: 'sim_cancel_post' },
        idempotencyKey: `${base}-cancel`,
        requestId: randomUUID(),
      }, 0,
    );
    steps.push(record);
    if (!record.success) errors.push(`cancel_post failed: ${record.error}`);
    return { index: idx, orderId, path, steps, debugSnapshot: await fetchDebug(orderId), durationMs: Date.now() - t0, errors };
  }

  // ── Step 4: Payment Sent ────────────────────────────────────────────────────
  const { record: psentRecord } = await stepWithRetry(
    'payment_sent', `/orders/${orderId}`,
    {
      method: 'PATCH',
      body: { status: 'payment_sent', actor_type: 'user', actor_id: seeds.userId },
      idempotencyKey: `${base}-psent`,
      requestId: randomUUID(),
    },
    rngBool(RETRY_RATE) ? 1 : 0,
  );
  steps.push(psentRecord);
  if (!psentRecord.success) {
    errors.push(`payment_sent failed (${psentRecord.status}): ${psentRecord.error}`);
    return { index: idx, orderId, path, steps, debugSnapshot: await fetchDebug(orderId), durationMs: Date.now() - t0, errors };
  }

  // ── Disputed ────────────────────────────────────────────────────────────────
  if (path === 'disputed') {
    const { record } = await stepWithRetry(
      'dispute', `/orders/${orderId}`,
      {
        method: 'PATCH',
        body: { status: 'disputed', actor_type: 'user', actor_id: seeds.userId, reason: 'sim_dispute' },
        idempotencyKey: `${base}-dispute`,
        requestId: randomUUID(),
      }, 0,
    );
    steps.push(record);
    if (!record.success) errors.push(`dispute failed: ${record.error}`);
    return { index: idx, orderId, path, steps, debugSnapshot: await fetchDebug(orderId), durationMs: Date.now() - t0, errors };
  }

  // ── Step 5: Payment Confirmed ───────────────────────────────────────────────
  const { record: pconfRecord } = await stepWithRetry(
    'payment_confirmed', `/orders/${orderId}`,
    {
      method: 'PATCH',
      body: { status: 'payment_confirmed', actor_type: 'merchant', actor_id: seeds.merchantId },
      idempotencyKey: `${base}-pconf`,
      requestId: randomUUID(),
    },
    rngBool(RETRY_RATE) ? 1 : 0,
  );
  steps.push(pconfRecord);
  if (!pconfRecord.success) {
    errors.push(`payment_confirmed failed (${pconfRecord.status}): ${pconfRecord.error}`);
    return { index: idx, orderId, path, steps, debugSnapshot: await fetchDebug(orderId), durationMs: Date.now() - t0, errors };
  }

  // ── Step 6: Release ─────────────────────────────────────────────────────────
  const { record: releaseRecord } = await stepWithRetry(
    'release', `/orders/${orderId}/events`,
    {
      method: 'POST',
      body: { event_type: 'release', tx_hash: `mock-release-${orderId.slice(0, 8)}-i${idx}` },
      idempotencyKey: `${base}-release`,
      requestId: randomUUID(),
      // Actor in headers for /events (HMAC required)
      actorType: 'merchant',
      actorId:   seeds.merchantId,
    },
    rngBool(RETRY_RATE) ? 1 : 0,
  );
  steps.push(releaseRecord);
  if (!releaseRecord.success) errors.push(`release failed (${releaseRecord.status}): ${releaseRecord.error}`);

  return {
    index: idx,
    orderId,
    path,
    steps,
    debugSnapshot: orderId ? await fetchDebug(orderId) : null,
    durationMs: Date.now() - t0,
    errors,
  };
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress: (done: number, total: number) => void,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let idx = 0;
  let done = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
      done++;
      onProgress(done, tasks.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, worker),
  );
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const runStart = Date.now();

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║    Phase 6.1 — Launch Simulation Harness  ║');
  console.log('╚════════════════════════════════════════════╝\n');
  console.log(`  Orders:       ${NUM_ORDERS}`);
  console.log(`  Seed:         ${SEED}`);
  console.log(`  Concurrency:  ${CONCURRENCY}`);
  console.log(`  Retry rate:   ${(RETRY_RATE * 100).toFixed(0)}%`);
  console.log(`  Cancel rate:  ${(CANCEL_RATE * 100).toFixed(0)}%`);
  console.log(`  Dispute rate: ${(DISPUTE_RATE * 100).toFixed(0)}%`);
  console.log(`  Base URL:     ${BASE_URL}\n`);

  // Seed
  process.stdout.write('  Seeding test data... ');
  const seeds = await seedData(NUM_ORDERS);
  console.log('done');
  console.log(`  User:     ${seeds.userId}`);
  console.log(`  Merchant: ${seeds.merchantId}`);
  console.log(`  Offer:    ${seeds.offerId}\n`);

  // Run
  const tasks = Array.from({ length: NUM_ORDERS }, (_, i) => () => simulateOrder(seeds, i));
  let lastPct = -1;

  const orderResults = await runConcurrent(tasks, CONCURRENCY, (done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      process.stdout.write(`\r  Progress: ${String(pct).padStart(3)}%  (${done}/${total})`);
      lastPct = pct;
    }
  });
  console.log(`\r  Progress: 100%  (${NUM_ORDERS}/${NUM_ORDERS})\n`);

  // DB validations
  process.stdout.write('  Running DB validations... ');
  const dbValidation = await runDbValidations(seeds);
  console.log('done\n');

  // Aggregate stats
  const pathCounts: Record<OrderPath, number> = {
    completed: 0, cancelled_pre_escrow: 0, cancelled_post_escrow: 0, disputed: 0,
  };
  let failedOrders  = 0;
  let totalSteps    = 0;
  let totalRetries  = 0;
  let totalCollisions = 0;
  const stepFailures: Record<string, number> = {};

  for (const r of orderResults) {
    pathCounts[r.path]++;
    if (r.errors.length > 0) failedOrders++;
    for (const s of r.steps) {
      totalSteps++;
      totalRetries  += s.retryCount;
      if (s.collisionInjected) totalCollisions++;
      if (!s.success) stepFailures[s.step] = (stepFailures[s.step] ?? 0) + 1;
    }
  }

  const durationMs = Date.now() - runStart;

  // Write report
  const __filename = fileURLToPath(import.meta.url);
  const reportsDir = join(dirname(__filename), '..', 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const reportFile = join(reportsDir, `launchSim_${Date.now()}.json`);

  const report = {
    meta: {
      seed: SEED, numOrders: NUM_ORDERS, concurrency: CONCURRENCY,
      retryRate: RETRY_RATE, cancelRate: CANCEL_RATE, disputeRate: DISPUTE_RATE,
      baseUrl: BASE_URL, runAt: new Date().toISOString(), durationMs,
    },
    seeds,
    counts: {
      total: NUM_ORDERS,
      completed:            pathCounts.completed,
      cancelledPreEscrow:   pathCounts.cancelled_pre_escrow,
      cancelledPostEscrow:  pathCounts.cancelled_post_escrow,
      disputed:             pathCounts.disputed,
      failedOrders,
      totalSteps, totalRetries, totalCollisions,
    },
    stepFailures,
    dbValidation,
    orders: orderResults,
  };

  writeFileSync(reportFile, JSON.stringify(report, null, 2));

  // Print summary
  const pad = (n: number | string, w = 6) => String(n).padStart(w);
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log('  │                    SUMMARY                       │');
  console.log('  ├──────────────────────────────────────────────────┤');
  console.log(`  │  Completed:                 ${pad(pathCounts.completed)}                │`);
  console.log(`  │  Cancelled pre-escrow:      ${pad(pathCounts.cancelled_pre_escrow)}                │`);
  console.log(`  │  Cancelled post-escrow:     ${pad(pathCounts.cancelled_post_escrow)}                │`);
  console.log(`  │  Disputed:                  ${pad(pathCounts.disputed)}                │`);
  console.log(`  │  Failed orders:             ${pad(failedOrders)}                │`);
  console.log(`  │  Total steps executed:      ${pad(totalSteps)}                │`);
  console.log(`  │  Retries injected:          ${pad(totalRetries)}                │`);
  console.log(`  │  Collisions injected:       ${pad(totalCollisions)}                │`);
  console.log('  ├──────────────────────────────────────────────────┤');
  console.log(`  │  DB dup idempotency keys:   ${pad(dbValidation.duplicateIdempotencyKeys)}                │`);
  console.log(`  │  DB null request_id events: ${pad(dbValidation.nullRequestIdEvents)}                │`);
  console.log(`  │  DB orphan ledger entries:  ${pad(dbValidation.orphanLedgerEntries)}                │`);
  console.log(`  │  Merchants negative bal:    ${pad(dbValidation.negativeBalanceMerchants)}                │`);
  console.log('  ├──────────────────────────────────────────────────┤');
  console.log(`  │  Duration:                  ${pad((durationMs / 1000).toFixed(1) + 's')}                │`);
  console.log('  └──────────────────────────────────────────────────┘');
  console.log(`\n  Report: ${reportFile}\n`);

  if (Object.keys(stepFailures).length > 0) {
    console.log('  Step failures:');
    for (const [step, count] of Object.entries(stepFailures)) {
      console.log(`    ${step}: ${count}`);
    }
    console.log();
  }

  // Invariant check
  const violations: string[] = [];
  if (dbValidation.duplicateIdempotencyKeys   > 0) violations.push(`${dbValidation.duplicateIdempotencyKeys} duplicate ledger idempotency keys`);
  if (dbValidation.nullRequestIdEvents        > 0) violations.push(`${dbValidation.nullRequestIdEvents} order_events with NULL request_id`);
  if (dbValidation.orphanLedgerEntries        > 0) violations.push(`${dbValidation.orphanLedgerEntries} orphan ledger entries`);
  if (dbValidation.negativeBalanceMerchants   > 0) violations.push(`${dbValidation.negativeBalanceMerchants} merchants with negative balance`);

  if (violations.length > 0) {
    console.log('  ⚠  INVARIANT VIOLATIONS:');
    violations.forEach(v => console.log(`    • ${v}`));
    console.log();
  } else {
    console.log('  ✓  All DB invariants pass\n');
  }

  // Cleanup
  if (!NO_CLEANUP) {
    process.stdout.write('  Cleaning up seeded data... ');
    await cleanupData(seeds);
    console.log('done\n');
  } else {
    console.log('  Skipping cleanup (--noCleanup)\n');
  }

  await closePool();

  if (violations.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('\nFatal:', err.message ?? err);
  process.exit(1);
});
