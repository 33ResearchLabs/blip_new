/**
 * Load Test Suite for Core API
 *
 * Tests: Health (no DB), Order Read (SELECT), Order Create (INSERT), Mixed
 * Ramps through increasing RPS levels to find breaking point
 */

const BASE_PORT = parseInt(process.env.CORE_API_PORT || '4010', 10);
const NUM_WORKERS = parseInt(process.env.CLUSTER_SIZE || '8', 10);
const PORTS = Array.from({ length: NUM_WORKERS }, (_, i) => BASE_PORT + i);
let rrIndex = 0;
function nextUrl(): string {
  const port = PORTS[rrIndex % PORTS.length];
  rrIndex++;
  return `http://localhost:${port}`;
}
const CORE_API = `http://localhost:${BASE_PORT}`; // for health checks

// Test data from DB
const TEST_MERCHANT = 'eb40bc7c-0f0f-428b-b6fd-e41d3e31f85a';
const TEST_USER = 'e0e9d384-1b22-45e4-8a11-41fbcc9a318a';
// Multiple offers to avoid single-row lock contention
const OFFER_IDS = [
  '84346764-7f66-4720-9c35-e59b1313069f',
  'dab81415-0beb-4933-9d04-2fa2bdaa1310',
  '3e641183-4d0f-4ee8-a56e-ede47f75b706',
  'b725e71d-1e15-4815-acf4-f6d8fb87fbad',
  'e7701f06-44b7-4ca6-b8e4-44bbcb29fa9c',
];

// Real order IDs from DB for read tests
const ORDER_IDS = [
  'c888bb4f-3b3a-4364-bf25-eec7952499ed',
  '373ebbe3-2850-46ea-8eee-190eed43123d',
  '1a27777c-9d6e-4c88-95af-22c70a2204d2',
  '14ca2fc2-d32f-4374-9529-f4aae9f26e6e',
  '891f7aa2-c2b0-442c-892b-409f99ead2d4',
  'ca0ea70d-8e5b-45c5-a9d0-6052f7863add',
  'd28c293d-34d5-4a58-a457-97205f8a97e7',
  '120afe77-5f94-4ed4-8d6d-a829881891bd',
  '84bcc770-0fef-4381-9cda-d36cf0c669ec',
  '3e27b3ee-0724-49ff-8328-cf9d0cb388e0',
  '3f7206a8-2cb2-40e9-b12c-239a01e6ba4e',
  'af5a0db6-742d-4c5c-b393-befafe9fcfec',
  '3b38732c-d781-4a31-88e0-b61dd1032b7e',
  'bcaa1e66-0e27-4912-944a-c871b2c10fcc',
  'fecef770-675d-4437-a6f7-25dfd22bac1f',
  'f2b45478-004e-49d0-b734-649b9051cb92',
  'bab1b520-5e04-49df-92f7-c4bc5a7a5dd3',
  '8d264176-209a-47e7-84c3-919a88fc3153',
  'cc8d5b3e-6310-45a2-b793-cfff4e970f11',
  '95c7faed-8dd0-4a01-b716-1dd6dc534a42',
];

interface TestResult {
  level: string;
  targetRps: number;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  durationMs: number;
  actualRps: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
  errorRate: string;
  errors: Record<string, number>;
}

