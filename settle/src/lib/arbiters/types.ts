/**
 * Reputation-Based Arbiter System Types
 *
 * Arbiters are high-reputation users who can vote on disputes.
 * Selection is weighted by reputation score.
 */

export interface Arbiter {
  id: string;
  user_id: string;          // Reference to users table
  wallet_address: string;

  // Reputation metrics
  reputation_score: number;  // 0-1000 scale
  total_trades: number;      // Completed trades as user/merchant
  successful_arbitrations: number;
  total_arbitrations: number;
  accuracy_rate: number;     // % of votes matching majority

  // Staking (optional for higher weight)
  staked_amount: number;     // USDT staked
  stake_locked_until: Date | null;

  // Status
  is_active: boolean;
  is_eligible: boolean;      // Meets minimum requirements
  joined_at: Date;
  last_active_at: Date;

  // Penalties
  consecutive_wrong_votes: number;
  cooldown_until: Date | null;
}

export interface ArbiterVote {
  id: string;
  dispute_id: string;
  arbiter_id: string;

  // Vote
  vote: 'user' | 'merchant' | 'split';
  vote_weight: number;       // Based on reputation
  reasoning: string;         // Required explanation
  evidence_reviewed: boolean;

  // Timing
  assigned_at: Date;
  voted_at: Date | null;
  deadline: Date;            // Must vote before this

  // Outcome
  matched_majority: boolean | null;
  reward_earned: number;
  penalty_applied: number;
}

export interface DisputeArbitration {
  id: string;
  dispute_id: string;
  order_id: string;

  // Arbiter panel
  required_votes: number;    // e.g., 5
  threshold: number;         // e.g., 3 (majority)

  // Status
  status: 'pending_assignment' | 'voting' | 'concluded' | 'expired';

  // Votes
  total_votes: number;
  user_votes: number;
  merchant_votes: number;
  split_votes: number;

  // Weighted totals
  user_vote_weight: number;
  merchant_vote_weight: number;
  split_vote_weight: number;

  // Outcome
  final_decision: 'user' | 'merchant' | 'split' | null;
  decided_at: Date | null;

  // Timing
  created_at: Date;
  voting_deadline: Date;
}

// Eligibility requirements
export const ARBITER_REQUIREMENTS = {
  MIN_TRADES: 10,            // Minimum completed trades
  MIN_ACCOUNT_AGE_DAYS: 30,  // Account must be 30+ days old
  MIN_RATING: 4.0,           // Minimum average rating
  MIN_REPUTATION: 100,       // Minimum reputation score

  // Staking bonuses
  STAKE_BONUS_THRESHOLD: 100, // USDT to stake for bonus
  STAKE_WEIGHT_MULTIPLIER: 1.5, // 50% more voting weight if staked
};

// Reputation scoring
export const REPUTATION_WEIGHTS = {
  TRADE_COMPLETED: 5,        // +5 per completed trade
  TRADE_AS_MERCHANT: 3,      // +3 bonus for merchant trades
  POSITIVE_REVIEW: 2,        // +2 per 5-star review
  CORRECT_VOTE: 10,          // +10 for voting with majority
  WRONG_VOTE: -5,            // -5 for voting against majority
  STAKE_BONUS: 50,           // +50 for staking
  ACCOUNT_AGE_PER_MONTH: 2,  // +2 per month of account age
};

// Penalties
export const ARBITER_PENALTIES = {
  WRONG_VOTE_STREAK_LIMIT: 3, // 3 wrong votes = cooldown
  COOLDOWN_DAYS: 7,          // 7 day cooldown
  MISSED_VOTE_PENALTY: -20,  // -20 rep for not voting
  REPUTATION_FLOOR: 0,       // Can't go below 0
};

// Rewards
export const ARBITER_REWARDS = {
  BASE_REWARD_PERCENT: 0.5,  // 0.5% of disputed amount
  MAJORITY_BONUS: 1.2,       // 20% bonus for majority vote
  REPUTATION_BONUS_PER_100: 0.1, // +10% per 100 rep
};

// Voting configuration
export const VOTING_CONFIG = {
  PANEL_SIZE: 5,             // 5 arbiters per dispute
  MAJORITY_THRESHOLD: 3,     // 3/5 to decide
  VOTING_PERIOD_HOURS: 48,   // 48 hours to vote
  MIN_REASONING_LENGTH: 50,  // Minimum characters for reasoning
};

/**
 * Calculate arbiter's voting weight
 */
export function calculateVoteWeight(arbiter: Arbiter): number {
  let weight = 1.0;

  // Reputation bonus (up to 2x at 1000 rep)
  weight += (arbiter.reputation_score / 1000);

  // Accuracy bonus (up to 0.5x at 100% accuracy)
  weight += (arbiter.accuracy_rate / 200);

  // Stake bonus
  if (arbiter.staked_amount >= ARBITER_REQUIREMENTS.STAKE_BONUS_THRESHOLD) {
    weight *= ARBITER_REQUIREMENTS.STAKE_WEIGHT_MULTIPLIER;
  }

  // Trade volume bonus (up to 0.3x)
  weight += Math.min(arbiter.total_trades / 1000, 0.3);

  return Math.round(weight * 100) / 100;
}

/**
 * Check if user is eligible to become arbiter
 */
export function checkArbiterEligibility(user: {
  total_trades: number;
  created_at: Date;
  rating: number;
  reputation_score?: number;
}): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (user.total_trades < ARBITER_REQUIREMENTS.MIN_TRADES) {
    reasons.push(`Need ${ARBITER_REQUIREMENTS.MIN_TRADES} trades (have ${user.total_trades})`);
  }

  const accountAgeDays = Math.floor(
    (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (accountAgeDays < ARBITER_REQUIREMENTS.MIN_ACCOUNT_AGE_DAYS) {
    reasons.push(`Account must be ${ARBITER_REQUIREMENTS.MIN_ACCOUNT_AGE_DAYS} days old (${accountAgeDays} days)`);
  }

  if (user.rating < ARBITER_REQUIREMENTS.MIN_RATING) {
    reasons.push(`Need ${ARBITER_REQUIREMENTS.MIN_RATING}+ rating (have ${user.rating})`);
  }

  if ((user.reputation_score || 0) < ARBITER_REQUIREMENTS.MIN_REPUTATION) {
    reasons.push(`Need ${ARBITER_REQUIREMENTS.MIN_REPUTATION} reputation (have ${user.reputation_score || 0})`);
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}
