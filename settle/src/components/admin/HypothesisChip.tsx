'use client';

// Colored chip displaying the top fraud-hypothesis from the Bayesian
// classifier, plus its posterior confidence.
//
// Phase F polish:
//   * Margin-based NORMAL suppression — a strongly-NORMAL call (margin > 0.5)
//     renders as "—". A weakly-NORMAL call (margin < 0.2 — i.e. NORMAL only
//     narrowly beat a fraud hypothesis) renders as "NORMAL?" with an amber
//     tint so the admin notices the ambiguity.
//   * Non-NORMAL chips show a subtle dot when margin is low, hinting that
//     the call is contested.
//   * Tooltip includes the margin in addition to the posterior.

import type { ThreatHypothesis } from '@/lib/threat/types';

const HYPOTHESIS_CLASSES: Record<ThreatHypothesis, string> = {
  NORMAL:         'bg-zinc-500/10 text-zinc-400 border-zinc-700',
  BOT_FARM:       'bg-red-500/10 text-red-300 border-red-500/30',
  REFERRAL_RING:  'bg-orange-500/10 text-orange-300 border-orange-500/30',
  SANCTIONED:     'bg-purple-500/15 text-purple-200 border-purple-500/40',
  MONEY_MULE:     'bg-rose-500/10 text-rose-300 border-rose-500/30',
  IDENTITY_FRAUD: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30',
  LOW_QUALITY:    'bg-amber-500/10 text-amber-200 border-amber-500/30',
};

const HYPOTHESIS_LABEL: Record<ThreatHypothesis, string> = {
  NORMAL: 'Normal',
  BOT_FARM: 'Bot farm',
  REFERRAL_RING: 'Ref ring',
  SANCTIONED: 'Sanctioned',
  MONEY_MULE: 'Mule',
  IDENTITY_FRAUD: 'ID fraud',
  LOW_QUALITY: 'Low qual',
};

// Margin styling thresholds — also documented in HypothesisBreakdown.
const MARGIN_AMBIGUOUS = 0.20;
const MARGIN_CONFIDENT = 0.50;

const AMBIGUOUS_NORMAL_CLASS = 'bg-amber-500/10 text-amber-200 border-amber-500/30';

export function HypothesisChip({
  hypothesis,
  confidence,
  margin,
  forceShow = false,
}: {
  hypothesis: ThreatHypothesis | null | undefined;
  confidence: number | null | undefined;
  /** Phase F: top posterior − second-place. Drives ambiguity styling. */
  margin?: number | null | undefined;
  /** If true, show even when NORMAL is confident. Useful in the detail modal. */
  forceShow?: boolean;
}) {
  if (!hypothesis) return <span className="text-xs text-zinc-600">—</span>;

  const pct = confidence !== null && confidence !== undefined
    ? Math.round(confidence * 100)
    : null;
  const mPct = margin !== null && margin !== undefined ? Math.round(margin * 100) : null;
  const ambiguous = (margin ?? 1) < MARGIN_AMBIGUOUS;
  const confident = (margin ?? 0) > MARGIN_CONFIDENT;

  // NORMAL: suppress when confident. Surface with warning style when ambiguous.
  if (hypothesis === 'NORMAL' && !forceShow) {
    if (confident) return <span className="text-xs text-zinc-700">—</span>;
    if (ambiguous) {
      return (
        <span
          title={mPct !== null ? `Posterior ${pct}% · margin ${mPct}% (ambiguous — close call vs another hypothesis)` : undefined}
          className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider border rounded px-1.5 py-0.5 ${AMBIGUOUS_NORMAL_CLASS}`}
        >
          NORMAL?
          {pct !== null ? <span className="opacity-70">{pct}%</span> : null}
        </span>
      );
    }
    // Leaning but not strongly — fall through to the standard rendering.
  }

  const cls = HYPOTHESIS_CLASSES[hypothesis];
  const tooltip = pct !== null
    ? `Posterior ${pct}%${mPct !== null ? ` · margin ${mPct}%` : ''}`
    : undefined;
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider border rounded px-1.5 py-0.5 ${cls}`}
    >
      {/* Ambiguity dot — for non-NORMAL chips, hints when the call is contested. */}
      {ambiguous && hypothesis !== 'NORMAL' ? (
        <span
          className="inline-block w-1 h-1 rounded-full bg-amber-400"
          aria-label="ambiguous"
        />
      ) : null}
      {HYPOTHESIS_LABEL[hypothesis]}
      {pct !== null ? <span className="opacity-70">{pct}%</span> : null}
    </span>
  );
}
