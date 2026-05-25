// GET /api/admin/waitlist
//
// Query params:
//   segment   = user | merchant | all       (default 'all')
//   status    = waitlisted | active | rejected | all  (default 'waitlisted')
//   q         = case-insensitive substring search across email/username/name
//   risk      = trusted_clean | neutral | suspect_plus | high_risk_plus | critical | all (default 'all')
//   hypothesis = NORMAL | BOT_FARM | REFERRAL_RING | SANCTIONED | MONEY_MULE | IDENTITY_FRAUD | LOW_QUALITY | all
//   sort      = joined_desc | joined_asc | risk_desc | risk_asc | points_desc | points_asc (default 'joined_desc')
//   page      = 1-based page number (default 1)
//   limit     = page size (default 50, max 200)
//
// Returns paginated waitlist signups across users + merchants with per-row
// engagement aggregates (referrals_count, tasks_completed_count) and threat
// scores (risk_score, risk_label, hypothesis, hypothesis_confidence).
//
// Backward compatibility: all NEW fields are added to the response — existing
// fields and their types are unchanged.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query, queryOne } from '@/lib/db';
import { getThreatScoresBatch } from '@/lib/threat/service';
import type { RiskLabel, ThreatHypothesis, Confidence } from '@/lib/threat/types';

interface ListRow {
  id: string;
  actor_type: 'user' | 'merchant';
  email: string | null;
  display_name: string | null;
  username: string | null;
  waitlist_status: 'waitlisted' | 'active' | 'rejected';
  waitlist_joined_at: string | null;
  waitlist_source: string | null;
  blip_points: number | null;
  referral_code: string | null;
  business_name: string | null;
  referrals_count: number;
  tasks_completed_count: number;
  // Threat fields merged in after the DB fetch
  risk_score?: number | null;
  risk_label?: RiskLabel | null;
  hypothesis?: ThreatHypothesis | null;
  hypothesis_confidence?: number | null;
  hypothesis_margin?: number | null;
  confidence?: Confidence | null;
}

type Segment = 'all' | 'user' | 'merchant';
type Status = 'waitlisted' | 'active' | 'rejected' | 'all';
type RiskFilter = 'all' | 'trusted_clean' | 'neutral' | 'suspect_plus' | 'high_risk_plus' | 'critical';
type SortMode = 'joined_desc' | 'joined_asc' | 'risk_desc' | 'risk_asc' | 'points_desc' | 'points_asc';
type HypothesisFilter = 'all' | 'flagged' | ThreatHypothesis;

const RISK_LABEL_SETS: Record<Exclude<RiskFilter, 'all'>, RiskLabel[]> = {
  trusted_clean:  ['TRUSTED', 'CLEAN'],
  neutral:        ['NEUTRAL'],
  suspect_plus:   ['SUSPECT', 'HIGH_RISK', 'CRITICAL'],
  high_risk_plus: ['HIGH_RISK', 'CRITICAL'],
  critical:       ['CRITICAL'],
};

const VALID_HYPOTHESIS: ThreatHypothesis[] = [
  'NORMAL', 'BOT_FARM', 'REFERRAL_RING', 'SANCTIONED',
  'MONEY_MULE', 'IDENTITY_FRAUD', 'LOW_QUALITY',
];

