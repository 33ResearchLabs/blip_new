// Threat-score service. Hydrates ScoringContext + lookups from Postgres,
// runs the pure scoring orchestrator (`score.ts`), and persists the result
// to risk_profiles. Layered Redis cache (2 min TTL) mirrors getRiskProfile()'s
// pattern.
//
// All public functions are safe to call from request paths — DB errors and
// cache errors are swallowed and the function returns null (never throws).
// This is fundamental: a threat-scoring failure must NEVER break an existing
// flow (signup, task verify, admin list render).

import { query, queryOne } from '@/lib/db';
import cache from '@/lib/cache/redis';
import type {
  ActorType,
  ActorRow,
  TaskRow,
  ReferralRow,
  ReferrerSummary,
  RiskLabel,
  ThreatHypothesis,
  Confidence,
  CategoryScores,
  Signal,
  Tier1Flag,
  ThreatScoreResult,
  ScoringContext,
} from './types';
import { computeThreatScore, type ScoringLookups } from './score';
import { getExternalSignals } from './external/reputation';

const CACHE_TTL_SECONDS = 120;
const CACHE_PREFIX = 'threat:';

function cacheKey(actorType: ActorType, actorId: string): string {
  return `${CACHE_PREFIX}${actorType}:${actorId}`;
}

function defaultPerHypothesis(): Record<ThreatHypothesis, number> {
  return {
    NORMAL: 0, BOT_FARM: 0, REFERRAL_RING: 0, SANCTIONED: 0,
    MONEY_MULE: 0, IDENTITY_FRAUD: 0, LOW_QUALITY: 0,
  };
}

// ============================================================================
// Public API
// ============================================================================

/** Lightweight summary suitable for list rows. Cheap to fetch in bulk. */
export interface ThreatSummary {
  actor_id: string;
  actor_type: ActorType;
  score: number | null;
  label: RiskLabel | null;
  hypothesis: ThreatHypothesis | null;
  hypothesis_confidence: number | null;
  /** Phase F: top posterior − second-place posterior. Lets list-row UI
   *  decide whether to soft-suppress a NORMAL chip (confident-NORMAL hides;
   *  ambiguous-NORMAL surfaces with a warning style). */
  hypothesis_margin: number | null;
  confidence: Confidence | null;
}

/** Fetches threat summaries for many actors at once. Used by the admin
 *  waitlist list endpoint. Returns rows in the same order as input; rows
 *  with no computed profile have null fields. */
export async function getThreatScoresBatch(
  actors: Array<{ id: string; type: ActorType }>,
): Promise<ThreatSummary[]> {
  if (actors.length === 0) return [];
  try {
    const ids = actors.map(a => a.id);
    // We don't have entity_type per-row in the WHERE clause easily without
    // building (id, type) pairs; the (entity_id, entity_type) PK on
    // risk_profiles makes entity_id alone unique enough across the universe
    // of UUIDs, so a single IN lookup is safe.
    const rows = await query<{
      entity_id: string;
      entity_type: ActorType;
      wl_score: number | null;
      wl_label: RiskLabel | null;
      wl_hypothesis: ThreatHypothesis | null;
      wl_hypothesis_conf: number | null;
      wl_hypothesis_margin: number | null;
      wl_confidence: Confidence | null;
    }>(
      `SELECT entity_id, entity_type, wl_score, wl_label, wl_hypothesis,
              wl_hypothesis_conf, wl_hypothesis_margin, wl_confidence
         FROM risk_profiles
        WHERE entity_id = ANY($1::uuid[])`,
      [ids],
    );

    const byId = new Map<string, typeof rows[number]>();
    for (const r of rows) byId.set(`${r.entity_type}:${r.entity_id}`, r);

    return actors.map(a => {
      const r = byId.get(`${a.type}:${a.id}`);
      return {
        actor_id: a.id,
        actor_type: a.type,
        score: r?.wl_score ?? null,
        label: r?.wl_label ?? null,
        hypothesis: r?.wl_hypothesis ?? null,
        hypothesis_confidence: r?.wl_hypothesis_conf ?? null,
        hypothesis_margin: r?.wl_hypothesis_margin ?? null,
        confidence: r?.wl_confidence ?? null,
      };
    });
  } catch (err) {
    console.error('[threat/service] getThreatScoresBatch failed', err);
    return actors.map(a => ({
      actor_id: a.id, actor_type: a.type,
      score: null, label: null, hypothesis: null, hypothesis_confidence: null,
      hypothesis_margin: null, confidence: null,
    }));
  }
}

