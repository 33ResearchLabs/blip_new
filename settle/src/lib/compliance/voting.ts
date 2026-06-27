/**
 * Compliance-officer dispute voting.
 *
 * A resolution passes when a STRICT MAJORITY (>50% — "51% plus") of the active
 * compliance officers vote the same outcome WITHIN the 4h window from when the
 * dispute was opened. After the window, the vote can no longer pass (use force,
 * or the on-chain 72h timeout refunds the seller). A single officer may "force"
 * a resolution to bypass the vote.
 */
import { query, queryOne } from '@/lib/db';

export const VOTE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
export type DisputeOutcome = 'user' | 'merchant' | 'split';

/** Count of active compliance officers (the voting denominator). */
export async function getActiveOfficerCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT (
        (SELECT COUNT(*) FROM compliance_team WHERE is_active = true)
      + (SELECT COUNT(*) FROM merchants WHERE has_compliance_access = true AND status = 'active')
     ) AS n`,
  );
  return Number(row?.n ?? 0);
}

/** Record (upsert) an officer's vote for a dispute outcome. */
export async function castVote(orderId: string, voterId: string, outcome: DisputeOutcome): Promise<void> {
  await query(
    `INSERT INTO compliance_dispute_votes (order_id, voter_id, outcome)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id, voter_id)
       DO UPDATE SET outcome = EXCLUDED.outcome, updated_at = NOW()`,
    [orderId, voterId, outcome],
  );
}

export interface VoteTally {
  totalOfficers: number;
  threshold: number;          // votes needed: floor(N/2)+1
  counts: Record<string, number>;
  deadline: Date | null;      // window close
  expired: boolean;
  passedOutcome: DisputeOutcome | null; // the outcome that reached majority in-window
}

/**
 * Tally votes for a dispute. `disputedAt` is the order's disputed_at (window
 * start). Only votes cast at/before the deadline count.
 */
export async function getVoteTally(orderId: string, disputedAt: Date | string | null): Promise<VoteTally> {
  const totalOfficers = await getActiveOfficerCount();
  const threshold = Math.floor(totalOfficers / 2) + 1; // strict majority
  const deadline = disputedAt ? new Date(new Date(disputedAt).getTime() + VOTE_WINDOW_MS) : null;
  const expired = deadline ? Date.now() > deadline.getTime() : false;

  const rows = await query<{ outcome: string; c: string }>(
    `SELECT outcome, COUNT(*) AS c
       FROM compliance_dispute_votes
      WHERE order_id = $1 ${deadline ? 'AND created_at <= $2' : ''}
      GROUP BY outcome`,
    deadline ? [orderId, deadline] : [orderId],
  );
  const counts: Record<string, number> = {};
  let passedOutcome: DisputeOutcome | null = null;
  for (const r of rows) {
    const n = Number(r.c);
    counts[r.outcome] = n;
    if (totalOfficers > 0 && n >= threshold && !expired) {
      passedOutcome = r.outcome as DisputeOutcome;
    }
  }
  return { totalOfficers, threshold, counts, deadline, expired, passedOutcome };
}
