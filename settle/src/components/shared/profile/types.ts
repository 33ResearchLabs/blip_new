// Shared types for the public counterparty profile (page on mobile, modal on
// desktop). The /api/profile/[entityType]/[id] route returns ProfileData; both
// the route and the CounterpartyProfile UI import from here.

export type ProfileEntityType = "user" | "merchant";

export type TrustBand = "Bad" | "Fair" | "Good" | "Excellent";
export type RiskLevel = "Low" | "Medium" | "High";
export type SecurityLevel = "Low" | "Medium" | "High";

export interface ProfileReview {
  id: string;
  rating: number; // 1-5
  text: string | null;
  authorName: string;
  authorAvatar: string | null;
  createdAt: string; // ISO
}

export interface ProfileSocialLink {
  handle: string;
  verified: boolean;
}

export interface ProfileData {
  entityType: ProfileEntityType;
  id: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  /** Blue verified tick next to the name (identity verified). */
  verified: boolean;
  /** Reputation tier key, e.g. "gold". */
  tier: string;
  /** Display label, e.g. "Gold Trader". */
  tierLabel: string;
  memberSince: string; // ISO
  lastActive: string | null; // ISO
  isOnline: boolean;

  trust: {
    score: number; // 0-100 (mapped from internal 300-900)
    band: TrustBand;
  };

  verifications: {
    phone: boolean;
    email: boolean;
    liveness: boolean;
    x: boolean;
    securityLevel: SecurityLevel;
  };

  stats: {
    totalTrades: number;
    successRate: number; // %
    volumeUsd: number;
    avgTradeUsd: number;
  };

  reviews: {
    count: number;
    average: number; // 0-5
    recent: ProfileReview[];
  };

  risk: {
    level: RiskLevel;
    activeDisputes: number;
    fraudReports: number;
    successRate: number; // %
    accountAgeDays: number;
  };

  limits: {
    tierLabel: string;
    dailyUsd: number;
    perTradeUsd: number;
  };

  social: {
    x: ProfileSocialLink | null;
    telegram: ProfileSocialLink | null;
    discord: ProfileSocialLink | null;
  };
}

/** Map the internal 300-900 reputation score to the mockup's 0-100 trust score. */
export function toTrustScore100(internal: number): number {
  const v = Math.round(((internal - 300) / 600) * 100);
  return Math.max(0, Math.min(100, v));
}

export function trustBand(score100: number): TrustBand {
  if (score100 <= 25) return "Bad";
  if (score100 <= 50) return "Fair";
  if (score100 <= 75) return "Good";
  return "Excellent";
}