/** Fetch the full persisted ThreatScoreResult for one actor (admin detail
 *  modal). Returns null if not yet computed. */
export async function getFullThreatProfile(
  actorType: ActorType,
  actorId: string,
): Promise<ThreatScoreResult | null> {
  try {
    const cached = await cache.get<ThreatScoreResult>(cacheKey(actorType, actorId));
    if (cached) return cached;

    const row = await queryOne<{
      wl_score: number | null;
      wl_label: RiskLabel | null;
      wl_hypothesis: ThreatHypothesis | null;
      wl_hypothesis_conf: number | null;
      wl_hypothesis_margin: number | null;
      wl_per_hypothesis: Record<ThreatHypothesis, number> | null;
      wl_hypothesis_contributors: ThreatScoreResult['hypothesis_contributors'] | null;
      wl_confidence: Confidence | null;
      wl_by_category: CategoryScores | null;
      wl_signals: Signal[] | null;
      wl_tier1_flags: Tier1Flag[] | null;
      wl_tier3_anomaly: number | null;
      wl_community_id: string | null;
      wl_model_version: string | null;
      wl_recalc_at: string | null;
    }>(
      `SELECT wl_score, wl_label, wl_hypothesis, wl_hypothesis_conf,
              wl_hypothesis_margin, wl_per_hypothesis, wl_hypothesis_contributors,
              wl_confidence, wl_by_category, wl_signals, wl_tier1_flags,
              wl_tier3_anomaly, wl_community_id, wl_model_version,
              wl_recalc_at::text AS wl_recalc_at
         FROM risk_profiles
        WHERE entity_id = $1 AND entity_type = $2
        LIMIT 1`,
      [actorId, actorType],
    );
    if (!row || row.wl_score === null || !row.wl_label) return null;

    const result: ThreatScoreResult = {
      score: row.wl_score,
      label: row.wl_label,
      hypothesis: row.wl_hypothesis ?? 'NORMAL',
      hypothesis_confidence: row.wl_hypothesis_conf ?? 0,
      hypothesis_margin: row.wl_hypothesis_margin ?? 0,
      per_hypothesis: row.wl_per_hypothesis ?? defaultPerHypothesis(),
      hypothesis_contributors: row.wl_hypothesis_contributors ?? [],
      confidence: row.wl_confidence ?? 'low',
      by_category: row.wl_by_category ?? { identity: 0, network: 0, device: 0, behavior: 0, graph: 0, profile: 0 },
      signals: row.wl_signals ?? [],
      tier1_flags: row.wl_tier1_flags ?? [],
      tier2_score: row.wl_score, // approximate — pre-combiner score not persisted separately
      tier3_anomaly: row.wl_tier3_anomaly ?? 0,
      community_id: row.wl_community_id,
      model_version: row.wl_model_version ?? 'unknown',
      computed_at: row.wl_recalc_at ?? new Date().toISOString(),
    };

    await cache.set(cacheKey(actorType, actorId), result, CACHE_TTL_SECONDS);
    return result;
  } catch (err) {
    console.error('[threat/service] getFullThreatProfile failed', err);
    return null;
  }
}

/**
 * Compute (or recompute) a single actor's threat score and persist it. Safe
 * to call from request paths — wraps everything in try/catch and never
 * throws. Returns the result on success, null on failure.
 */
