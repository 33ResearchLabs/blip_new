// Weighted label-propagation community detection. Chosen over full Louvain
// because:
//   * O(N · k) per iteration vs Louvain's hierarchical multi-level passes
//   * Deterministic given the iteration order (we use lexicographic node IDs)
//   * For waitlist-scale graphs (≤ low-thousands of waitlisted accounts)
//     the propagation result is empirically very close to Louvain on the
//     fraud-ring case we care about
//   * Implements cleanly in ~60 lines with no external deps
//
// Algorithm:
//   1. Every node starts as its own community (label = node key).
//   2. For each pass (lexicographic order for determinism):
//        For each node, compute the weighted vote of each neighbouring
//        community's label. Pick the label with the highest total weight.
//        Ties broken by lower lexicographic label.
//   3. Repeat until either no node changes label this pass OR max-iterations.
//
// Edge weight saturation: when summing votes we cap any single neighbour's
// contribution at MAX_EDGE_VOTE_WEIGHT so a doubled-up edge (referral +
// shared FP between the same pair) doesn't drown out a wider consensus.

import type { ActorGraph } from './builder';

const MAX_ITERATIONS = 20;
const MAX_EDGE_VOTE_WEIGHT = 1.5;

export interface CommunityAssignment {
  /** nodeKey → community label (canonicalised). */
  byNode: Map<string, string>;
  /** community label → set of member nodeKeys. */
  byCommunity: Map<string, string[]>;
  iterations: number;
  converged: boolean;
}

export function detectCommunities(graph: ActorGraph): CommunityAssignment {
  const labels = new Map<string, string>();
  for (const n of graph.nodes) labels.set(n, n);

  // Stable iteration order for determinism.
  const order = graph.nodes.slice().sort();

  let iterations = 0;
  let converged = false;

  for (; iterations < MAX_ITERATIONS; iterations++) {
    let changed = false;

    for (const node of order) {
      const neighbors = graph.adj.get(node);
      if (!neighbors || neighbors.size === 0) continue;

      // Tally weighted votes per neighbour-label.
      const votes = new Map<string, number>();
      for (const [n2, weight] of neighbors) {
        const lbl = labels.get(n2);
        if (lbl === undefined) continue;
        const v = Math.min(MAX_EDGE_VOTE_WEIGHT, weight);
        votes.set(lbl, (votes.get(lbl) ?? 0) + v);
      }
      if (votes.size === 0) continue;

      // Pick winner: highest weight, tie-break by smaller lexicographic label.
      let bestLabel = labels.get(node)!;
      let bestWeight = -Infinity;
      for (const [lbl, w] of votes) {
        if (w > bestWeight || (w === bestWeight && lbl < bestLabel)) {
          bestLabel = lbl;
          bestWeight = w;
        }
      }

      if (bestLabel !== labels.get(node)) {
        labels.set(node, bestLabel);
        changed = true;
      }
    }

    if (!changed) { converged = true; break; }
  }

  // Group + canonicalise: each community's label = the lexicographically
  // smallest member key. This makes labels stable across runs even if the
  // intermediate propagation happened to converge on a different anchor.
  const grouped = new Map<string, string[]>();
  for (const [node, lbl] of labels) {
    let arr = grouped.get(lbl);
    if (!arr) { arr = []; grouped.set(lbl, arr); }
    arr.push(node);
  }

  const byCommunity = new Map<string, string[]>();
  const byNode = new Map<string, string>();
  for (const members of grouped.values()) {
    members.sort();
    const canonical = members[0];
    byCommunity.set(canonical, members);
    for (const m of members) byNode.set(m, canonical);
  }

  return { byNode, byCommunity, iterations: iterations + (converged ? 1 : 0), converged };
}
