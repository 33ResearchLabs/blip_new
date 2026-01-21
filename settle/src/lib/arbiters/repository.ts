/**
 * Arbiter Repository
 *
 * Database operations for the reputation-based arbiter system.
 */

import { query } from '@/lib/db';
import {
  Arbiter,
  ArbiterVote,
  DisputeArbitration,
  ARBITER_REQUIREMENTS,
  REPUTATION_WEIGHTS,
  ARBITER_PENALTIES,
  VOTING_CONFIG,
  calculateVoteWeight,
} from './types';

/**
 * Initialize arbiter tables
 */
export async function initializeArbiterTables(): Promise<void> {
  // Arbiters table
  await query(`
    CREATE TABLE IF NOT EXISTS arbiters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      wallet_address VARCHAR(64) NOT NULL,

      -- Reputation metrics
      reputation_score INTEGER DEFAULT 0,
      total_trades INTEGER DEFAULT 0,
      successful_arbitrations INTEGER DEFAULT 0,
      total_arbitrations INTEGER DEFAULT 0,
      accuracy_rate DECIMAL(5,2) DEFAULT 0,

      -- Staking
      staked_amount DECIMAL(18,6) DEFAULT 0,
      stake_locked_until TIMESTAMPTZ,

      -- Status
      is_active BOOLEAN DEFAULT true,
      is_eligible BOOLEAN DEFAULT false,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      last_active_at TIMESTAMPTZ DEFAULT NOW(),

      -- Penalties
      consecutive_wrong_votes INTEGER DEFAULT 0,
      cooldown_until TIMESTAMPTZ,

      UNIQUE(user_id),
      UNIQUE(wallet_address)
    )
  `);

  // Dispute arbitrations table
  await query(`
    CREATE TABLE IF NOT EXISTS dispute_arbitrations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      dispute_id UUID NOT NULL,
      order_id UUID NOT NULL,

      -- Panel config
      required_votes INTEGER DEFAULT 5,
      threshold INTEGER DEFAULT 3,

      -- Status
      status VARCHAR(20) DEFAULT 'pending_assignment',

      -- Vote counts
      total_votes INTEGER DEFAULT 0,
      user_votes INTEGER DEFAULT 0,
      merchant_votes INTEGER DEFAULT 0,
      split_votes INTEGER DEFAULT 0,

      -- Weighted totals
      user_vote_weight DECIMAL(10,2) DEFAULT 0,
      merchant_vote_weight DECIMAL(10,2) DEFAULT 0,
      split_vote_weight DECIMAL(10,2) DEFAULT 0,

      -- Outcome
      final_decision VARCHAR(10),
      decided_at TIMESTAMPTZ,

      -- Timing
      created_at TIMESTAMPTZ DEFAULT NOW(),
      voting_deadline TIMESTAMPTZ,

      UNIQUE(dispute_id)
    )
  `);

  // Arbiter votes table
  await query(`
    CREATE TABLE IF NOT EXISTS arbiter_votes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      arbitration_id UUID REFERENCES dispute_arbitrations(id) ON DELETE CASCADE,
      arbiter_id UUID REFERENCES arbiters(id) ON DELETE CASCADE,

      -- Vote
      vote VARCHAR(10),
      vote_weight DECIMAL(5,2) DEFAULT 1,
      reasoning TEXT,
      evidence_reviewed BOOLEAN DEFAULT false,

      -- Timing
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      voted_at TIMESTAMPTZ,
      deadline TIMESTAMPTZ,

      -- Outcome
      matched_majority BOOLEAN,
      reward_earned DECIMAL(18,6) DEFAULT 0,
      penalty_applied DECIMAL(18,6) DEFAULT 0,

      UNIQUE(arbitration_id, arbiter_id)
    )
  `);

  // Add reputation_score column to users if not exists
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS reputation_score INTEGER DEFAULT 0
  `).catch(() => {});

  console.log('[Arbiters] Tables initialized');
}

/**
 * Get or create arbiter profile for a user
 */
export async function getOrCreateArbiter(userId: string, walletAddress: string): Promise<Arbiter | null> {
  // Check if arbiter exists
  const existing = await query(
    `SELECT * FROM arbiters WHERE user_id = $1`,
    [userId]
  );

  if (existing.length > 0) {
    return existing[0] as Arbiter;
  }

  // Get user stats
  const userStats = await query(
    `SELECT
      u.id,
      u.wallet_address,
      u.total_trades,
      u.rating,
      u.created_at,
      COALESCE(u.reputation_score, 0) as reputation_score
    FROM users u
    WHERE u.id = $1`,
    [userId]
  );

  if (userStats.length === 0) {
    return null;
  }

  const user = userStats[0] as {
    total_trades: number;
    rating: number;
    created_at: Date;
    reputation_score: number;
  };

  // Calculate initial reputation
  const initialRep = calculateInitialReputation(user);

  // Check eligibility
  const accountAgeDays = Math.floor(
    (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  const isEligible =
    user.total_trades >= ARBITER_REQUIREMENTS.MIN_TRADES &&
    accountAgeDays >= ARBITER_REQUIREMENTS.MIN_ACCOUNT_AGE_DAYS &&
    user.rating >= ARBITER_REQUIREMENTS.MIN_RATING;

  // Create arbiter
  const result = await query(
    `INSERT INTO arbiters (user_id, wallet_address, reputation_score, total_trades, is_eligible)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, walletAddress, initialRep, user.total_trades, isEligible]
  );

  return result[0] as Arbiter;
}

