// Builds the actor graph used by Tier 3 community detection.
//
// Node universe: every waitlisted actor (status='waitlisted') from users +
// merchants. Active / rejected actors are excluded — we only need
// community context for accounts the admin is still triaging.
//
// Edges (undirected, weighted):
//   * Referral (weight 1.0)           — waitlist_referrals
//   * Shared IP (weight 0.6)          — ip_logs grouped by ip (last 7d)
//   * Shared device fingerprint (0.9) — actor_device_fingerprints by fp_hash
//
// Multi-edges between the same pair are summed (max sensible upper bound
// enforced inside the propagation step to keep one heavy signal from
// monopolising consensus).

import { query } from '@/lib/db';
import type { ActorType } from '../types';

export interface NodeKey { id: string; type: ActorType }
export interface NodeMeta {
  /** Compact join timestamp (ms since epoch) for age-spread metrics. */
  joined_at_ms: number | null;
  /** Most recent signup IP — surfaced in community metrics. */
  signup_ip: string | null;
  /** Most recent device fingerprint hash. */
  fp_hash: string | null;
}

export interface Edge { from: string; to: string; weight: number; }

export interface ActorGraph {
  /** Canonical node key string: `${type}:${id}` */
  nodes: string[];
  meta: Map<string, NodeMeta>;
  /** Adjacency map: nodeKey → Map<neighborKey, summed weight>. Symmetric. */
  adj: Map<string, Map<string, number>>;
  /** Edge list (lower-half only; symmetric adjacency derived from this). */
  edges: Edge[];
}

const EDGE_WEIGHT_REFERRAL = 1.0;
const EDGE_WEIGHT_SHARED_IP = 0.6;
const EDGE_WEIGHT_SHARED_FP = 0.9;
const NODE_KEY_SEP = ':';

export function nodeKey(type: ActorType, id: string): string {
  return `${type}${NODE_KEY_SEP}${id}`;
}

export function parseNodeKey(key: string): NodeKey {
  const i = key.indexOf(NODE_KEY_SEP);
  return { type: key.slice(0, i) as ActorType, id: key.slice(i + 1) };
}

/**
 * Build the full graph. Single read-only DB pass per source. Errors in any
 * source surface as console warnings; the graph is still built from the
 * surviving sources so a missing optional table can never break the pipeline.
 */
export async function buildActorGraph(): Promise<ActorGraph> {
  // ---------- nodes ----------
  const meta = new Map<string, NodeMeta>();
  await loadActorMeta('user', meta);
  await loadActorMeta('merchant', meta);

  // ---------- edges ----------
  const edges: Edge[] = [];

  // Referral edges from waitlist_referrals (already directly persisted).
  try {
    const refRows = await query<{
      referrer_type: ActorType; referrer_id: string;
      referred_type: ActorType; referred_id: string;
    }>(
      `SELECT referrer_type, referrer_id, referred_type, referred_id
         FROM waitlist_referrals`,
    );
    for (const r of refRows) {
      const a = nodeKey(r.referrer_type, r.referrer_id);
      const b = nodeKey(r.referred_type, r.referred_id);
      // Skip if either endpoint isn't in our (waitlisted-only) node set.
      if (!meta.has(a) || !meta.has(b)) continue;
      edges.push({ from: a, to: b, weight: EDGE_WEIGHT_REFERRAL });
    }
  } catch (err) {
    console.warn('[threat/graph/builder] referral edge fetch failed', err);
  }

  // Shared-IP edges. Group ip_logs (last 7 days) by ip; emit pairwise edges
  // for every (a, b) within each group. Bound group sizes — a public NAT'd
  // IP shared by 1000 actors would generate ~500k edges; we cap at 50
  // members per IP group (taking the most recent rows) to keep the graph
  // tractable. Above the cap, the IP_CLUSTER signal already covers it.
  try {
    const ipRows = await query<{ entity_type: ActorType; entity_id: string; ip: string }>(
      `SELECT DISTINCT ON (entity_type, entity_id, ip)
              entity_type, entity_id, ip
         FROM ip_logs
        WHERE action = 'signup'
          AND created_at >= NOW() - INTERVAL '7 days'`,
    );
    const byIp = new Map<string, string[]>();
    for (const r of ipRows) {
      const k = nodeKey(r.entity_type, r.entity_id);
      if (!meta.has(k)) continue;
      let arr = byIp.get(r.ip);
      if (!arr) { arr = []; byIp.set(r.ip, arr); }
      if (arr.length < 50) arr.push(k);
    }
    for (const members of byIp.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          edges.push({ from: members[i], to: members[j], weight: EDGE_WEIGHT_SHARED_IP });
        }
      }
    }
  } catch (err) {
    console.warn('[threat/graph/builder] ip edge fetch failed', err);
  }

  // Shared-device-fingerprint edges. Same pattern as IP — pairwise within
  // each fp group, capped at 50.
  try {
    const fpRows = await query<{ actor_type: ActorType; actor_id: string; fp_hash: string }>(
      `SELECT actor_type, actor_id, fp_hash FROM actor_device_fingerprints`,
    );
    const byFp = new Map<string, string[]>();
    for (const r of fpRows) {
      const k = nodeKey(r.actor_type, r.actor_id);
      if (!meta.has(k)) continue;
      let arr = byFp.get(r.fp_hash);
      if (!arr) { arr = []; byFp.set(r.fp_hash, arr); }
      if (arr.length < 50) arr.push(k);
    }
    for (const members of byFp.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          edges.push({ from: members[i], to: members[j], weight: EDGE_WEIGHT_SHARED_FP });
        }
      }
    }
  } catch (err) {
    console.warn('[threat/graph/builder] fp edge fetch failed', err);
  }

  // ---------- adjacency ----------
  const adj = new Map<string, Map<string, number>>();
  for (const node of meta.keys()) adj.set(node, new Map());
  for (const e of edges) {
    addEdgeWeight(adj, e.from, e.to, e.weight);
    addEdgeWeight(adj, e.to, e.from, e.weight);
  }

  return {
    nodes: Array.from(meta.keys()),
    meta,
    adj,
    edges,
  };
}

function addEdgeWeight(adj: Map<string, Map<string, number>>, a: string, b: string, w: number) {
  const row = adj.get(a);
  if (!row) return;
  row.set(b, (row.get(b) ?? 0) + w);
}

async function loadActorMeta(type: ActorType, out: Map<string, NodeMeta>): Promise<void> {
  const table = type === 'merchant' ? 'merchants' : 'users';
  try {
    const rows = await query<{
      id: string;
      joined_at: string | null;
      signup_ip: string | null;
      fp_hash: string | null;
    }>(
      `SELECT t.id,
              t.waitlist_joined_at::text AS joined_at,
              (SELECT ip FROM ip_logs
                WHERE entity_id = t.id AND entity_type = $1 AND action = 'signup'
                ORDER BY created_at DESC LIMIT 1) AS signup_ip,
              (SELECT fp_hash FROM actor_device_fingerprints
                WHERE actor_id = t.id AND actor_type = $1
                ORDER BY captured_at DESC LIMIT 1) AS fp_hash
         FROM ${table} t
        WHERE t.waitlist_status = 'waitlisted'`,
      [type],
    );
    for (const r of rows) {
      out.set(nodeKey(type, r.id), {
        joined_at_ms: r.joined_at ? Date.parse(r.joined_at) : null,
        signup_ip: r.signup_ip,
        fp_hash: r.fp_hash,
      });
    }
  } catch (err) {
    console.error('[threat/graph/builder] node fetch failed', { type, err });
  }
}
