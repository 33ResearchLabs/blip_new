/**
 * stuck-disputes-verify.js — READ-ONLY detector for stuck disputes.
 * Runs ONLY SELECT statements. Writes NOTHING. Safe to point at production.
 *
 * Background: an order in status='disputed' is auto-resolved at 24h by the
 * unhappy-path / payment-deadline workers — but ONLY when
 * orders.dispute_auto_resolve_at is set (by the touch_order_activity trigger)
 * AND it isn't excluded by the fund-safety guard (payment_sent_at IS NULL).
 * Compliance can always resolve any disputed order via /api/compliance/.../finalize,
 * but nothing today SURFACES which disputes are stuck. This script does that.
 *
 * Buckets (most → least urgent):
 *   A. never_scheduled  — disputed but dispute_auto_resolve_at IS NULL → the
 *      auto-resolve worker can NEVER pick it up. Silently stuck. HIGH.
 *   B. overdue_unworked — disputed, deadline passed > grace, still disputed →
 *      worker was down / errored / skipped it. HIGH.
 *   C. needs_compliance — disputed with payment_sent_at set → intentionally
 *      excluded from auto-resolve (fund safety); needs a human via /finalize.
 *      Not a bug, but must be VISIBLE. MEDIUM.
 *   D. state_mismatch   — order no longer 'disputed' but the disputes row is
 *      still open/investigating (or vice-versa) → stranded dispute record. MEDIUM.
 *   E. proposed_unfinal — order still 'disputed' with a proposed_resolution set but
 *      the 2-party confirm deadlocked (no timeout/auto-finalize) → resolution
 *      decided yet never applied; funds held. This is critical issue #3. HIGH.
 *
 * Usage:
 *   node scripts/stuck-disputes-verify.js
 *   DATABASE_URL='postgres://...readonly...' node scripts/stuck-disputes-verify.js
 *
 * Prefer a READ-ONLY DB role in production.
 */

const { Client } = require('pg');

const client = process.env.DATABASE_URL
  ? new Client({ connectionString: process.env.DATABASE_URL })
  : new Client({ host: 'localhost', port: 5432, database: 'settle', user: process.env.PGUSER || 'zeus' });
client.on('error', () => {}); // swallow proxy teardown resets

const OVERDUE_GRACE_HOURS = parseInt(process.env.STUCK_OVERDUE_GRACE_HOURS || '1', 10);
const COMPLIANCE_AGE_HOURS = parseInt(process.env.STUCK_COMPLIANCE_AGE_HOURS || '24', 10);

function h(t) { console.log('\n' + '='.repeat(72) + '\n' + t + '\n' + '='.repeat(72)); }

async function section(title, sql, params = []) {
  h(title);
  try {
    const res = await client.query(sql, params);
    if (res.rows.length === 0) console.log('(none) ✅');
    else console.table(res.rows);
    return res.rowCount || 0;
  } catch (err) {
    console.log('SKIPPED — query failed:', err.message);
    return 0;
  }
}