export async function recomputeAndPersist(
  actorType: ActorType,
  actorId: string,
): Promise<ThreatScoreResult | null> {
  try {
    const ctx = await loadScoringContext(actorType, actorId);
    if (!ctx) return null;
    const lookups = await loadScoringLookups(ctx);
    const result = computeThreatScore(ctx, lookups);
    await persist(actorType, actorId, result);
    // Bust the cache so subsequent reads see the new value immediately.
    await cache.del(cacheKey(actorType, actorId));
    return result;
  } catch (err) {
    console.error('[threat/service] recomputeAndPersist failed', { actorType, actorId, err });
    return null;
  }
}

// ============================================================================
// Internal: hydrate context + lookups
// ============================================================================

async function loadScoringContext(
  actorType: ActorType,
  actorId: string,
): Promise<ScoringContext | null> {
  const actor = await loadActorRow(actorType, actorId);
  if (!actor) return null;

  const tasks = await query<TaskRow>(
    `SELECT id, task_type, status, completed_at::text AS completed_at
       FROM waitlist_tasks
      WHERE actor_type = $1 AND actor_id = $2`,
    [actorType, actorId],
  );

  const referralsMade = await query<ReferralRow>(
    `SELECT referred_id, referred_type, created_at::text AS created_at
       FROM waitlist_referrals
      WHERE referrer_type = $1 AND referrer_id = $2`,
    [actorType, actorId],
  );

  const referredByRow = await loadReferrerSummary(actor);

  return { actor, tasks, referralsMade, referredByRow };
}

async function loadActorRow(
  actorType: ActorType,
  actorId: string,
): Promise<ActorRow | null> {
  if (actorType === 'user') {
    const row = await queryOne<{
      id: string; email: string | null; email_verified: boolean | null;
      wallet_address: string | null; name: string | null;
      waitlist_joined_at: string | null;
      referred_by_user_id: string | null; referred_by_merchant_id: string | null;
    }>(
      `SELECT id, email, email_verified, wallet_address, name,
              waitlist_joined_at::text AS waitlist_joined_at,
              referred_by_user_id, referred_by_merchant_id
         FROM users WHERE id = $1`,
      [actorId],
    );
    if (!row) return null;
    return {
      id: row.id, type: 'user',
      email: row.email, email_verified: row.email_verified,
      wallet_address: row.wallet_address, name: row.name,
      business_name: null, business_category: null,
      expected_monthly_volume_usd: null, country_code: null,
      waitlist_joined_at: row.waitlist_joined_at,
      referred_by_user_id: row.referred_by_user_id,
      referred_by_merchant_id: row.referred_by_merchant_id,
    };
  }
  const row = await queryOne<{
    id: string; email: string | null; email_verified: boolean | null;
    wallet_address: string | null; display_name: string | null;
    business_name: string | null; business_category: string | null;
    expected_monthly_volume_usd: number | null; country_code: string | null;
    waitlist_joined_at: string | null;
    referred_by_user_id: string | null; referred_by_merchant_id: string | null;
  }>(
    `SELECT id, email, email_verified, wallet_address, display_name,
            business_name, business_category, expected_monthly_volume_usd,
            country_code,
            waitlist_joined_at::text AS waitlist_joined_at,
            referred_by_user_id, referred_by_merchant_id
       FROM merchants WHERE id = $1`,
    [actorId],
  );
  if (!row) return null;
  return {
    id: row.id, type: 'merchant',
    email: row.email, email_verified: row.email_verified,
    wallet_address: row.wallet_address, name: row.display_name,
    business_name: row.business_name, business_category: row.business_category,
    expected_monthly_volume_usd: row.expected_monthly_volume_usd
      ? Number(row.expected_monthly_volume_usd) : null,
    country_code: row.country_code,
    waitlist_joined_at: row.waitlist_joined_at,
    referred_by_user_id: row.referred_by_user_id,
    referred_by_merchant_id: row.referred_by_merchant_id,
  };
}