export async function GET(request: NextRequest) {
  const adminAuth = await requireAdminAuth(request);
  if (adminAuth) return adminAuth;

  const sp = request.nextUrl.searchParams;
  const segment = (sp.get('segment') ?? 'all') as Segment;
  const status = (sp.get('status') ?? 'waitlisted') as Status;
  const q = (sp.get('q') ?? '').trim().toLowerCase();
  const risk = (sp.get('risk') ?? 'all') as RiskFilter;
  const hypothesis = (sp.get('hypothesis') ?? 'all') as HypothesisFilter;
  const sort = (sp.get('sort') ?? 'joined_desc') as SortMode;
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '50', 10) || 50));

  if (!['user', 'merchant', 'all'].includes(segment)) {
    return NextResponse.json({ success: false, error: 'Invalid segment' }, { status: 400 });
  }
  if (!['waitlisted', 'active', 'rejected', 'all'].includes(status)) {
    return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
  }
  if (risk !== 'all' && !(risk in RISK_LABEL_SETS)) {
    return NextResponse.json({ success: false, error: 'Invalid risk filter' }, { status: 400 });
  }
  if (hypothesis !== 'all' && hypothesis !== 'flagged'
      && !VALID_HYPOTHESIS.includes(hypothesis as ThreatHypothesis)) {
    return NextResponse.json({ success: false, error: 'Invalid hypothesis filter' }, { status: 400 });
  }
  if (!['joined_desc','joined_asc','risk_desc','risk_asc','points_desc','points_asc'].includes(sort)) {
    return NextResponse.json({ success: false, error: 'Invalid sort' }, { status: 400 });
  }

  // ============================================================================
  // Strategy
  //   1. Build per-segment SELECTs including engagement aggregates +
  //      LEFT JOIN risk_profiles for the threat fields needed for filter/sort.
  //   2. UNION ALL across segments when segment='all'.
  //   3. Apply risk + hypothesis filters at SQL level so pagination is correct.
  //   4. Sort by chosen mode. Pagination via LIMIT/OFFSET.
  //   5. After fetching the page, also fetch fresh threat summaries via
  //      getThreatScoresBatch (which uses the same risk_profiles table) to
  //      ensure we return the most up-to-date hypothesis_confidence + confidence.
  //      (The SQL inline JOIN gives us label/score/hypothesis for filtering;
  //       the batch fetch resolves the rest from the same row in a single
  //       trip — net cost is one extra small query.)
  // ============================================================================

  // Risk filter SQL clause — applied against rp.wl_label.
  const riskLabelClause = risk === 'all'
    ? ''
    : `AND rp.wl_label = ANY(ARRAY[${RISK_LABEL_SETS[risk].map(l => `'${l}'`).join(',')}]::text[])`;
  // 'flagged' = any non-NORMAL hypothesis (including no-hypothesis-yet rows
  // are filtered OUT — we only show actors the classifier has explicitly
  // flagged as a fraud type). Specific hypothesis filters match exactly.
  const hypothesisClause = hypothesis === 'all'
    ? ''
    : hypothesis === 'flagged'
      ? `AND rp.wl_hypothesis IS NOT NULL AND rp.wl_hypothesis <> 'NORMAL'`
      : `AND rp.wl_hypothesis = '${hypothesis}'`;
  const statusClause = status === 'all' ? '' : `AND t.waitlist_status = '${status}'`;

  // Search clause — built per-segment because columns differ slightly.
  const qPattern = q ? `%${q}%` : null;

  const userSelect = `
    SELECT
      t.id, 'user'::text AS actor_type,
      t.email,
      t.name AS display_name,
      t.username,
      t.waitlist_status,
      t.waitlist_joined_at::text AS waitlist_joined_at,
      t.waitlist_source,
      t.blip_points,
      t.referral_code,
      NULL::text AS business_name,
      COALESCE((
        SELECT COUNT(*)::int FROM waitlist_referrals r
         WHERE r.referrer_type = 'user' AND r.referrer_id = t.id
      ), 0) AS referrals_count,
      COALESCE((
        SELECT COUNT(*)::int FROM waitlist_tasks w
         WHERE w.actor_type = 'user' AND w.actor_id = t.id AND w.status = 'VERIFIED'
      ), 0) AS tasks_completed_count,
      rp.wl_score AS risk_score,
      rp.wl_label AS risk_label,
      rp.wl_hypothesis AS hypothesis,
      rp.wl_hypothesis_conf AS hypothesis_confidence,
      rp.wl_confidence AS confidence
    FROM users t
    LEFT JOIN risk_profiles rp ON rp.entity_id = t.id AND rp.entity_type = 'user'
    WHERE 1=1
      ${statusClause}
      ${qPattern ? `AND (LOWER(t.email) LIKE $Q OR LOWER(t.username) LIKE $Q OR LOWER(t.name) LIKE $Q)` : ''}
      ${riskLabelClause}
      ${hypothesisClause}
  `;

  const merchantSelect = `
    SELECT
      t.id, 'merchant'::text AS actor_type,
      t.email,
      t.display_name,
      t.username,
      t.waitlist_status,
      t.waitlist_joined_at::text AS waitlist_joined_at,
      t.waitlist_source,
      t.blip_points,
      t.referral_code,
      t.business_name,
      COALESCE((
        SELECT COUNT(*)::int FROM waitlist_referrals r
         WHERE r.referrer_type = 'merchant' AND r.referrer_id = t.id
      ), 0) AS referrals_count,
      COALESCE((
        SELECT COUNT(*)::int FROM waitlist_tasks w
         WHERE w.actor_type = 'merchant' AND w.actor_id = t.id AND w.status = 'VERIFIED'
      ), 0) AS tasks_completed_count,
      rp.wl_score AS risk_score,
      rp.wl_label AS risk_label,
      rp.wl_hypothesis AS hypothesis,
      rp.wl_hypothesis_conf AS hypothesis_confidence,
      rp.wl_confidence AS confidence
    FROM merchants t
    LEFT JOIN risk_profiles rp ON rp.entity_id = t.id AND rp.entity_type = 'merchant'
    WHERE 1=1
      ${statusClause}
      ${qPattern ? `AND (LOWER(t.email) LIKE $Q OR LOWER(t.username) LIKE $Q OR LOWER(t.business_name) LIKE $Q OR LOWER(t.display_name) LIKE $Q)` : ''}
      ${riskLabelClause}
      ${hypothesisClause}
  `;

  let unionSql: string;
  if (segment === 'user') unionSql = userSelect;
  else if (segment === 'merchant') unionSql = merchantSelect;
  else unionSql = `${userSelect} UNION ALL ${merchantSelect}`;

  // Sort + paginate.
  const orderBy = (() => {
    switch (sort) {
      case 'joined_asc':  return 'waitlist_joined_at ASC NULLS LAST';
      case 'risk_desc':   return 'risk_score DESC NULLS LAST';
      case 'risk_asc':    return 'risk_score ASC NULLS LAST';
      case 'points_desc': return 'blip_points DESC NULLS LAST';
      case 'points_asc':  return 'blip_points ASC NULLS LAST';
      default:            return 'waitlist_joined_at DESC NULLS LAST';
    }
  })();

  const offset = (page - 1) * limit;
  const params: unknown[] = [limit, offset];
  let finalSql = `${unionSql} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`;
  if (qPattern) {
    params.push(qPattern);
    finalSql = finalSql.replace(/\$Q/g, '$3');
  }

  let rows: ListRow[] = [];
  try {
    rows = await query<ListRow>(finalSql, params);
  } catch (err) {
    console.error('[admin/waitlist] list query failed', err);
    return NextResponse.json({ success: false, error: 'Query failed' }, { status: 500 });
  }

  // Count rows per segment (always both, regardless of the segment filter).
  // The tabs UI uses these for the per-tab badges so the admin always sees
  // how many user vs merchant signups match the current status / risk /
  // hypothesis / search filters. The headline `total` is derived from the
  // pair so a third query isn't needed.
  let total = 0;
  let usersTotal = 0;
  let merchantsTotal = 0;
  try {
    const userCountSql = `
      SELECT COUNT(*)::int AS n FROM users t
        LEFT JOIN risk_profiles rp ON rp.entity_id = t.id AND rp.entity_type = 'user'
       WHERE 1=1 ${statusClause}
         ${qPattern ? `AND (LOWER(t.email) LIKE $1 OR LOWER(t.username) LIKE $1 OR LOWER(t.name) LIKE $1)` : ''}
         ${riskLabelClause} ${hypothesisClause}
    `;
    const merchCountSql = `
      SELECT COUNT(*)::int AS n FROM merchants t
        LEFT JOIN risk_profiles rp ON rp.entity_id = t.id AND rp.entity_type = 'merchant'
       WHERE 1=1 ${statusClause}
         ${qPattern ? `AND (LOWER(t.email) LIKE $1 OR LOWER(t.username) LIKE $1 OR LOWER(t.business_name) LIKE $1 OR LOWER(t.display_name) LIKE $1)` : ''}
         ${riskLabelClause} ${hypothesisClause}
    `;
    const countParams = qPattern ? [qPattern] : [];
    const [u, m] = await Promise.all([
      queryOne<{ n: number }>(userCountSql, countParams),
      queryOne<{ n: number }>(merchCountSql, countParams),
    ]);
    usersTotal = u?.n ?? 0;
    merchantsTotal = m?.n ?? 0;
    total = segment === 'user' ? usersTotal
          : segment === 'merchant' ? merchantsTotal
          : usersTotal + merchantsTotal;
  } catch (err) {
    console.error('[admin/waitlist] count query failed', err);
    // Non-fatal — fall back to rows.length as a soft total. UI will show the
    // imprecise count rather than 500.
    total = rows.length;
  }

  // Refresh threat summary fields via batch fetch — defence-in-depth in case
  // the inline JOIN columns are stale due to a recent recompute that
  // landed between the JOIN and the cache invalidation.
  try {
    const summaries = await getThreatScoresBatch(
      rows.map(r => ({ id: r.id, type: r.actor_type })),
    );
    const byKey = new Map(summaries.map(s => [`${s.actor_type}:${s.actor_id}`, s]));
    for (const r of rows) {
      const s = byKey.get(`${r.actor_type}:${r.id}`);
      if (s) {
        r.risk_score = s.score;
        r.risk_label = s.label;
        r.hypothesis = s.hypothesis;
        r.hypothesis_confidence = s.hypothesis_confidence;
        r.confidence = s.confidence;
      }
    }
  } catch (err) {
    console.error('[admin/waitlist] threat batch refresh failed', err);
    // Non-fatal — the inline JOIN values stay as-is.
  }

  return NextResponse.json({
    success: true,
    data: {
      rows, page, limit, total,
      totals_by_segment: { user: usersTotal, merchant: merchantsTotal },
    },
  });
}