async function run() {
  await client.connect();
  console.log(process.env.DATABASE_URL ? '(using DATABASE_URL)' : '(using localhost defaults)');
  console.log(`Grace for "overdue": ${OVERDUE_GRACE_HOURS}h | compliance-age flag: ${COMPLIANCE_AGE_HOURS}h\n`);

  // -------- counts overview --------
  await section(
    'OVERVIEW — disputed orders by bucket',
    `SELECT
        COUNT(*) FILTER (WHERE o.status='disputed')                                                       AS total_disputed,
        COUNT(*) FILTER (WHERE o.status='disputed' AND o.dispute_auto_resolve_at IS NULL)                  AS a_never_scheduled,
        COUNT(*) FILTER (WHERE o.status='disputed' AND o.dispute_auto_resolve_at IS NOT NULL
                          AND o.dispute_auto_resolve_at < NOW() - ($1 || ' hours')::interval
                          AND COALESCE(o.payment_sent_at::text,'')='' )                                    AS b_overdue_unworked,
        COUNT(*) FILTER (WHERE o.status='disputed' AND o.payment_sent_at IS NOT NULL)                      AS c_needs_compliance
       FROM orders o`,
    [String(OVERDUE_GRACE_HOURS)],
  );

  // -------- A: never scheduled (auto_resolve_at NULL) --------
  const a = await section(
    'A. NEVER SCHEDULED — disputed but dispute_auto_resolve_at IS NULL (worker can never pick up)  [HIGH]',
    `SELECT o.order_number, o.status, o.escrow_debited_entity_id,
            o.disputed_at, date_trunc('second', NOW()-o.disputed_at)::text AS age, d.status AS dispute_status
       FROM orders o
       LEFT JOIN disputes d ON d.order_id = o.id
      WHERE o.status='disputed' AND o.dispute_auto_resolve_at IS NULL
      ORDER BY o.disputed_at NULLS FIRST
      LIMIT 100`,
  );

  // -------- B: overdue but still disputed --------
  const b = await section(
    'B. OVERDUE UNWORKED — past 24h deadline + grace, still disputed (worker down/errored)  [HIGH]',
    `SELECT o.order_number, o.dispute_auto_resolve_at,
            date_trunc('second', NOW()-o.dispute_auto_resolve_at)::text AS overdue_by,
            o.escrow_debited_entity_id, d.status AS dispute_status
       FROM orders o
       LEFT JOIN disputes d ON d.order_id = o.id
      WHERE o.status='disputed'
        AND o.dispute_auto_resolve_at IS NOT NULL
        AND o.dispute_auto_resolve_at < NOW() - ($1 || ' hours')::interval
        AND o.payment_sent_at IS NULL
      ORDER BY o.dispute_auto_resolve_at ASC
      LIMIT 100`,
    [String(OVERDUE_GRACE_HOURS)],
  );

  // -------- C: payment-sent disputes excluded from auto-resolve (need compliance) --------
  const c = await section(
    'C. NEEDS COMPLIANCE — disputed + payment_sent (excluded from auto-resolve by design)  [MEDIUM]',
    `SELECT o.order_number, o.payment_sent_at, o.disputed_at,
            date_trunc('second', NOW()-o.disputed_at)::text AS disputed_age,
            (o.disputed_at < NOW() - ($1 || ' hours')::interval) AS over_threshold,
            d.status AS dispute_status
       FROM orders o
       LEFT JOIN disputes d ON d.order_id = o.id
      WHERE o.status='disputed' AND o.payment_sent_at IS NOT NULL
      ORDER BY o.disputed_at ASC
      LIMIT 100`,
    [String(COMPLIANCE_AGE_HOURS)],
  );

  // -------- D: order/dispute state mismatch (stranded dispute rows) --------
  const d = await section(
    'D. STATE MISMATCH — order not disputed but dispute row still open/investigating (stranded)  [MEDIUM]',
    `SELECT o.order_number, o.status AS order_status, d.status AS dispute_status,
            d.created_at AS dispute_created, d.resolved_at
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
      WHERE d.status IN ('open','investigating','pending_confirmation','escalated')
        AND o.status <> 'disputed'
      ORDER BY d.created_at ASC
      LIMIT 100`,
  );

  // -------- E: resolution proposed but never finalized — the #3 deadlock --------
  // Compliance proposed a resolution (dispute → 'investigating', proposed_resolution
  // set) but the 2-party confirm never completed and nothing auto-finalises it, so
  // the order stays 'disputed' with funds in escrow. Compliance can force it via
  // /api/compliance/disputes/[id]/finalize, but nothing surfaces it today.
  const e = await section(
    'E. PROPOSED NOT FINALIZED — resolution decided but confirm deadlocked, order still disputed  [HIGH] (#3)',
    `SELECT o.order_number, d.status AS dispute_status, d.proposed_resolution,
            d.proposed_at, date_trunc('second', NOW()-d.proposed_at)::text AS proposed_age,
            d.user_confirmed, d.merchant_confirmed
       FROM orders o
       JOIN disputes d ON d.order_id = o.id
      WHERE o.status = 'disputed'
        AND d.status = 'investigating'
        AND d.proposed_resolution IS NOT NULL
        AND d.proposed_at < NOW() - ($1 || ' hours')::interval
      ORDER BY d.proposed_at ASC
      LIMIT 100`,
    [String(COMPLIANCE_AGE_HOURS)],
  );

  h('SUMMARY');
  console.log(`A never_scheduled : ${a}   [HIGH — never auto-resolves]`);
  console.log(`B overdue_unworked: ${b}   [HIGH — worker missed it]`);
  console.log(`C needs_compliance: ${c}   [MEDIUM — human must resolve via /finalize]`);
  console.log(`D state_mismatch  : ${d}   [MEDIUM — stranded dispute record]`);
  console.log(`E proposed_unfinal: ${e}   [HIGH — resolution decided but confirm deadlocked (#3)]`);
  console.log('\nDONE — read-only. No rows were written.');
}

run()
  .then(() => client.end().catch(() => {}))
  .then(() => process.exit(0))
  .catch((e) => { console.error('stuck-disputes-verify failed:', e.message); process.exit(1); });