/**
 * Calculate initial reputation from user history
 */
function calculateInitialReputation(user: {
  total_trades: number;
  rating: number;
  created_at: Date;
}): number {
  let rep = 0;

  // Trades
  rep += user.total_trades * REPUTATION_WEIGHTS.TRADE_COMPLETED;

  // Rating bonus (if above 4.0)
  if (user.rating >= 4.0) {
    rep += Math.floor((user.rating - 4.0) * 20);
  }

  // Account age
  const monthsOld = Math.floor(
    (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30)
  );
  rep += monthsOld * REPUTATION_WEIGHTS.ACCOUNT_AGE_PER_MONTH;

  return Math.min(rep, 500); // Cap initial rep at 500
}

/**
 * Get eligible arbiters for dispute assignment
 */
export async function getEligibleArbiters(
  excludeUserIds: string[],
  limit: number = 20
): Promise<Arbiter[]> {
  const placeholders = excludeUserIds.map((_, i) => `$${i + 1}`).join(',');

  const result = await query(
    `SELECT * FROM arbiters
     WHERE is_active = true
       AND is_eligible = true
       AND (cooldown_until IS NULL OR cooldown_until < NOW())
       ${excludeUserIds.length > 0 ? `AND user_id NOT IN (${placeholders})` : ''}
     ORDER BY reputation_score DESC, accuracy_rate DESC
     LIMIT $${excludeUserIds.length + 1}`,
    [...excludeUserIds, limit]
  );

  return result as Arbiter[];
}

/**
 * Select arbiters for a dispute using weighted random selection
 */
export async function selectArbitersForDispute(
  disputeId: string,
  orderId: string,
  excludeUserIds: string[]
): Promise<{ arbitration: DisputeArbitration; selectedArbiters: Arbiter[] }> {
  // Get eligible arbiters
  const eligibleArbiters = await getEligibleArbiters(excludeUserIds, 50);

  if (eligibleArbiters.length < VOTING_CONFIG.PANEL_SIZE) {
    throw new Error(`Not enough eligible arbiters. Need ${VOTING_CONFIG.PANEL_SIZE}, have ${eligibleArbiters.length}`);
  }

  // Weighted random selection
  const selected = weightedRandomSelect(eligibleArbiters, VOTING_CONFIG.PANEL_SIZE);

  // Create arbitration record
  const votingDeadline = new Date(Date.now() + VOTING_CONFIG.VOTING_PERIOD_HOURS * 60 * 60 * 1000);

  const arbitrationResult = await query(
    `INSERT INTO dispute_arbitrations
     (dispute_id, order_id, required_votes, threshold, status, voting_deadline)
     VALUES ($1, $2, $3, $4, 'voting', $5)
     RETURNING *`,
    [disputeId, orderId, VOTING_CONFIG.PANEL_SIZE, VOTING_CONFIG.MAJORITY_THRESHOLD, votingDeadline]
  );

  const arbitration = arbitrationResult[0] as DisputeArbitration;

  // Assign arbiters
  for (const arbiter of selected) {
    const weight = calculateVoteWeight(arbiter);
    await query(
      `INSERT INTO arbiter_votes (arbitration_id, arbiter_id, vote_weight, deadline)
       VALUES ($1, $2, $3, $4)`,
      [arbitration.id, arbiter.id, weight, votingDeadline]
    );
  }

  // Update dispute status
  await query(
    `UPDATE disputes SET status = 'investigating'::dispute_status WHERE order_id = $1`,
    [orderId]
  );

  return { arbitration, selectedArbiters: selected };
}

/**
 * Weighted random selection of arbiters
 */
function weightedRandomSelect(arbiters: Arbiter[], count: number): Arbiter[] {
  const selected: Arbiter[] = [];
  const remaining = [...arbiters];

  while (selected.length < count && remaining.length > 0) {
    // Calculate total weight
    const totalWeight = remaining.reduce((sum, a) => sum + calculateVoteWeight(a), 0);

    // Random selection based on weight
    let random = Math.random() * totalWeight;
    let selectedIndex = 0;

    for (let i = 0; i < remaining.length; i++) {
      random -= calculateVoteWeight(remaining[i]);
      if (random <= 0) {
        selectedIndex = i;
        break;
      }
    }

    selected.push(remaining[selectedIndex]);
    remaining.splice(selectedIndex, 1);
  }

  return selected;
}

