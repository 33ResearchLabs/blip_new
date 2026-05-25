// GET /api/admin/waitlist/:actorType/:id/detail
//
// Composite per-actor detail used by the WaitlistDetailModal. Returns:
//   - actor:           full profile incl. merchant business fields
//   - referred_by:     who referred this actor (email/type/score/label)
//   - tasks:           full task list with status + points + completed_at
//   - referrals:       referrals this actor MADE (with each referee's own risk label)
//   - points_history:  last 50 entries from blip_point_log
//   - risk:            full ThreatScoreResult (signals + categories + tier1 flags)
//
// All fields are best-effort — if a sub-section fails to load, it returns
// empty/null and the rest of the payload still renders.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query, queryOne } from '@/lib/db';
import { getFullThreatProfile, recomputeAndPersist } from '@/lib/threat/service';
import type { ActorType, RiskLabel } from '@/lib/threat/types';

interface ActorPayload {
  id: string;
  actor_type: ActorType;
  email: string | null;
  email_verified: boolean | null;
  username: string | null;
  display_name: string | null;
  wallet_address: string | null;
  waitlist_status: string;
  waitlist_joined_at: string | null;
  waitlist_source: string | null;
  blip_points: number | null;
  referral_code: string | null;
  // Merchant-only fields (null for users)
  business_name: string | null;
  business_category: string | null;
  expected_monthly_volume_usd: number | null;
  country_code: string | null;
}

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ actorType: string; id: string }> },
) {
  const adminAuth = await requireAdminAuth(request);
  if (adminAuth) return adminAuth;

  const { actorType, id } = await context.params;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return NextResponse.json({ success: false, error: 'Invalid actor type' }, { status: 400 });
  }
  if (!UUID_RX.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  }
  const at: ActorType = actorType;

  const actor = await loadActor(at, id);
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  // Run all the sub-queries in parallel — they're independent.
  const [referredBy, tasks, referralsMade, pointsHistory, riskFromCache, community] = await Promise.all([
    loadReferredBy(actor).catch(() => null),
    loadTasks(at, id).catch(() => []),
    loadReferralsMade(at, id).catch(() => []),
    loadPointsHistory(at, id).catch(() => []),
    getFullThreatProfile(at, id).catch(() => null),
    loadCommunity(at, id).catch(() => null),
  ]);

  // If no threat profile exists yet, compute it now (synchronous fallback)
  // so the admin always sees risk data even for accounts that haven't been
  // touched since migration 137 deployed.
  let risk = riskFromCache;
  if (!risk) {
    try {
      risk = await recomputeAndPersist(at, id);
    } catch (err) {
      console.error('[admin/waitlist/detail] inline recompute failed', err);
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      actor,
      referred_by: referredBy,
      tasks,
      referrals: referralsMade,
      points_history: pointsHistory,
      risk,
      community,
    },
  });
}

interface CommunityPayload {
  community_id: string;
  anomaly_score: number;
  size: number;
  density: number;
  age_spread_seconds: number;
  unique_ips: number;
  unique_devices: number;
  last_computed_at: string;
  members: Array<{
    actor_id: string;
    actor_type: ActorType;
    email: string | null;
    display_name: string | null;
    risk_label: RiskLabel | null;
    risk_score: number | null;
    waitlist_joined_at: string | null;
  }>;
}

async function loadCommunity(at: ActorType, id: string): Promise<CommunityPayload | null> {
  const cm = await queryOne<{
    community_id: string;
    anomaly_score: number | string;
    community_size: number | string;
    community_density: number | string;
    age_spread_seconds: number | string;
    unique_ips: number | string;
    unique_devices: number | string;
    last_computed_at: string;
  }>(
    `SELECT community_id, anomaly_score, community_size, community_density,
            age_spread_seconds, unique_ips, unique_devices,
            last_computed_at::text AS last_computed_at
       FROM waitlist_community_membership
      WHERE actor_type = $1 AND actor_id = $2
      LIMIT 1`,
    [at, id],
  );
  if (!cm) return null;

  const num = (v: number | string): number => (typeof v === 'number' ? v : Number(v) || 0);

  // Member list — pull up to 20 other actors in this community for the
  // admin to spot-check the ring. Hydrate email / name / risk via joins
  // across users + merchants + risk_profiles.
  const members = await query<{
    actor_id: string;
    actor_type: ActorType;
    email: string | null;
    display_name: string | null;
    wl_label: RiskLabel | null;
    wl_score: number | null;
    waitlist_joined_at: string | null;
  }>(
    `SELECT
       m.actor_id, m.actor_type,
       COALESCE(u.email, mr.email) AS email,
       COALESCE(u.name, mr.display_name) AS display_name,
       rp.wl_label,
       rp.wl_score,
       COALESCE(u.waitlist_joined_at, mr.waitlist_joined_at)::text AS waitlist_joined_at
       FROM waitlist_community_membership m
       LEFT JOIN users     u  ON m.actor_type = 'user'     AND u.id  = m.actor_id
       LEFT JOIN merchants mr ON m.actor_type = 'merchant' AND mr.id = m.actor_id
       LEFT JOIN risk_profiles rp ON rp.entity_id = m.actor_id AND rp.entity_type = m.actor_type
      WHERE m.community_id = $1
      ORDER BY rp.wl_score DESC NULLS LAST, m.actor_id
      LIMIT 20`,
    [cm.community_id],
  );

  return {
    community_id: cm.community_id,
    anomaly_score: num(cm.anomaly_score),
    size: Math.round(num(cm.community_size)),
    density: num(cm.community_density),
    age_spread_seconds: Math.round(num(cm.age_spread_seconds)),
    unique_ips: Math.round(num(cm.unique_ips)),
    unique_devices: Math.round(num(cm.unique_devices)),
    last_computed_at: cm.last_computed_at,
    members: members.map(m => ({
      actor_id: m.actor_id,
      actor_type: m.actor_type,
      email: m.email,
      display_name: m.display_name,
      risk_label: m.wl_label,
      risk_score: m.wl_score,
      waitlist_joined_at: m.waitlist_joined_at,
    })),
  };
}