async function loadReferrerSummary(actor: ActorRow): Promise<ReferrerSummary | null> {
  // Prefer user-referrer pointer; fall back to merchant-referrer pointer.
  let refType: ActorType | null = null;
  let refId: string | null = null;
  if (actor.referred_by_user_id) { refType = 'user'; refId = actor.referred_by_user_id; }
  else if (actor.referred_by_merchant_id) { refType = 'merchant'; refId = actor.referred_by_merchant_id; }
  if (!refType || !refId) return null;

  const profile = await queryOne<{ wl_score: number | null; wl_label: RiskLabel | null }>(
    `SELECT wl_score, wl_label FROM risk_profiles
      WHERE entity_id = $1 AND entity_type = $2 LIMIT 1`,
    [refId, refType],
  );

  const totalRow = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM waitlist_referrals
      WHERE referrer_type = $1 AND referrer_id = $2
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [refType, refId],
  );

  return {
    id: refId, type: refType,
    wl_score: profile?.wl_score ?? null,
    wl_label: profile?.wl_label ?? null,
    total_referrals_24h: totalRow ? parseInt(totalRow.c, 10) : 0,
  };
}

async function loadScoringLookups(ctx: ScoringContext): Promise<ScoringLookups> {
  // Run all DB-bound lookups in parallel — they're independent.
  // Network lookups (signup IP + cluster + burst) need the signup IP first;
  // the parallel block fetches the IP alongside the others.
  // Device fingerprint + signup behaviour lookups also run here.
  const [
    blacklistMatch,
    replayCandidateCount,
    walletShareCount,
    referrerChainDepth1h,
    signupIp,
    deviceFp,
    behaviorTelemetry,
  ] = await Promise.all([
    checkBlacklist(ctx.actor),
    countReplayCandidates(ctx.actor),
    countSharedWallet(ctx.actor),
    computeChainDepth(ctx.actor),
    loadSignupIp(ctx.actor),
    loadLatestFingerprint(ctx.actor),
    loadLatestBehavior(ctx.actor),
  ]);

  // IP-derived counts need the IP, and fp reuse count needs the fp_hash —
  // do them after the parallel block. Tier 3 community membership lookup
  // also runs here (independent of the others).
  const [ipClusterCount24h, signupBurstCount10m, fpReuseCount, community] = await Promise.all([
    signupIp ? countIpClusterActors(signupIp) : Promise.resolve(0),
    signupIp ? countSignupBurst(signupIp) : Promise.resolve(0),
    deviceFp ? countFingerprintReuse(deviceFp.fpHash, ctx.actor) : Promise.resolve(0),
    loadCommunityMembership(ctx.actor),
  ]);

  // External APIs — fire IPQS (against signup IP) + HIBP (against email)
  // in parallel. Each gracefully returns null on failure. ~1.5s timeout
  // per source so combined worst-case is bounded.
  const external = await getExternalSignals({
    ip: signupIp,
    email: ctx.actor.email,
  });

  // Extract browser timezone from the fingerprint components blob (Phase C
  // adds it). Used by TIMEZONE_GEO_MISMATCH against IPQS country.
  const browserTimezone = deviceFp?.components
    ? (deviceFp.components as Record<string, unknown>).timezone as string | null
    : null;

  return {
    tier1: { blacklistMatch, replayCandidateCount, deviceFpReuseCount: fpReuseCount },
    identity: { walletShareCount, hibp: external.hibp },
    network: {
      signupIp,
      ipqs: external.ipqs,
      ipClusterCount24h,
      signupBurstCount10m,
    },
    device: {
      fpHash: deviceFp?.fpHash ?? null,
      componentsJson: deviceFp ? JSON.stringify(deviceFp.components) : null,
      timezone: browserTimezone ?? null,
      fpReuseCount,
      ipqs: external.ipqs,
    },
    behavior: {
      telemetry: behaviorTelemetry,
    },
    graph: {
      referrerReferrals24h: ctx.referredByRow?.total_referrals_24h ?? 0,
      referrerChainDepth1h,
      communityAnomaly: community?.anomaly_score ?? 0,
      communitySize: community?.community_size ?? 0,
      communityDensity: community?.community_density ?? 0,
    },
    tier3Anomaly: community?.anomaly_score ?? 0,
    communityId: community?.community_id ?? null,
  };
}

