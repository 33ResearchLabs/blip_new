// Per-community metrics + per-actor anomaly score.
//
// Anomaly score intuition: a "suspicious" community has:
//   * many members (≥3)
//   * high density (most pairs share at least one signal)
//   * small age spread (signups clustered in time)
//   * few distinct IPs / devices (sharing infrastructure)
//
// Final score is a weighted combination of these axes, capped at 100.
// A solo node always scores 0 — no community context means no anomaly.

import { parseNodeKey, type ActorGraph } from './builder';
import type { CommunityAssignment } from './labelPropagation';

export interface CommunityMetrics {
  community_id: string;
  members: string[];
  size: number;
  density: number;            // 0..1, actual_edges / possible_edges
  age_spread_seconds: number; // max(joined_at) − min(joined_at)
  unique_ips: number;
  unique_devices: number;
}

export interface ActorAnomaly {
  actor_id: string;
  actor_type: 'user' | 'merchant';
  community_id: string;
  anomaly_score: number;
  community_size: number;
  community_density: number;
  age_spread_seconds: number;
  unique_ips: number;
  unique_devices: number;
}

const AGE_SPREAD_FAST_THRESHOLD_SEC = 60 * 60;   // <1h spread = "fast burst"
const AGE_SPREAD_SLOW_THRESHOLD_SEC = 30 * 86_400; // >30d = "slow & natural"
const SOLO_COMMUNITY_MIN_SIZE = 2;

export function computeAnomaly(
  graph: ActorGraph,
  assignment: CommunityAssignment,
): { perCommunity: CommunityMetrics[]; perActor: ActorAnomaly[] } {
  const perCommunity: CommunityMetrics[] = [];
  const perActor: ActorAnomaly[] = [];

  for (const [communityId, members] of assignment.byCommunity) {
    // Compute size + intra-community edges + IP/device distinctness.
    const size = members.length;
    const memberSet = new Set(members);

    let internalEdges = 0;
    const ips = new Set<string>();
    const devices = new Set<string>();
    let minJoined = Number.POSITIVE_INFINITY;
    let maxJoined = Number.NEGATIVE_INFINITY;

    for (const m of members) {
      const meta = graph.meta.get(m);
      if (meta) {
        if (meta.signup_ip) ips.add(meta.signup_ip);
        if (meta.fp_hash) devices.add(meta.fp_hash);
        if (meta.joined_at_ms !== null) {
          if (meta.joined_at_ms < minJoined) minJoined = meta.joined_at_ms;
          if (meta.joined_at_ms > maxJoined) maxJoined = meta.joined_at_ms;
        }
      }
      const neighbors = graph.adj.get(m);
      if (!neighbors) continue;
      for (const n2 of neighbors.keys()) {
        if (memberSet.has(n2) && n2 > m) internalEdges += 1;  // count each pair once
      }
    }

    const possibleEdges = size > 1 ? (size * (size - 1)) / 2 : 0;
    const density = possibleEdges > 0 ? internalEdges / possibleEdges : 0;
    const ageSpread = (minJoined !== Number.POSITIVE_INFINITY && maxJoined !== Number.NEGATIVE_INFINITY)
      ? Math.max(0, Math.floor((maxJoined - minJoined) / 1000))
      : 0;

    const cm: CommunityMetrics = {
      community_id: communityId,
      members,
      size,
      density,
      age_spread_seconds: ageSpread,
      unique_ips: ips.size,
      unique_devices: devices.size,
    };
    perCommunity.push(cm);

    // Anomaly score for each actor in the community.
    const score = scoreCommunity(cm);
    for (const m of members) {
      const { id, type } = parseNodeKey(m);
      perActor.push({
        actor_id: id,
        actor_type: type,
        community_id: communityId,
        anomaly_score: score,
        community_size: cm.size,
        community_density: cm.density,
        age_spread_seconds: cm.age_spread_seconds,
        unique_ips: cm.unique_ips,
        unique_devices: cm.unique_devices,
      });
    }
  }

  return { perCommunity, perActor };
}

/**
 * Returns 0..100. A solo community (size 1) always scores 0 — no community
 * context, no anomaly. Above that, score scales with size × density and
 * is amplified by infrastructure sharing + age-burst.
 */
function scoreCommunity(cm: CommunityMetrics): number {
  if (cm.size < SOLO_COMMUNITY_MIN_SIZE) return 0;

  // Base: density × log(size) component. Bounded so size=2 starts low and a
  // cluster of 20 with full density tops the base out around 60.
  const sizeFactor = Math.min(1, Math.log2(cm.size) / 5);   // size 2→0.2, 32→1
  const base = cm.density * sizeFactor * 100;

  // IP-diversity multiplier: fewer unique IPs per member → more suspicious.
  // ipShare = unique_ips / size. ipShare 1.0 → multiplier 1.0 (everyone has
  // their own IP), ipShare 0.1 → multiplier 1.5 (one IP per 10 accounts).
  const ipShare = cm.size > 0 ? Math.min(1, cm.unique_ips / cm.size) : 1;
  const ipMultiplier = 1 + (1 - ipShare) * 0.5;

  // Device-diversity multiplier: same logic, stronger weight because
  // device fingerprint sharing is rarer in genuine populations than IP
  // sharing (NATs are real; shared devices in a fraud ring are not).
  const deviceShare = cm.size > 0 ? Math.min(1, cm.unique_devices / cm.size) : 1;
  const deviceMultiplier = 1 + (1 - deviceShare) * 0.8;

  // Age-spread multiplier: tight cluster in time → multiplier > 1.
  // <1h → ×1.4, <24h → ×1.2, <30d → ×1.0, >30d → ×0.7 (natural community).
  let ageMultiplier: number;
  if (cm.age_spread_seconds < AGE_SPREAD_FAST_THRESHOLD_SEC) ageMultiplier = 1.4;
  else if (cm.age_spread_seconds < 86_400) ageMultiplier = 1.2;
  else if (cm.age_spread_seconds < AGE_SPREAD_SLOW_THRESHOLD_SEC) ageMultiplier = 1.0;
  else ageMultiplier = 0.7;

  const raw = base * ipMultiplier * deviceMultiplier * ageMultiplier;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
