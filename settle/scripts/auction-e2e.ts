#!/usr/bin/env tsx
/**
 * Phase 2 smoke: hybrid-marketplace auction end-to-end against the running
 * settle API on devnet. This is NOT a CI test — it needs live DB state, a
 * real user token, and ≥2 real merchant tokens. Use it by hand when you
 * want to confirm the auction pipeline is wired end-to-end after a deploy.
 *
 * Flow exercised:
 *   1. Seed an auction on an existing order (orders.auction_mode='auction')
 *   2. Three merchants submit bids via POST /api/orders/:id/bid
 *   3. Wait past window_closes_at
 *   4. User calls POST /api/orders/:id/finalize-auction
 *   5. Assert: orders.selected_merchant_id, agreed_rate, expected_payout_base
 *      populated and consistent with the winning bid; order_bids statuses
 *      set to 'won' | 'lost' | 'filtered'; auction status = 'locked'
 *
 * Required env:
 *   BLIP_API_BASE           — e.g. https://app.blip.money or http://localhost:3000
 *   USER_TOKEN              — Bearer token for the order's user
 *   ORDER_ID                — existing open order id
 *   MERCHANT_A_ID + MERCHANT_A_TOKEN
 *   MERCHANT_B_ID + MERCHANT_B_TOKEN
 *   MERCHANT_C_ID + MERCHANT_C_TOKEN    (C is a "scammer" — bid +5% over base)
 *   BASE_RATE               — reference rate you expect (e.g. 3.67)
 *   BASE_FEE_BPS            — (default 250)
 *
 * Run:
 *   DEV_ACCESS_PASSWORD=... tsx settle/scripts/auction-e2e.ts
 */

import { query } from '../src/lib/db';

type Phase = 'indicative' | 'locked' | 'realised';

const cfg = {
  base: must('BLIP_API_BASE'),
  userToken: must('USER_TOKEN'),
  orderId: must('ORDER_ID'),
  merchants: [
    { id: must('MERCHANT_A_ID'), token: must('MERCHANT_A_TOKEN'), label: 'A (fair)' },
    { id: must('MERCHANT_B_ID'), token: must('MERCHANT_B_TOKEN'), label: 'B (slow-but-best-rate)' },
    { id: must('MERCHANT_C_ID'), token: must('MERCHANT_C_TOKEN'), label: 'C (scammer, +5% bait)' },
  ],
  baseRate: Number(must('BASE_RATE')),
  baseFeeBps: Number(process.env.BASE_FEE_BPS ?? '250'),
  mode: (process.env.AUCTION_MODE ?? 'recommended') as 'fastest' | 'recommended' | 'best_value',
  windowMs: Number(process.env.WINDOW_MS ?? '4000'),
};

function must(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`missing env: ${k}`); process.exit(2); }
  return v;
}

function log(step: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, ...data }));
}

async function api(method: string, path: string, token: string, body?: unknown): Promise<any> {
  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json as any };
}

async function seedAuction() {
  // Directly insert via DB — there's no HTTP endpoint that creates the
  // order_auctions row today; createAuction() is a library fn called from
  // the order-creation hot path when auction_mode='auction' is opted in.
  // For this smoke we assume the order was created with auction_mode set,
  // OR we flip the flag here so we can test without changing the primary
  // order-creation code.
  const res = await query<{ auction_id: string; window_closes_at: string }>(
    `WITH flipped AS (
       UPDATE orders
         SET auction_mode = 'auction',
             selection_mode = $1
       WHERE id = $2
         AND auction_mode = 'fixed'
       RETURNING id
     ),
     inserted AS (
       INSERT INTO order_auctions
         (order_id, mode, base_rate, base_fee_bps, window_ms, window_closes_at)
       SELECT id, $1, $3, $4, $5, now() + ($5 || ' milliseconds')::interval
       FROM flipped
       RETURNING id AS auction_id, window_closes_at
     )
     SELECT auction_id::text, window_closes_at::text FROM inserted`,
    [cfg.mode, cfg.orderId, cfg.baseRate, cfg.baseFeeBps, cfg.windowMs],
  );
  if (res.length === 0) {
    throw new Error('auction seed failed — order may already be in auction mode or not exist');
  }
  log('auction_seeded', res[0]);
  return res[0];
}