interface CommunityMembershipRow {
  community_id: string;
  anomaly_score: number;
  community_size: number;
  community_density: number;
}

async function loadCommunityMembership(actor: ActorRow): Promise<CommunityMembershipRow | null> {
  try {
    const row = await queryOne<{
      community_id: string;
      anomaly_score: number | string;
      community_size: number | string;
      community_density: number | string;
    }>(
      `SELECT community_id, anomaly_score, community_size, community_density
         FROM waitlist_community_membership
        WHERE actor_type = $1 AND actor_id = $2
        LIMIT 1`,
      [actor.type, actor.id],
    );
    if (!row) return null;
    const num = (v: number | string): number => (typeof v === 'number' ? v : Number(v) || 0);
    return {
      community_id: row.community_id,
      anomaly_score: num(row.anomaly_score),
      community_size: Math.round(num(row.community_size)),
      community_density: num(row.community_density),
    };
  } catch {
    return null;
  }
}

interface LatestFingerprint {
  fpHash: string;
  components: Record<string, unknown>;
}

async function loadLatestFingerprint(actor: ActorRow): Promise<LatestFingerprint | null> {
  try {
    const row = await queryOne<{ fp_hash: string; components: Record<string, unknown> }>(
      `SELECT df.fp_hash, df.components
         FROM actor_device_fingerprints adf
         JOIN device_fingerprints df ON df.fp_hash = adf.fp_hash
        WHERE adf.actor_type = $1 AND adf.actor_id = $2
        ORDER BY adf.captured_at DESC
        LIMIT 1`,
      [actor.type, actor.id],
    );
    if (!row) return null;
    return { fpHash: row.fp_hash, components: row.components };
  } catch {
    return null;
  }
}

async function loadLatestBehavior(actor: ActorRow): Promise<{
  fill_time_ms: number;
  mouse_entropy: number;
  keystroke_cadence_stddev: number;
  copy_paste_events: string[];
} | null> {
  try {
    const row = await queryOne<{
      fill_time_ms: number | null;
      mouse_entropy: number | string | null;
      keystroke_cadence_stddev: number | string | null;
      copy_paste_events: string[] | null;
    }>(
      `SELECT fill_time_ms, mouse_entropy, keystroke_cadence_stddev, copy_paste_events
         FROM signup_behavior
        WHERE actor_type = $1 AND actor_id = $2
        ORDER BY captured_at DESC
        LIMIT 1`,
      [actor.type, actor.id],
    );
    if (!row) return null;
    // Postgres REAL columns may come back as either number or string
    // depending on the pg driver mode — normalise both to number.
    const num = (v: number | string | null | undefined, fallback = 0): number => {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { const n = Number(v); return Number.isNaN(n) ? fallback : n; }
      return fallback;
    };
    return {
      fill_time_ms: num(row.fill_time_ms),
      mouse_entropy: num(row.mouse_entropy),
      keystroke_cadence_stddev: num(row.keystroke_cadence_stddev),
      copy_paste_events: Array.isArray(row.copy_paste_events) ? row.copy_paste_events : [],
    };
  } catch {
    return null;
  }
}