/**
 * Submit arbiter vote
 */
export async function submitArbiterVote(
  arbitrationId: string,
  arbiterId: string,
  vote: 'user' | 'merchant' | 'split',
  reasoning: string
): Promise<{ success: boolean; error?: string }> {
  // Validate reasoning length
  if (reasoning.length < VOTING_CONFIG.MIN_REASONING_LENGTH) {
    return {
      success: false,
      error: `Reasoning must be at least ${VOTING_CONFIG.MIN_REASONING_LENGTH} characters`,
    };
  }

  // Check if vote exists and is still open
  const voteRecord = await query(
    `SELECT av.*, da.status, da.voting_deadline
     FROM arbiter_votes av
     JOIN dispute_arbitrations da ON av.arbitration_id = da.id
     WHERE av.arbitration_id = $1 AND av.arbiter_id = $2`,
    [arbitrationId, arbiterId]
  );

  if (voteRecord.length === 0) {
    return { success: false, error: 'Vote assignment not found' };
  }

  const record = voteRecord[0] as {
    voted_at: Date | null;
    status: string;
    voting_deadline: Date;
    vote_weight: number;
  };

  if (record.voted_at) {
    return { success: false, error: 'Already voted' };
  }

  if (record.status !== 'voting') {
    return { success: false, error: 'Voting has ended' };
  }

  if (new Date(record.voting_deadline) < new Date()) {
    return { success: false, error: 'Voting deadline passed' };
  }

  // Submit vote
  await query(
    `UPDATE arbiter_votes
     SET vote = $1, reasoning = $2, voted_at = NOW(), evidence_reviewed = true
     WHERE arbitration_id = $3 AND arbiter_id = $4`,
    [vote, reasoning, arbitrationId, arbiterId]
  );

  // Update vote counts
  const voteColumn = `${vote}_votes`;
  const weightColumn = `${vote}_vote_weight`;

  await query(
    `UPDATE dispute_arbitrations
     SET total_votes = total_votes + 1,
         ${voteColumn} = ${voteColumn} + 1,
         ${weightColumn} = ${weightColumn} + $1
     WHERE id = $2`,
    [record.vote_weight, arbitrationId]
  );

  // Update arbiter last active
  await query(
    `UPDATE arbiters SET last_active_at = NOW() WHERE id = $1`,
    [arbiterId]
  );

  // Check if we have enough votes to conclude
  await checkAndConcludeArbitration(arbitrationId);

  return { success: true };
}

/**
 * Check if arbitration can be concluded and process outcome
 */
export async function checkAndConcludeArbitration(arbitrationId: string): Promise<void> {
  const arbitration = await query(
    `SELECT * FROM dispute_arbitrations WHERE id = $1`,
    [arbitrationId]
  );

  if (arbitration.length === 0) return;

  const arb = arbitration[0] as DisputeArbitration;

  if (arb.status !== 'voting') return;

  // Check if we have majority
  const maxVotes = Math.max(arb.user_votes, arb.merchant_votes, arb.split_votes);

  if (maxVotes >= arb.threshold) {
    // Determine winner
    let decision: 'user' | 'merchant' | 'split';
    if (arb.user_votes >= arb.threshold) decision = 'user';
    else if (arb.merchant_votes >= arb.threshold) decision = 'merchant';
    else decision = 'split';

    await concludeArbitration(arbitrationId, decision);
  } else if (arb.total_votes >= arb.required_votes) {
    // All votes in, use weighted totals
    const maxWeight = Math.max(
      arb.user_vote_weight,
      arb.merchant_vote_weight,
      arb.split_vote_weight
    );

    let decision: 'user' | 'merchant' | 'split';
    if (arb.user_vote_weight === maxWeight) decision = 'user';
    else if (arb.merchant_vote_weight === maxWeight) decision = 'merchant';
    else decision = 'split';

    await concludeArbitration(arbitrationId, decision);
  }
}

/**
 * Conclude arbitration and update reputation
 */
