/**
 * Reputation Module
 *
 * Exports all reputation-related functionality
 */

// Types
export * from './types';

// Calculator
export {
  calculateReputationScore,
  calculateReputationBreakdown,
  calculateBadges,
  calculateScoreChangeForEvent,
  type EntityStats,
} from './calculator';

// Repository
export {
  initializeReputationTables,
  getEntityStats,
  getReputationScore,
  updateReputationScore,
  getReputationWithBreakdown,
  recordReputationSnapshot,
  getReputationHistory,
  recordReputationEvent,
  getReputationEvents,
  getReputationLeaderboard,
  getEntityRank,
  recalculateAllScores,
  recordDailySnapshots,
} from './repository';