// ============================================================================
// Loaders
// ============================================================================

async function loadActor(at: ActorType, id: string): Promise<ActorPayload | null> {
  if (at === 'user') {
    const row = await queryOne<ActorPayload & { name: string | null }>(
      `SELECT id, 'user'::text AS actor_type,
              email, email_verified, username,
              name AS display_name,
              wallet_address,
              waitlist_status,
              waitlist_joined_at::text AS waitlist_joined_at,
              waitlist_source, blip_points, referral_code,
              NULL::text AS business_name,
              NULL::text AS business_category,
              NULL::numeric AS expected_monthly_volume_usd,
              NULL::text AS country_code
         FROM users WHERE id = $1`,
      [id],
    );
    return row ?? null;
  }
  const row = await queryOne<ActorPayload>(
    `SELECT id, 'merchant'::text AS actor_type,
            email, email_verified, username,
            display_name,
            wallet_address,
            waitlist_status,
            waitlist_joined_at::text AS waitlist_joined_at,
            waitlist_source, blip_points, referral_code,
            business_name, business_category,
            expected_monthly_volume_usd,
            country_code
       FROM merchants WHERE id = $1`,
    [id],
  );
  return row ?? null;
}

interface ReferredBy {
  id: string;
  type: ActorType;
  email: string | null;
  display_name: string | null;
  risk_label: RiskLabel | null;
  risk_score: number | null;
}

async function loadReferredBy(actor: ActorPayload): Promise<ReferredBy | null> {
  // The referee row stores its referrer in one of two columns depending on
  // referrer type. We fetched those columns when loading the actor row.
  const userRefRow = await queryOne<{ referred_by_user_id: string | null; referred_by_merchant_id: string | null }>(
    `SELECT referred_by_user_id, referred_by_merchant_id FROM ${actor.actor_type === 'merchant' ? 'merchants' : 'users'}
      WHERE id = $1`,
    [actor.id],
  );
  if (!userRefRow) return null;

  let type: ActorType | null = null;
  let id: string | null = null;
  if (userRefRow.referred_by_user_id) { type = 'user'; id = userRefRow.referred_by_user_id; }
  else if (userRefRow.referred_by_merchant_id) { type = 'merchant'; id = userRefRow.referred_by_merchant_id; }
  if (!type || !id) return null;

  const table = type === 'merchant' ? 'merchants' : 'users';
  const nameCol = type === 'merchant' ? 'display_name' : 'name';
  const profile = await queryOne<{
    id: string;
    email: string | null;
    display_name: string | null;
    wl_label: RiskLabel | null;
    wl_score: number | null;
  }>(
    `SELECT t.id, t.email, t.${nameCol} AS display_name,
            rp.wl_label, rp.wl_score
       FROM ${table} t
       LEFT JOIN risk_profiles rp ON rp.entity_id = t.id AND rp.entity_type = $2
      WHERE t.id = $1`,
    [id, type],
  );
  if (!profile) return null;
  return {
    id: profile.id, type,
    email: profile.email,
    display_name: profile.display_name,
    risk_label: profile.wl_label,
    risk_score: profile.wl_score,
  };
}

async function loadTasks(at: ActorType, id: string) {
  return query<{
    id: string;
    task_type: string;
    status: string;
    points_awarded: number;
    completed_at: string | null;
    created_at: string;
  }>(
    `SELECT id, task_type, status, points_awarded,
            completed_at::text AS completed_at,
            created_at::text AS created_at
       FROM waitlist_tasks
      WHERE actor_type = $1 AND actor_id = $2
      ORDER BY created_at DESC`,
    [at, id],
  );
}

async function loadReferralsMade(at: ActorType, id: string) {
  // Pull referees + their email/name + risk label via a per-row lateral join.
  return query<{
    referred_id: string;
    referred_type: ActorType;
    reward_status: string;
    reward_amount: number;
    created_at: string;
    referred_email: string | null;
    referred_display_name: string | null;
    referred_risk_label: RiskLabel | null;
    referred_risk_score: number | null;
  }>(
    `SELECT
        r.referred_id, r.referred_type, r.reward_status, r.reward_amount,
        r.created_at::text AS created_at,
        COALESCE(u.email, m.email) AS referred_email,
        COALESCE(u.name, m.display_name) AS referred_display_name,
        rp.wl_label AS referred_risk_label,
        rp.wl_score AS referred_risk_score
      FROM waitlist_referrals r
      LEFT JOIN users     u ON r.referred_type = 'user'     AND u.id = r.referred_id
      LEFT JOIN merchants m ON r.referred_type = 'merchant' AND m.id = r.referred_id
      LEFT JOIN risk_profiles rp ON rp.entity_id = r.referred_id AND rp.entity_type = r.referred_type
     WHERE r.referrer_type = $1 AND r.referrer_id = $2
     ORDER BY r.created_at DESC`,
    [at, id],
  );
}

async function loadPointsHistory(at: ActorType, id: string) {
  return query<{
    event: string;
    bonus_points: number;
    total_points: number | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>(
    `SELECT event, bonus_points, total_points, metadata,
            created_at::text AS created_at
       FROM blip_point_log
      WHERE actor_type = $1 AND actor_id = $2
      ORDER BY created_at DESC
      LIMIT 50`,
    [at, id],
  );
}