async function concludeArbitration(
  arbitrationId: string,
  decision: 'user' | 'merchant' | 'split'
): Promise<void> {
  // Update arbitration
  await query(
    `UPDATE dispute_arbitrations
     SET status = 'concluded', final_decision = $1, decided_at = NOW()
     WHERE id = $2`,
    [decision, arbitrationId]
  );

  // Get all votes
  const votes = await query(
    `SELECT * FROM arbiter_votes WHERE arbitration_id = $1`,
    [arbitrationId]
  );

  // Update each arbiter's reputation
  for (const vote of votes as ArbiterVote[]) {
    const matchedMajority = vote.vote === decision;

    // Update vote record
    await query(
      `UPDATE arbiter_votes
       SET matched_majority = $1
       WHERE id = $2`,
      [matchedMajority, vote.id]
    );

    // Update arbiter reputation
    if (matchedMajority) {
      await query(
        `UPDATE arbiters
         SET reputation_score = reputation_score + $1,
             successful_arbitrations = successful_arbitrations + 1,
             total_arbitrations = total_arbitrations + 1,
             consecutive_wrong_votes = 0,
             accuracy_rate = (successful_arbitrations + 1)::decimal / (total_arbitrations + 1) * 100
         WHERE id = $2`,
        [REPUTATION_WEIGHTS.CORRECT_VOTE, vote.arbiter_id]
      );
    } else if (vote.voted_at) {
      // Voted but wrong
      await query(
        `UPDATE arbiters
         SET reputation_score = GREATEST(0, reputation_score + $1),
             total_arbitrations = total_arbitrations + 1,
             consecutive_wrong_votes = consecutive_wrong_votes + 1,
             accuracy_rate = successful_arbitrations::decimal / (total_arbitrations + 1) * 100
         WHERE id = $2`,
        [REPUTATION_WEIGHTS.WRONG_VOTE, vote.arbiter_id]
      );

      // Check for cooldown
      const arbiter = await query(
        `SELECT consecutive_wrong_votes FROM arbiters WHERE id = $1`,
        [vote.arbiter_id]
      );

      const arbiterData = arbiter[0] as { consecutive_wrong_votes: number } | undefined;
      if (arbiter.length > 0 && arbiterData && arbiterData.consecutive_wrong_votes >= ARBITER_PENALTIES.WRONG_VOTE_STREAK_LIMIT) {
        const cooldownEnd = new Date(Date.now() + ARBITER_PENALTIES.COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
        await query(
          `UPDATE arbiters SET cooldown_until = $1 WHERE id = $2`,
          [cooldownEnd, vote.arbiter_id]
        );
      }
    } else {
      // Didn't vote
      await query(
        `UPDATE arbiters
         SET reputation_score = GREATEST(0, reputation_score + $1),
             total_arbitrations = total_arbitrations + 1
         WHERE id = $2`,
        [ARBITER_PENALTIES.MISSED_VOTE_PENALTY, vote.arbiter_id]
      );
    }
  }

  // Get arbitration details to update dispute
  const arbDetails = await query(
    `SELECT order_id FROM dispute_arbitrations WHERE id = $1`,
    [arbitrationId]
  );

  if (arbDetails.length > 0) {
    const arbDetailData = arbDetails[0] as { order_id: string };
    const orderId = arbDetailData.order_id;

    // Update dispute with resolution
    await query(
      `UPDATE disputes
       SET status = 'resolved'::dispute_status,
           proposed_resolution = $1,
           resolved_at = NOW(),
           resolution_notes = 'Resolved by arbiter panel vote'
       WHERE order_id = $2`,
      [decision, orderId]
    );
  }
}

/**
 * Get arbiter's pending votes
 */
export async function getArbiterPendingVotes(arbiterId: string): Promise<ArbiterVote[]> {
  const result = await query(
    `SELECT av.*, da.order_id, da.voting_deadline
     FROM arbiter_votes av
     JOIN dispute_arbitrations da ON av.arbitration_id = da.id
     WHERE av.arbiter_id = $1
       AND av.voted_at IS NULL
       AND da.status = 'voting'
       AND da.voting_deadline > NOW()
     ORDER BY da.voting_deadline ASC`,
    [arbiterId]
  );

  return result as ArbiterVote[];
}

/**
 * Get arbitration details with votes
 */
export async function getArbitrationDetails(arbitrationId: string): Promise<{
  arbitration: DisputeArbitration;
  votes: ArbiterVote[];
} | null> {
  const arbitration = await query(
    `SELECT * FROM dispute_arbitrations WHERE id = $1`,
    [arbitrationId]
  );

  if (arbitration.length === 0) return null;

  const votes = await query(
    `SELECT av.*, a.reputation_score, a.accuracy_rate
     FROM arbiter_votes av
     JOIN arbiters a ON av.arbiter_id = a.id
     WHERE av.arbitration_id = $1`,
    [arbitrationId]
  );

  return {
    arbitration: arbitration[0] as DisputeArbitration,
    votes: votes as ArbiterVote[],
  };
}

/**
 * Get arbiter leaderboard
 */
export async function getArbiterLeaderboard(limit: number = 20): Promise<Arbiter[]> {
  const result = await query(
    `SELECT * FROM arbiters
     WHERE is_active = true
     ORDER BY reputation_score DESC, accuracy_rate DESC
     LIMIT $1`,
    [limit]
  );

  return result as Arbiter[];
}
