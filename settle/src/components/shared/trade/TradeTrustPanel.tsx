"use client";

// Compact counterparty trust card for trade-flow surfaces (escrow-lock modal,
// buyer "escrow locked" screen). Fed by ProfileData from useCounterpartyProfile.
// Renders a 0-100 trust score badge plus KYC / trades / success-rate / account-
// age rows. Themed via the shared SurfaceTokens so it reads in user + merchant
// scopes; status/text/accent classes are global theme tokens. Degrades
// gracefully: shows a loader while fetching and renders nothing if there's no
// profile (e.g. broadcast order with no counterparty yet).

import type { ReactNode } from "react";
import {
  ShieldCheck,
  BadgeCheck,
  TrendingUp,
  Activity,
  Clock,
  Loader2,
} from "lucide-react";
import { formatCount, formatPercentage } from "@/lib/format";
import type { SurfaceTokens } from "@/components/shared/limits/types";
import type { ProfileData, TrustBand } from "@/components/shared/profile/types";

/** Trust-band → pill colors, using global status tokens. */
const BAND_PILL: Record<TrustBand, string> = {
  Bad: "bg-error-dim text-error",
  Fair: "bg-warning-dim text-warning",
  Good: "bg-success-dim text-success",
  Excellent: "bg-success-dim text-success",
};

function accountAgeLabel(days: number | null | undefined): string {
  if (!days || days < 1) return "New";
  if (days < 60) return `${formatCount(days)} days`;
  const months = Math.round(days / 30);
  if (months < 24) return `${formatCount(months)} months`;
  const years = Math.round(months / 12);
  return `${formatCount(years)} yr${years > 1 ? "s" : ""}`;
}

interface Props {
  /** e.g. "Buyer Trust" / "Seller Trust". */
  title: string;
  profile: ProfileData | null;
  loading: boolean;
  surfaces: SurfaceTokens;
  className?: string;
}

export function TradeTrustPanel({ title, profile, loading, surfaces, className = "" }: Props) {
  const card = `rounded-2xl border border-border-subtle ${surfaces.card} ${className}`;

  if (loading && !profile) {
    return (
      <div className={`${card} p-4 flex items-center gap-2`}>
        <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
        <span className="text-[13px] text-text-tertiary">Loading {title.toLowerCase()}…</span>
      </div>
    );
  }

  if (!profile) return null;

  const kyc = profile.verified || profile.verifications?.liveness;
  const rows: { icon: ReactNode; label: string }[] = [
    ...(kyc
      ? [{ icon: <BadgeCheck className="w-4 h-4 text-success" />, label: "KYC Verified" }]
      : []),
    {
      icon: <TrendingUp className="w-4 h-4 text-text-tertiary" />,
      label: `${formatCount(profile.stats.totalTrades)} Completed Trades`,
    },
    {
      icon: <Activity className="w-4 h-4 text-text-tertiary" />,
      label: `${formatPercentage(profile.stats.successRate)} Success Rate`,
    },
    {
      icon: <Clock className="w-4 h-4 text-text-tertiary" />,
      label: `Account Age: ${accountAgeLabel(profile.risk?.accountAgeDays)}`,
    },
  ];

  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 text-success shrink-0" />
          <span className="text-[14px] font-semibold text-text-primary truncate">{title}</span>
        </div>
        <span
          className={`text-[12px] font-bold px-2 py-0.5 rounded-full shrink-0 ${BAND_PILL[profile.trust.band]}`}
        >
          {formatCount(profile.trust.score)}/100
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            {r.icon}
            <span className="text-[13px] text-text-secondary">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