async function countFingerprintReuse(fpHash: string, actor: ActorRow): Promise<number> {
  try {
    const row = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM actor_device_fingerprints
        WHERE fp_hash = $1
          AND NOT (actor_type = $2 AND actor_id = $3)`,
      [fpHash, actor.type, actor.id],
    );
    return row ? parseInt(row.c, 10) : 0;
  } catch {
    return 0;
  }
}

async function loadSignupIp(actor: ActorRow): Promise<string | null> {
  // Most recent ip_logs row tagged action='signup' for this actor.
  // Falls back to any ip_logs row if no signup-specific entry exists.
  try {
    const signupRow = await queryOne<{ ip: string }>(
      `SELECT ip FROM ip_logs
        WHERE entity_id = $1 AND entity_type = $2 AND action = 'signup'
        ORDER BY created_at DESC LIMIT 1`,
      [actor.id, actor.type],
    );
    if (signupRow?.ip) return signupRow.ip;
    const anyRow = await queryOne<{ ip: string }>(
      `SELECT ip FROM ip_logs
        WHERE entity_id = $1 AND entity_type = $2
        ORDER BY created_at ASC LIMIT 1`,
      [actor.id, actor.type],
    );
    return anyRow?.ip ?? null;
  } catch {
    return null;
  }
}

async function countIpClusterActors(ip: string): Promise<number> {
  try {
    const row = await queryOne<{ c: string }>(
      `SELECT COUNT(DISTINCT (entity_id, entity_type))::text AS c
         FROM ip_logs
        WHERE ip = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
      [ip],
    );
    return row ? parseInt(row.c, 10) : 0;
  } catch {
    return 0;
  }
}

async function countSignupBurst(ip: string): Promise<number> {
  try {
    const row = await queryOne<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM ip_logs
        WHERE ip = $1 AND action = 'signup'
          AND created_at >= NOW() - INTERVAL '10 minutes'`,
      [ip],
    );
    return row ? parseInt(row.c, 10) : 0;
  } catch {
    return 0;
  }
}

async function checkBlacklist(actor: ActorRow): Promise<{ matched: boolean; entity_type?: string; reason?: string }> {
  // Check by entity id, email, wallet — whichever matches first wins.
  const candidates: Array<{ id: string; type: string }> = [
    { id: actor.id, type: actor.type },
  ];
  if (actor.email) candidates.push({ id: actor.email.toLowerCase(), type: 'ip' /* email reuse — entity_type='ip' is wrong */ });
  // The blacklist's entity_type enum only allows 'user'|'merchant'|'device'|'ip'|'wallet'.
  // Email blacklisting is out of scope here — we just check id and wallet for Phase A.
  if (actor.wallet_address) candidates.push({ id: actor.wallet_address, type: 'wallet' });

  for (const c of candidates) {
    if (c.type !== actor.type && c.type !== 'wallet') continue;
    const row = await queryOne<{ entity_type: string; reason: string }>(
      `SELECT entity_type, reason FROM blacklist
        WHERE entity_id = $1 AND entity_type = $2 AND is_active = true
        LIMIT 1`,
      [c.id, c.type],
    );
    if (row) return { matched: true, entity_type: row.entity_type, reason: row.reason };
  }
  return { matched: false };
}

async function countReplayCandidates(actor: ActorRow): Promise<number> {
  if (!actor.email && !actor.wallet_address) return 0;
  // Same email or wallet on a different account created within 24h with a
  // different name. Counted across users + merchants.
  const userRows = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM users
      WHERE id <> $1
        AND ((email IS NOT NULL AND email = $2)
             OR (wallet_address IS NOT NULL AND wallet_address = $3))
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [actor.id, actor.email, actor.wallet_address],
  );
  const merchRows = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM merchants
      WHERE id <> $1
        AND ((email IS NOT NULL AND email = $2)
             OR (wallet_address IS NOT NULL AND wallet_address = $3))
        AND created_at >= NOW() - INTERVAL '24 hours'`,
    [actor.id, actor.email, actor.wallet_address],
  );
  const u = userRows ? parseInt(userRows.c, 10) : 0;
  const m = merchRows ? parseInt(merchRows.c, 10) : 0;
  return u + m;
}

async function countSharedWallet(actor: ActorRow): Promise<number> {
  if (!actor.wallet_address) return 0;
  const u = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM users
      WHERE wallet_address = $1 AND id <> $2`,
    [actor.wallet_address, actor.id],
  );
  const m = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM merchants
      WHERE wallet_address = $1 AND id <> $2`,
    [actor.wallet_address, actor.id],
  );
  return (u ? parseInt(u.c, 10) : 0) + (m ? parseInt(m.c, 10) : 0);
}