async function timedFetch(url: string, opts?: RequestInit): Promise<{ ok: boolean; status: number; latencyMs: number; body: unknown; error?: string }> {
  const start = performance.now();
  try {
    const res = await fetch(url, opts);
    const body = await res.json();
    // 409 = expected capacity exhaustion, not an error
    const isOk = res.ok || res.status === 409;
    return { ok: isOk, status: res.status, latencyMs: performance.now() - start, body };
  } catch (err: unknown) {
    return { ok: false, status: 0, latencyMs: performance.now() - start, body: null, error: (err as Error).message };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function runLevel(
  label: string,
  targetRps: number,
  durationSec: number,
  requestFn: () => Promise<{ ok: boolean; status: number; latencyMs: number; error?: string }>
): Promise<TestResult> {
  const intervalMs = 1000 / targetRps;
  const totalRequests = targetRps * durationSec;
  const latencies: number[] = [];
  const errors: Record<string, number> = {};
  let successCount = 0;
  let errorCount = 0;

  const startTime = performance.now();
  const promises: Promise<void>[] = [];

  for (let i = 0; i < totalRequests; i++) {
    const delay = i * intervalMs;
    const p = new Promise<void>((resolve) => {
      setTimeout(async () => {
        const result = await requestFn();
        latencies.push(result.latencyMs);
        if (result.ok) {
          successCount++;
        } else {
          errorCount++;
          const key = result.error || `HTTP ${result.status}`;
          errors[key] = (errors[key] || 0) + 1;
        }
        resolve();
      }, delay);
    });
    promises.push(p);
  }

  await Promise.all(promises);
  const totalDuration = performance.now() - startTime;

  latencies.sort((a, b) => a - b);

  return {
    level: label,
    targetRps,
    totalRequests,
    successCount,
    errorCount,
    durationMs: Math.round(totalDuration),
    actualRps: Math.round((totalRequests / totalDuration) * 1000),
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    p50Ms: Math.round(percentile(latencies, 50)),
    p95Ms: Math.round(percentile(latencies, 95)),
    p99Ms: Math.round(percentile(latencies, 99)),
    maxMs: Math.round(latencies[latencies.length - 1] || 0),
    minMs: Math.round(latencies[0] || 0),
    errorRate: ((errorCount / totalRequests) * 100).toFixed(1) + '%',
    errors,
  };
}

function printResult(r: TestResult) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${r.level}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Target RPS:    ${r.targetRps}`);
  console.log(`  Actual RPS:    ${r.actualRps}`);
  console.log(`  Total Reqs:    ${r.totalRequests}`);
  console.log(`  Duration:      ${(r.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Success:       ${r.successCount} | Errors: ${r.errorCount} (${r.errorRate})`);
  console.log(`  Latency:       avg=${r.avgLatencyMs}ms  p50=${r.p50Ms}ms  p95=${r.p95Ms}ms  p99=${r.p99Ms}ms`);
  console.log(`  Min/Max:       ${r.minMs}ms / ${r.maxMs}ms`);
  if (Object.keys(r.errors).length > 0) {
    console.log(`  Errors:`);
    for (const [k, v] of Object.entries(r.errors)) {
      console.log(`    ${k}: ${v}`);
    }
  }
}

// --- Test Functions ---

function healthCheck() {
  return timedFetch(`${nextUrl()}/health`);
}

function readOrder() {
  const id = ORDER_IDS[Math.floor(Math.random() * ORDER_IDS.length)];
  return timedFetch(`${nextUrl()}/v1/orders/${id}`);
}

let orderCounter = 0;
function createOrder() {
  orderCounter++;
  const offerId = OFFER_IDS[orderCounter % OFFER_IDS.length];
  return timedFetch(`${nextUrl()}/v1/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: TEST_USER,
      merchant_id: TEST_MERCHANT,
      offer_id: offerId,
      type: 'buy',
      payment_method: 'bank',
      crypto_amount: 0.01,
      fiat_amount: 0.04,
      rate: 3.65,
    }),
  });
}

function mixedWorkload() {
  const r = Math.random();
  if (r < 0.50) return healthCheck();     // 50% health (no DB)
  if (r < 0.85) return readOrder();       // 35% reads (SELECT)
  return createOrder();                    // 15% writes (INSERT)
}

// --- Main ---