async function submitBids() {
  // A: fair (+0.3% over base, ETA 60s)
  // B: best-rate but slow (+1.5% over base, ETA 300s)
  // C: bait (+5% — should be filtered as 'deviation')
  const bids = [
    { m: cfg.merchants[0], rate: cfg.baseRate * 1.003, eta: 60,  max: 1000 },
    { m: cfg.merchants[1], rate: cfg.baseRate * 1.015, eta: 300, max: 1000 },
    { m: cfg.merchants[2], rate: cfg.baseRate * 1.050, eta: 30,  max: 1000 },
  ];
  const results: Array<{ label: string; status: number; body: any }> = [];
  for (const b of bids) {
    const r = await api(
      'POST', `/api/orders/${cfg.orderId}/bid`, b.m.token,
      { merchant_id: b.m.id, rate: b.rate, max_amount: b.max, eta_seconds: b.eta },
    );
    results.push({ label: b.m.label, status: r.status, body: r.body });
    log('bid_result', { merchant: b.m.label, status: r.status, body: r.body });
  }
  return results;
}

async function waitWindow(closesAt: string) {
  const ms = Math.max(0, new Date(closesAt).getTime() - Date.now() + 500);
  log('waiting_window', { ms });
  await new Promise((r) => setTimeout(r, ms));
}

async function finalize() {
  const r = await api('POST', `/api/orders/${cfg.orderId}/finalize-auction`, cfg.userToken);
  log('finalize_result', { status: r.status, body: r.body });
  return r;
}

async function assertInvariants() {
  const rows = await query<{
    status: string;
    auction_mode: string;
    selected_merchant_id: string | null;
    merchant_id: string | null;
    agreed_rate: string | null;
    expected_payout_base: string | null;
    fee_bps: number | null;
  }>(
    `SELECT status, auction_mode, selected_merchant_id, merchant_id,
            agreed_rate::text, expected_payout_base::text, fee_bps
       FROM orders WHERE id = $1`,
    [cfg.orderId],
  );
  const o = rows[0];
  if (!o) throw new Error('order disappeared');

  const auction = (await query<{ status: string; winning_bid_id: string | null }>(
    `SELECT status, winning_bid_id FROM order_auctions WHERE order_id = $1`, [cfg.orderId],
  ))[0];

  const bids = await query<{
    merchant_id: string;
    status: string;
    score: string | null;
    rejection_reason: string | null;
  }>(
    `SELECT merchant_id, status, score::text, rejection_reason FROM order_bids WHERE order_id = $1 ORDER BY status`,
    [cfg.orderId],
  );

  log('final_state', { order: o, auction, bids });

  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
  checks.push({ name: 'auction status=locked', ok: auction?.status === 'locked', detail: auction?.status });
  checks.push({ name: 'selected_merchant_id set', ok: !!o.selected_merchant_id });
  checks.push({ name: 'selected_merchant_id == merchant_id', ok: o.selected_merchant_id === o.merchant_id });
  checks.push({ name: 'agreed_rate set', ok: o.agreed_rate != null });
  checks.push({ name: 'expected_payout_base set', ok: o.expected_payout_base != null });
  checks.push({ name: 'fee_bps snapshot', ok: o.fee_bps === cfg.baseFeeBps, detail: `${o.fee_bps}` });
  checks.push({
    name: 'scammer rejected',
    ok: bids.some((b) => b.merchant_id === cfg.merchants[2].id && b.status === 'filtered' && b.rejection_reason === 'deviation'),
    detail: bids.find((b) => b.merchant_id === cfg.merchants[2].id)?.rejection_reason ?? 'not_present',
  });
  checks.push({
    name: 'exactly one winner',
    ok: bids.filter((b) => b.status === 'won').length === 1,
  });
  checks.push({
    name: `winner is fair (A) in ${cfg.mode} mode`,
    ok: cfg.mode === 'best_value'
      ? bids.find((b) => b.status === 'won')?.merchant_id === cfg.merchants[1].id
      : bids.find((b) => b.status === 'won')?.merchant_id === cfg.merchants[0].id,
  });

  console.log('\n--- INVARIANT CHECK ---');
  let pass = true;
  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` [${c.detail}]` : ''}`);
    if (!c.ok) pass = false;
  }
  if (!pass) { console.error('\nFAIL'); process.exit(1); }
  console.log('\nOK — auction E2E green');
}

(async () => {
  const seeded = await seedAuction();
  await submitBids();
  await waitWindow(seeded.window_closes_at);
  const final = await finalize();
  if (final.status >= 400) {
    console.error('finalize did not succeed', final);
    process.exit(1);
  }
  await assertInvariants();
})().catch((e) => { console.error(e); process.exit(1); });