/**
 * Walk up the referrer chain from the actor, counting hops within a 1-hour
 * temporal window. Stops at depth 5 to bound the BFS.
 */
async function computeChainDepth(actor: ActorRow): Promise<number> {
  let depth = 0;
  let cursorType: ActorType | null = null;
  let cursorId: string | null = null;

  if (actor.referred_by_user_id) { cursorType = 'user'; cursorId = actor.referred_by_user_id; }
  else if (actor.referred_by_merchant_id) { cursorType = 'merchant'; cursorId = actor.referred_by_merchant_id; }

  const seen = new Set<string>();
  while (cursorId && cursorType && depth < 5) {
    const key = `${cursorType}:${cursorId}`;
    if (seen.has(key)) break;  // defensive — cycles shouldn't exist but bound regardless
    seen.add(key);
    depth += 1;

    const table = cursorType === 'merchant' ? 'merchants' : 'users';
    const parent = await queryOne<{
      referred_by_user_id: string | null;
      referred_by_merchant_id: string | null;
      created_at: string;
    }>(
      `SELECT referred_by_user_id, referred_by_merchant_id, created_at::text AS created_at
         FROM ${table} WHERE id = $1`,
      [cursorId],
    );
    if (!parent) break;

    // Window guard: only count parents created within 1h of the actor.
    if (actor.waitlist_joined_at) {
      const dt = Math.abs(Date.parse(actor.waitlist_joined_at) - Date.parse(parent.created_at));
      if (dt > 3_600_000) break;
    }

    if (parent.referred_by_user_id) { cursorType = 'user'; cursorId = parent.referred_by_user_id; }
    else if (parent.referred_by_merchant_id) { cursorType = 'merchant'; cursorId = parent.referred_by_merchant_id; }
    else { cursorId = null; }
  }
  return depth;
}

async function persist(
  actorType: ActorType,
  actorId: string,
  result: ThreatScoreResult,
): Promise<void> {
  await query(
    `INSERT INTO risk_profiles (
        entity_id, entity_type,
        wl_score, wl_label, wl_hypothesis, wl_hypothesis_conf, wl_confidence,
        wl_by_category, wl_signals, wl_tier1_flags,
        wl_tier3_anomaly, wl_community_id, wl_model_version,
        wl_per_hypothesis, wl_hypothesis_margin, wl_hypothesis_contributors,
        wl_recalc_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
               $11, $12, $13, $14::jsonb, $15, $16::jsonb, NOW())
     ON CONFLICT (entity_id) DO UPDATE SET
        wl_score                    = EXCLUDED.wl_score,
        wl_label                    = EXCLUDED.wl_label,
        wl_hypothesis               = EXCLUDED.wl_hypothesis,
        wl_hypothesis_conf          = EXCLUDED.wl_hypothesis_conf,
        wl_confidence               = EXCLUDED.wl_confidence,
        wl_by_category              = EXCLUDED.wl_by_category,
        wl_signals                  = EXCLUDED.wl_signals,
        wl_tier1_flags              = EXCLUDED.wl_tier1_flags,
        wl_tier3_anomaly            = EXCLUDED.wl_tier3_anomaly,
        wl_community_id             = EXCLUDED.wl_community_id,
        wl_model_version            = EXCLUDED.wl_model_version,
        wl_per_hypothesis           = EXCLUDED.wl_per_hypothesis,
        wl_hypothesis_margin        = EXCLUDED.wl_hypothesis_margin,
        wl_hypothesis_contributors  = EXCLUDED.wl_hypothesis_contributors,
        wl_recalc_at                = NOW()`,
    [
      actorId, actorType,
      result.score, result.label, result.hypothesis, result.hypothesis_confidence, result.confidence,
      JSON.stringify(result.by_category),
      JSON.stringify(result.signals),
      JSON.stringify(result.tier1_flags),
      result.tier3_anomaly, result.community_id, result.model_version,
      JSON.stringify(result.per_hypothesis),
      result.hypothesis_margin,
      JSON.stringify(result.hypothesis_contributors),
    ],
  );
}
