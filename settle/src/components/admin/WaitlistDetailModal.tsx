'use client';

// Per-actor detail modal for /admin/waitlist. Five tabs:
//   1. Overview     — full profile, merchant business fields, referred-by, headline risk
//   2. Tasks        — every waitlist task with status + points + completed-at
//   3. Referrals    — referrals MADE by this actor (with each referee's risk label)
//   4. Points hist  — last 50 entries from blip_point_log
//   5. Risk Factors — per-category bars + full signal table + tier1 flags
//
// Activate / Reject buttons in the footer; on success, calls onAction so the
// parent page can refresh its list.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, Check, AlertTriangle, Mail, MapPin, Briefcase, Wallet, Clock, Award, TrendingUp, Network, Users } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { formatCount, formatFiat, formatRate } from '@/lib/format';
import { RiskBadge } from './RiskBadge';
import { HypothesisChip } from './HypothesisChip';
import type {
  ActorType, RiskLabel, ThreatHypothesis, Confidence,
  ThreatScoreResult, CategoryScores, Signal, Tier1Flag,
} from '@/lib/threat/types';

interface DetailPayload {
  actor: {
    id: string;
    actor_type: ActorType;
    email: string | null;
    email_verified: boolean | null;
    username: string | null;
    display_name: string | null;
    wallet_address: string | null;
    waitlist_status: string;
    waitlist_joined_at: string | null;
    waitlist_source: string | null;
    blip_points: number | null;
    referral_code: string | null;
    business_name: string | null;
    business_category: string | null;
    expected_monthly_volume_usd: number | null;
    country_code: string | null;
  };
  referred_by: {
    id: string;
    type: ActorType;
    email: string | null;
    display_name: string | null;
    risk_label: RiskLabel | null;
    risk_score: number | null;
  } | null;
  tasks: Array<{
    id: string;
    task_type: string;
    status: string;
    points_awarded: number;
    completed_at: string | null;
    created_at: string;
  }>;
  referrals: Array<{
    referred_id: string;
    referred_type: ActorType;
    reward_status: string;
    reward_amount: number;
    created_at: string;
    referred_email: string | null;
    referred_display_name: string | null;
    referred_risk_label: RiskLabel | null;
    referred_risk_score: number | null;
  }>;
  points_history: Array<{
    event: string;
    bonus_points: number;
    total_points: number | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>;
  risk: ThreatScoreResult | null;
  community: {
    community_id: string;
    anomaly_score: number;
    size: number;
    density: number;
    age_spread_seconds: number;
    unique_ips: number;
    unique_devices: number;
    last_computed_at: string;
    members: Array<{
      actor_id: string;
      actor_type: ActorType;
      email: string | null;
      display_name: string | null;
      risk_label: RiskLabel | null;
      risk_score: number | null;
      waitlist_joined_at: string | null;
    }>;
  } | null;
}

type Tab = 'overview' | 'tasks' | 'referrals' | 'points' | 'risk' | 'community';

export function WaitlistDetailModal({
  actorType,
  id,
  onClose,
  onAction,
}: {
  actorType: ActorType;
  id: string;
  onClose: () => void;
  onAction: () => void;
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [acting, setActing] = useState<'activate' | 'reject' | null>(null);
  const [confirm, setConfirm] = useState<{ action: 'activate' | 'reject'; reason: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/admin/waitlist/${actorType}/${id}/detail`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error ?? 'Failed to load detail');
        return;
      }
      setData(json.data as DetailPayload);
    } catch (err) {
      console.error('[WaitlistDetailModal] load failed', err);
      setError('Failed to load detail');
    } finally {
      setLoading(false);
    }
  }, [actorType, id]);

  useEffect(() => { void load(); }, [load]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = useCallback(async (action: 'activate' | 'reject') => {
    if (!data) return;
    // Activate on HIGH_RISK or CRITICAL → confirm. Reject on TRUSTED or CLEAN → confirm.
    const label = data.risk?.label ?? null;
    const needsConfirm =
      (action === 'activate' && (label === 'HIGH_RISK' || label === 'CRITICAL')) ||
      (action === 'reject'   && (label === 'TRUSTED'   || label === 'CLEAN'));
    if (needsConfirm && (!confirm || confirm.action !== action)) {
      const reason = action === 'activate'
        ? `This account is ${label}. Activate anyway?`
        : `This account is ${label}. Reject anyway?`;
      setConfirm({ action, reason });
      return;
    }
    setActing(action);
    try {
      const res = await fetchWithAuth(
        `/api/admin/waitlist/${actorType}/${id}/${action}`,
        { method: 'POST' },
      );
      const json = await res.json();
      if (json.success) {
        onAction();
        onClose();
      } else {
        setError(json.error ?? `Failed to ${action}`);
      }
    } catch (err) {
      console.error(`[WaitlistDetailModal] ${action} failed`, err);
      setError(`Failed to ${action}`);
    } finally {
      setActing(null);
      setConfirm(null);
    }
  }, [data, confirm, actorType, id, onAction, onClose]);

  const tabs: Array<{ key: Tab; label: string; count?: number }> = useMemo(() => [
    { key: 'overview',  label: 'Overview' },
    { key: 'tasks',     label: 'Tasks',     count: data?.tasks.length ?? 0 },
    { key: 'referrals', label: 'Referrals', count: data?.referrals.length ?? 0 },
    { key: 'points',    label: 'Points',    count: data?.points_history.length ?? 0 },
    { key: 'risk',      label: 'Risk Factors' },
    { key: 'community', label: 'Community', count: data?.community?.size },
  ], [data]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <Header data={data} loading={loading} onClose={onClose} />

        <div className="border-b border-zinc-800 px-6 flex gap-1 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2.5 text-xs uppercase tracking-wider border-b-2 ${
                tab === t.key
                  ? 'border-emerald-400 text-emerald-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
              {t.count !== undefined ? (
                <span className="ml-1.5 text-zinc-600 normal-case">({formatCount(t.count)})</span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="animate-spin text-zinc-500" size={28} />
            </div>
          )}
          {error && !loading && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{error}</div>
          )}
          {!loading && !error && data && (
            <>
              {tab === 'overview'  && <OverviewTab data={data} />}
              {tab === 'tasks'     && <TasksTab tasks={data.tasks} />}
              {tab === 'referrals' && <ReferralsTab referrals={data.referrals} />}
              {tab === 'points'    && <PointsTab history={data.points_history} />}
              {tab === 'risk'      && <RiskTab risk={data.risk} />}
              {tab === 'community' && <CommunityTab community={data.community} selfId={id} />}
            </>
          )}
        </div>

        <Footer
          data={data}
          acting={acting}
          confirm={confirm}
          onCancelConfirm={() => setConfirm(null)}
          onAct={act}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Header
// ============================================================================

function Header({ data, loading, onClose }: { data: DetailPayload | null; loading: boolean; onClose: () => void }) {
  const subtitle = data
    ? (data.actor.business_name ?? data.actor.display_name ?? data.actor.username ?? data.actor.email ?? '—')
    : '';
  return (
    <header className="px-6 py-4 border-b border-zinc-800 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
            {data?.actor.actor_type ?? '…'}
          </span>
          {data?.actor.email && (
            <span className="text-sm text-zinc-300 font-mono truncate">{data.actor.email}</span>
          )}
        </div>
        <h2 className="text-lg font-semibold text-zinc-100 truncate">{subtitle}</h2>
      </div>
      <div className="flex items-center gap-3">
        {!loading && data?.risk && (
          <>
            <RiskBadge
              label={data.risk.label}
              score={data.risk.score}
              confidence={data.risk.confidence}
              size="md"
            />
            <HypothesisChip
              hypothesis={data.risk.hypothesis}
              confidence={data.risk.hypothesis_confidence}
              margin={data.risk.hypothesis_margin}
              forceShow
            />
          </>
        )}
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label="Close">
          <X size={20} />
        </button>
      </div>
    </header>
  );
}

// ============================================================================
// Overview
// ============================================================================

function OverviewTab({ data }: { data: DetailPayload }) {
  const a = data.actor;
  const rows: Array<{ icon: typeof Mail; label: string; value: React.ReactNode }> = [
    { icon: Mail,      label: 'Email',           value: a.email ?? '—' },
    { icon: Mail,      label: 'Email verified',  value: a.email_verified ? 'Yes' : 'No' },
    { icon: Wallet,    label: 'Wallet',          value: a.wallet_address
                                                    ? <span className="font-mono text-xs break-all">{a.wallet_address}</span>
                                                    : '—' },
    { icon: Clock,     label: 'Joined',          value: a.waitlist_joined_at
                                                    ? new Date(a.waitlist_joined_at).toLocaleString('en-US')
                                                    : '—' },
    { icon: MapPin,    label: 'Source',          value: a.waitlist_source ?? '—' },
    { icon: Award,     label: 'BLIP points',     value: formatCount(a.blip_points ?? 0) },
    { icon: Network,   label: 'Referral code',   value: a.referral_code
                                                    ? <code className="font-mono text-xs bg-zinc-900 px-1.5 py-0.5 rounded">{a.referral_code}</code>
                                                    : '—' },
  ];
  if (a.actor_type === 'merchant') {
    rows.push(
      { icon: Briefcase, label: 'Business name',     value: a.business_name ?? '—' },
      { icon: Briefcase, label: 'Business category', value: a.business_category ?? '—' },
      { icon: TrendingUp,label: 'Expected monthly',  value: a.expected_monthly_volume_usd !== null
                                                          ? formatFiat(a.expected_monthly_volume_usd, 'USD')
                                                          : '—' },
      { icon: MapPin,    label: 'Country',           value: a.country_code ?? '—' },
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {rows.map(r => (
          <div key={r.label} className="flex items-start gap-2.5 py-1">
            <r.icon size={14} className="text-zinc-600 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{r.label}</div>
              <div className="text-sm text-zinc-200 break-words">{r.value}</div>
            </div>
          </div>
        ))}
      </div>

      {data.referred_by && (
        <div className="mt-6 border border-zinc-800 rounded-lg p-4 bg-zinc-900/40">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">Referred by</div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm text-zinc-200">{data.referred_by.display_name ?? data.referred_by.email ?? '—'}</div>
              <div className="text-xs text-zinc-500 font-mono">{data.referred_by.email ?? '—'}</div>
            </div>
            <RiskBadge label={data.referred_by.risk_label} score={data.referred_by.risk_score} />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tasks
// ============================================================================

function TasksTab({ tasks }: { tasks: DetailPayload['tasks'] }) {
  if (tasks.length === 0) {
    return <div className="text-sm text-zinc-500 py-8 text-center">No tasks started.</div>;
  }
  const STATUS_COLOR: Record<string, string> = {
    VERIFIED:  'text-emerald-400',
    SUBMITTED: 'text-amber-400',
    PENDING:   'text-zinc-500',
    REJECTED:  'text-red-400',
  };
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
        <tr>
          <th className="text-left py-2 pr-3">Task</th>
          <th className="text-left py-2 pr-3">Status</th>
          <th className="text-right py-2 pr-3">Points</th>
          <th className="text-left py-2">Completed</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-900">
        {tasks.map(t => (
          <tr key={t.id}>
            <td className="py-2 pr-3">{t.task_type}</td>
            <td className={`py-2 pr-3 ${STATUS_COLOR[t.status] ?? 'text-zinc-400'} text-xs font-semibold uppercase tracking-wider`}>{t.status}</td>
            <td className="py-2 pr-3 text-right font-mono">{formatCount(t.points_awarded)}</td>
            <td className="py-2 text-xs text-zinc-500">
              {t.completed_at ? new Date(t.completed_at).toLocaleString('en-US') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================================
// Referrals
// ============================================================================

function ReferralsTab({ referrals }: { referrals: DetailPayload['referrals'] }) {
  if (referrals.length === 0) {
    return <div className="text-sm text-zinc-500 py-8 text-center">No referrals made.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
        <tr>
          <th className="text-left py-2 pr-3">Referee</th>
          <th className="text-left py-2 pr-3">Type</th>
          <th className="text-left py-2 pr-3">Risk</th>
          <th className="text-left py-2 pr-3">Reward</th>
          <th className="text-right py-2 pr-3">Amount</th>
          <th className="text-left py-2">When</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-900">
        {referrals.map(r => (
          <tr key={r.referred_id}>
            <td className="py-2 pr-3">
              <div className="text-zinc-200">{r.referred_display_name ?? r.referred_email ?? '—'}</div>
              {r.referred_email && (
                <div className="text-xs text-zinc-500 font-mono">{r.referred_email}</div>
              )}
            </td>
            <td className="py-2 pr-3 text-xs uppercase tracking-wider text-zinc-500">{r.referred_type}</td>
            <td className="py-2 pr-3"><RiskBadge label={r.referred_risk_label} score={r.referred_risk_score} size="xs" /></td>
            <td className="py-2 pr-3 text-xs uppercase tracking-wider text-zinc-400">{r.reward_status}</td>
            <td className="py-2 pr-3 text-right font-mono">{formatCount(r.reward_amount)}</td>
            <td className="py-2 text-xs text-zinc-500">{new Date(r.created_at).toLocaleString('en-US')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================================
// Points history
// ============================================================================

function PointsTab({ history }: { history: DetailPayload['points_history'] }) {
  if (history.length === 0) {
    return <div className="text-sm text-zinc-500 py-8 text-center">No point events yet.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
        <tr>
          <th className="text-left py-2 pr-3">Event</th>
          <th className="text-right py-2 pr-3">Δ Points</th>
          <th className="text-right py-2 pr-3">Total</th>
          <th className="text-left py-2">When</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-900">
        {history.map((e, idx) => (
          <tr key={`${e.created_at}:${idx}`}>
            <td className="py-2 pr-3 text-xs uppercase tracking-wider text-zinc-300">{e.event}</td>
            <td className={`py-2 pr-3 text-right font-mono ${e.bonus_points >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {e.bonus_points >= 0 ? '+' : ''}{formatCount(e.bonus_points)}
            </td>
            <td className="py-2 pr-3 text-right font-mono text-zinc-400">{formatCount(e.total_points ?? 0)}</td>
            <td className="py-2 text-xs text-zinc-500">{new Date(e.created_at).toLocaleString('en-US')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================================
// Risk Factors
// ============================================================================

const CATEGORY_CAPS_FOR_BAR: CategoryScores = {
  identity: 50, network: 40, device: 40, behavior: 25, graph: 50, profile: 20,
};

const CATEGORY_LABEL: Record<keyof CategoryScores, string> = {
  identity: 'Identity',
  network:  'Network',
  device:   'Device',
  behavior: 'Behaviour',
  graph:    'Graph',
  profile:  'Profile',
};

function RiskTab({ risk }: { risk: ThreatScoreResult | null }) {
  if (!risk) {
    return (
      <div className="text-sm text-zinc-500 py-8 text-center">
        Threat score not yet computed.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <ScoreHeadline risk={risk} />
      <CategoryBars by_category={risk.by_category} />
      <HypothesisBreakdown risk={risk} />
      {risk.tier1_flags.length > 0 && <Tier1Flags flags={risk.tier1_flags} />}
      <SignalsTable signals={risk.signals} />
    </div>
  );
}

function ScoreHeadline({ risk }: { risk: ThreatScoreResult }) {
  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/40 flex items-center justify-between gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Final score</div>
        <div className="text-3xl font-mono font-bold text-zinc-100">{formatCount(risk.score)}</div>
        <div className="text-[10px] text-zinc-600 mt-1">
          model {risk.model_version} · {new Date(risk.computed_at).toLocaleString('en-US')}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <RiskBadge label={risk.label} score={risk.score} confidence={risk.confidence} size="md" />
        <HypothesisChip
          hypothesis={risk.hypothesis}
          confidence={risk.hypothesis_confidence}
          margin={risk.hypothesis_margin}
          forceShow
        />
      </div>
    </div>
  );
}

function CategoryBars({ by_category }: { by_category: CategoryScores }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">By category</h3>
      <div className="space-y-1.5">
        {(Object.keys(CATEGORY_CAPS_FOR_BAR) as Array<keyof CategoryScores>).map(cat => {
          const cap = CATEGORY_CAPS_FOR_BAR[cat];
          const raw = by_category[cat] ?? 0;
          const pct = Math.max(0, Math.min(100, (raw / cap) * 100));
          return (
            <div key={cat} className="flex items-center gap-3">
              <div className="w-20 text-xs text-zinc-400">{CATEGORY_LABEL[cat]}</div>
              <div className="flex-1 h-2 bg-zinc-900 rounded overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="w-16 text-right text-xs font-mono text-zinc-500">
                {formatCount(Math.round(raw))} / {formatCount(cap)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Phase F — full per-hypothesis posterior breakdown + top contributors.
// Adjacent to the category bars in the Risk Factors tab so the admin sees
// (1) the broken-down category contributions to the SCORE, and
// (2) the broken-down posteriors and per-signal explanation for the HYPOTHESIS.

const HYPOTHESIS_ROW_COLOR: Record<string, string> = {
  NORMAL:         'from-emerald-500/40 to-emerald-500/10',
  BOT_FARM:       'from-red-500/40 to-red-500/10',
  REFERRAL_RING:  'from-orange-500/40 to-orange-500/10',
  SANCTIONED:     'from-purple-500/40 to-purple-500/10',
  MONEY_MULE:     'from-rose-500/40 to-rose-500/10',
  IDENTITY_FRAUD: 'from-fuchsia-500/40 to-fuchsia-500/10',
  LOW_QUALITY:    'from-amber-500/40 to-amber-500/10',
};

function HypothesisBreakdown({ risk }: { risk: ThreatScoreResult }) {
  // Sort hypotheses by posterior desc so the picture is read at a glance.
  const entries = Object.entries(risk.per_hypothesis ?? {})
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .filter(([, p]) => (p as number) > 0.005);   // hide rounding-noise rows

  const marginPct = Math.round((risk.hypothesis_margin ?? 0) * 100);
  const ambiguity = marginPct < 20 ? 'ambiguous' : marginPct < 50 ? 'leaning' : 'confident';
  const ambColor = ambiguity === 'ambiguous'
    ? 'text-amber-300'
    : ambiguity === 'leaning'
      ? 'text-zinc-300'
      : 'text-emerald-300';

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">Hypothesis breakdown</h3>
        <span className={`text-[10px] uppercase tracking-wider ${ambColor}`}>
          {ambiguity} · margin {formatCount(marginPct)}%
        </span>
      </div>
      <div className="space-y-1">
        {entries.map(([h, p]) => {
          const pct = Math.round((p as number) * 100);
          return (
            <div key={h} className="flex items-center gap-3">
              <div className="w-32 text-xs text-zinc-400 truncate">{h.replace('_', ' ')}</div>
              <div className="flex-1 h-2 bg-zinc-900 rounded overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${HYPOTHESIS_ROW_COLOR[h] ?? 'from-zinc-500/40 to-zinc-500/10'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="w-12 text-right text-xs font-mono text-zinc-500">{formatCount(pct)}%</div>
            </div>
          );
        })}
      </div>

      {/* Top contributing signals for the WINNING hypothesis. Surfaces why
          the classifier picked it — log-likelihood-ratio vs second-place. */}
      {risk.hypothesis_contributors && risk.hypothesis_contributors.length > 0 && (
        <div className="mt-3 pl-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
            Why {risk.hypothesis.replace('_', ' ')}?
          </div>
          <ul className="space-y-0.5">
            {risk.hypothesis_contributors.map((c, idx) => (
              <li key={idx} className="text-[11px] flex justify-between">
                <span className="font-mono text-zinc-400">{c.signal}</span>
                <span className="font-mono text-zinc-500">+{formatRate(c.contribution)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tier1Flags({ flags }: { flags: Tier1Flag[] }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-red-400 mb-2 flex items-center gap-1.5">
        <AlertTriangle size={12} /> Hard-rule flags
      </h3>
      <div className="space-y-1.5">
        {flags.map((f, idx) => (
          <div key={idx} className="border border-red-500/30 rounded px-3 py-2 bg-red-500/5 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-mono text-red-300">{f.rule}</div>
              <div className="text-[10px] uppercase tracking-wider text-red-400">{f.hypothesis}</div>
            </div>
            <pre className="text-[11px] text-zinc-500 mt-1 overflow-x-auto">{JSON.stringify(f.evidence, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalsTable({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <div>
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Signals</h3>
        <div className="text-sm text-zinc-500">No signals fired.</div>
      </div>
    );
  }
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Signals ({formatCount(signals.length)})</h3>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
          <tr>
            <th className="text-left py-2 pr-3">Type</th>
            <th className="text-left py-2 pr-3">Category</th>
            <th className="text-right py-2 pr-3">Severity ×</th>
            <th className="text-left py-2">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900">
          {signals.map((s, idx) => (
            <tr key={`${s.type}:${idx}`}>
              <td className="py-2 pr-3 font-mono text-xs text-zinc-200">{s.type}</td>
              <td className="py-2 pr-3 text-xs uppercase tracking-wider text-zinc-500">{s.category}</td>
              <td className="py-2 pr-3 text-right font-mono text-zinc-400">
                {formatRate(s.severity_multiplier)}
              </td>
              <td className="py-2">
                <pre className="text-[11px] text-zinc-500 overflow-x-auto max-w-md">{JSON.stringify(s.evidence)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Community (Tier 3)
// ============================================================================

function CommunityTab({
  community,
  selfId,
}: {
  community: DetailPayload['community'];
  selfId: string;
}) {
  if (!community) {
    return (
      <div className="text-sm text-zinc-500 py-8 text-center">
        <Users className="inline mb-2 text-zinc-700" size={28} />
        <div>No community membership computed yet.</div>
        <div className="text-xs text-zinc-600 mt-1">
          The graph-rebuild cron runs every 5 minutes. Newly-signed-up actors
          appear here on the next pass.
        </div>
      </div>
    );
  }

  const densityPct = Math.round(community.density * 100);
  const ageSpread = formatDuration(community.age_spread_seconds);

  return (
    <div className="space-y-6">
      {/* Headline metrics */}
      <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/40">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Community</div>
            <code className="font-mono text-xs text-zinc-300 break-all">{community.community_id}</code>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Anomaly</div>
            <div className={`text-2xl font-mono font-bold ${
              community.anomaly_score >= 60 ? 'text-red-400'
              : community.anomaly_score >= 40 ? 'text-amber-300'
              : 'text-zinc-300'
            }`}>{formatCount(community.anomaly_score)}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-xs">
          <Stat label="Size" value={formatCount(community.size)} />
          <Stat label="Density" value={`${formatCount(densityPct)}%`} />
          <Stat label="Age spread" value={ageSpread} />
          <Stat label="Unique IPs" value={formatCount(community.unique_ips)} />
          <Stat label="Unique devices" value={formatCount(community.unique_devices)} />
          <Stat label="Updated" value={new Date(community.last_computed_at).toLocaleString('en-US')} />
        </div>
      </div>

      {/* Member list */}
      <div>
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
          Members ({formatCount(community.members.length)})
        </h3>
        {community.members.length === 0 ? (
          <div className="text-sm text-zinc-500">No other members.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
              <tr>
                <th className="text-left py-2 pr-3">Actor</th>
                <th className="text-left py-2 pr-3">Type</th>
                <th className="text-left py-2 pr-3">Risk</th>
                <th className="text-left py-2">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {community.members.map(m => {
                const isSelf = m.actor_id === selfId;
                return (
                  <tr key={`${m.actor_type}:${m.actor_id}`} className={isSelf ? 'bg-zinc-900/40' : ''}>
                    <td className="py-2 pr-3">
                      <div className="text-zinc-200 flex items-center gap-1.5">
                        {m.display_name ?? m.email ?? '—'}
                        {isSelf && (
                          <span className="text-[10px] uppercase tracking-wider text-emerald-400 border border-emerald-500/30 rounded px-1">
                            self
                          </span>
                        )}
                      </div>
                      {m.email && (
                        <div className="text-xs text-zinc-500 font-mono">{m.email}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs uppercase tracking-wider text-zinc-500">{m.actor_type}</td>
                    <td className="py-2 pr-3">
                      <RiskBadge label={m.risk_label} score={m.risk_score} size="xs" />
                    </td>
                    <td className="py-2 text-xs text-zinc-500">
                      {m.waitlist_joined_at ? new Date(m.waitlist_joined_at).toLocaleString('en-US') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-sm text-zinc-200">{value}</div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${formatCount(seconds)}s`;
  if (seconds < 3600) return `${formatCount(Math.round(seconds / 60))}m`;
  if (seconds < 86400) return `${formatCount(Math.round(seconds / 3600))}h`;
  return `${formatCount(Math.round(seconds / 86400))}d`;
}

// ============================================================================
// Footer
// ============================================================================

function Footer({
  data, acting, confirm, onCancelConfirm, onAct,
}: {
  data: DetailPayload | null;
  acting: 'activate' | 'reject' | null;
  confirm: { action: 'activate' | 'reject'; reason: string } | null;
  onCancelConfirm: () => void;
  onAct: (action: 'activate' | 'reject') => void;
}) {
  if (!data) return null;
  const status = data.actor.waitlist_status;
  return (
    <footer className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
      <div className="text-xs text-zinc-500">
        Status: <span className="uppercase tracking-wider text-zinc-300">{status}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {confirm && (
          <>
            <div className="text-xs text-amber-300">{confirm.reason}</div>
            <button
              onClick={onCancelConfirm}
              className="border border-zinc-800 rounded px-3 py-1.5 text-xs hover:bg-zinc-900 text-zinc-400"
            >Cancel</button>
          </>
        )}
        {status === 'waitlisted' && (
          <>
            <button
              onClick={() => onAct('activate')}
              disabled={acting !== null}
              className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 rounded px-3 py-1.5 text-xs uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
            >
              {acting === 'activate' ? <Loader2 className="animate-spin" size={12} /> : <Check size={12} />}
              {confirm?.action === 'activate' ? 'Confirm activate' : 'Activate'}
            </button>
            <button
              onClick={() => onAct('reject')}
              disabled={acting !== null}
              className="bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20 rounded px-3 py-1.5 text-xs uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
            >
              {acting === 'reject' ? <Loader2 className="animate-spin" size={12} /> : <X size={12} />}
              {confirm?.action === 'reject' ? 'Confirm reject' : 'Reject'}
            </button>
          </>
        )}
      </div>
    </footer>
  );
}
