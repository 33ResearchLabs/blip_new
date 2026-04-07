export interface ScoreBreakdown {
  [key: string]: { raw: number; weighted: number; weight: number };
}

export interface ReputationResult {
  entity_id: string;
  entity_type: 'merchant' | 'user';
  wallet_address: string | null;
  total_score: number;
  tier: string;
  badges: string[];
  breakdown: ScoreBreakdown;
  penalties: { type: string; points: number; count: number }[];
  abuse_flags: string[];
  wash_trading_detected: boolean;
  trade_count: number;
  cold_start: boolean;
  calculated_at: string;
}

export interface TradeRecord {
  amount_usd: number;
  status: string;
  created_at: Date;
  completed_at: Date | null;
  payment_sent_at: Date | null;
  counterparty: string | null;
  source: 'v1' | 'v2' | 'offchain';
  cancelled_by: string | null;
  disputed: boolean;
  dispute_lost: boolean;
  dispute_raised_by_user: boolean;
  was_refunded: boolean;
  timed_out: boolean;
}