async function main() {
  console.log('====================================================');
  console.log('         CORE API LOAD TEST SUITE');
  console.log('====================================================');
  console.log(`Targets: ports ${PORTS[0]}-${PORTS[PORTS.length - 1]} (${PORTS.length} workers)`);

  // Verify all workers are up
  let aliveCount = 0;
  for (const port of PORTS) {
    const check = await timedFetch(`http://localhost:${port}/health`);
    if (check.ok) aliveCount++;
  }
  if (aliveCount === 0) {
    console.error('No workers reachable! Run: bash apps/core-api/cluster.sh');
    process.exit(1);
  }
  console.log(`${aliveCount}/${PORTS.length} workers healthy`);

  const readCheck = await readOrder();
  if (!readCheck.ok) {
    console.error(`Read endpoint broken: HTTP ${readCheck.status}`);
    process.exit(1);
  }
  console.log(`Read endpoint OK (${Math.round(readCheck.latencyMs)}ms)`);

  const createCheck = await createOrder();
  if (!createCheck.ok) {
    console.error(`Create endpoint broken: HTTP ${createCheck.status}`, JSON.stringify(createCheck.body));
    process.exit(1);
  }
  console.log(`Create endpoint OK (${Math.round(createCheck.latencyMs)}ms)\n`);

  const results: TestResult[] = [];

  // Phase 1: Health endpoint (pure throughput, no DB)
  console.log('\n--- PHASE 1: Health endpoint (no DB) ---');
  for (const rps of [10, 100, 500, 1000, 5000, 10000]) {
    const dur = rps <= 100 ? 5 : 3;
    const r = await runLevel(`Health @ ${rps}/s`, rps, dur, healthCheck);
    printResult(r);
    results.push(r);
    if (r.errorCount > r.totalRequests * 0.1) {
      console.log('  >10% errors -- stopping health ramp');
      break;
    }
  }

  // Phase 2: Read endpoint (SELECT by ID)
  console.log('\n--- PHASE 2: Order reads (SELECT by ID) ---');
  for (const rps of [10, 100, 500, 1000, 3000]) {
    const dur = rps <= 100 ? 5 : 3;
    const r = await runLevel(`Read @ ${rps}/s`, rps, dur, readOrder);
    printResult(r);
    results.push(r);
    if (r.errorCount > r.totalRequests * 0.1) {
      console.log('  >10% errors -- stopping read ramp');
      break;
    }
  }

  // Phase 3: Write endpoint (INSERT + trigger + notification)
  console.log('\n--- PHASE 3: Order creates (INSERT + trigger + outbox) ---');
  for (const rps of [10, 50, 100, 250, 500, 1000]) {
    const dur = rps <= 100 ? 5 : 3;
    const r = await runLevel(`Create @ ${rps}/s`, rps, dur, createOrder);
    printResult(r);
    results.push(r);
    if (r.errorCount > r.totalRequests * 0.05) {
      console.log('  >5% errors -- stopping write ramp');
      break;
    }
  }

  // Phase 4: Mixed workload (realistic)
  console.log('\n--- PHASE 4: Mixed (50% health, 35% read, 15% write) ---');
  for (const rps of [10, 100, 500, 1000, 3000]) {
    const dur = rps <= 100 ? 5 : 3;
    const r = await runLevel(`Mixed @ ${rps}/s`, rps, dur, mixedWorkload);
    printResult(r);
    results.push(r);
    if (r.errorCount > r.totalRequests * 0.1) {
      console.log('  >10% errors -- stopping mixed ramp');
      break;
    }
  }

  // Cleanup note
  console.log(`\nTest created ~${orderCounter} orders. Cleanup:`);
  console.log(`  psql -U zeus -d settle -c "DELETE FROM notification_outbox WHERE order_id IN (SELECT id FROM orders WHERE fiat_amount = 0.04 AND user_id = '${TEST_USER}');"`);
  console.log(`  psql -U zeus -d settle -c "DELETE FROM orders WHERE fiat_amount = 0.04 AND user_id = '${TEST_USER}';"`);

  // Summary table
  console.log('\n\n' + '='.repeat(110));
  console.log('SUMMARY');
  console.log('='.repeat(110));
  console.log(
    'Test'.padEnd(25) +
    'Target'.padStart(7) +
    'Actual'.padStart(7) +
    'Reqs'.padStart(7) +
    'Errs'.padStart(6) +
    'Err%'.padStart(7) +
    'Avg'.padStart(8) +
    'p50'.padStart(7) +
    'p95'.padStart(8) +
    'p99'.padStart(8) +
    'Max'.padStart(8) +
    '  Status'
  );
  console.log('-'.repeat(110));
  for (const r of results) {
    const broken = parseFloat(r.errorRate) > 5;
    const saturated = r.actualRps < r.targetRps * 0.8;
    let status = 'OK';
    if (broken) status = 'FAIL';
    else if (saturated) status = 'SATURATED';

    console.log(
      r.level.padEnd(25) +
      String(r.targetRps).padStart(7) +
      String(r.actualRps).padStart(7) +
      String(r.totalRequests).padStart(7) +
      String(r.errorCount).padStart(6) +
      r.errorRate.padStart(7) +
      (r.avgLatencyMs + 'ms').padStart(8) +
      (r.p50Ms + 'ms').padStart(7) +
      (r.p95Ms + 'ms').padStart(8) +
      (r.p99Ms + 'ms').padStart(8) +
      (r.maxMs + 'ms').padStart(8) +
      '  ' + status
    );
  }
  console.log('='.repeat(110));
}

main().catch(console.error);
