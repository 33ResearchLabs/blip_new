'use client';

// /admin/waitlist — admin view of all waitlist signups across users and merchants.
// Uses the same admin-cookie auth as the other /admin/* pages.
//
// Phase A enhancements: per-row engagement counts (Refs, Tasks), threat-score
// badge + hypothesis chip, risk/hypothesis filters, sort modes, and a
// per-row detail modal (WaitlistDetailModal).

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { formatCount } from '@/lib/format';
import { Loader2, Check, X, Search, RefreshCw, Eye } from 'lucide-react';
import { RiskBadge } from '@/components/admin/RiskBadge';
import { HypothesisChip } from '@/components/admin/HypothesisChip';
import { WaitlistDetailModal } from '@/components/admin/WaitlistDetailModal';
import type { RiskLabel, ThreatHypothesis, Confidence, ActorType } from '@/lib/threat/types';

interface Row {
  id: string;
  actor_type: ActorType;
  email: string | null;
  display_name: string | null;
  username: string | null;
  waitlist_status: 'waitlisted' | 'active' | 'rejected';
  waitlist_joined_at: string | null;
  waitlist_source: string | null;
  blip_points: number | null;
  referral_code: string | null;
  business_name: string | null;
  referrals_count: number;
  tasks_completed_count: number;
  risk_score: number | null;
  risk_label: RiskLabel | null;
  hypothesis: ThreatHypothesis | null;
  hypothesis_confidence: number | null;
  hypothesis_margin: number | null;
  confidence: Confidence | null;
}

type Segment = 'all' | 'user' | 'merchant';
type Status = 'waitlisted' | 'active' | 'rejected' | 'all';
type RiskFilter = 'all' | 'trusted_clean' | 'neutral' | 'suspect_plus' | 'high_risk_plus' | 'critical';
type HypothesisFilter = 'all' | 'flagged' | ThreatHypothesis;
type SortMode = 'joined_desc' | 'joined_asc' | 'risk_desc' | 'risk_asc' | 'points_desc' | 'points_asc';

export default function AdminWaitlistPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  const [segment, setSegment] = useState<Segment>('all');
  const [status, setStatus] = useState<Status>('waitlisted');
  const [risk, setRisk] = useState<RiskFilter>('all');
  const [hypothesis, setHypothesis] = useState<HypothesisFilter>('all');
  const [sort, setSort] = useState<SortMode>('joined_desc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [totalsBySegment, setTotalsBySegment] = useState<{ user: number; merchant: number }>({ user: 0, merchant: 0 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [detailRow, setDetailRow] = useState<Row | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetchWithAuth('/api/auth/admin');
        const data = await res.json();
        if (active) setAuthed(!!(data.success && data.data?.valid));
      } catch {/* ignore */}
      finally { if (active) setAuthChecked(true); }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        segment, status, risk, hypothesis, sort,
        page: String(page), limit: '50',
      });
      if (debouncedSearch) sp.set('q', debouncedSearch);
      const res = await fetchWithAuth(`/api/admin/waitlist?${sp.toString()}`);
      const data = await res.json();
      if (data.success) {
        setRows(data.data.rows);
        setTotal(data.data.total);
        if (data.data.totals_by_segment) {
          setTotalsBySegment({
            user: data.data.totals_by_segment.user ?? 0,
            merchant: data.data.totals_by_segment.merchant ?? 0,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load waitlist', err);
    } finally {
      setLoading(false);
    }
  }, [authed, segment, status, risk, hypothesis, sort, page, debouncedSearch]);

  useEffect(() => { void load(); }, [load]);

  async function act(row: Row, action: 'activate' | 'reject') {
    setActing(`${row.actor_type}:${row.id}`);
    try {
      const res = await fetchWithAuth(
        `/api/admin/waitlist/${row.actor_type}/${row.id}/${action}`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (data.success) await load();
    } catch (err) {
      console.error(`Failed to ${action}`, err);
    } finally {
      setActing(null);
    }
  }

  if (!authChecked) {
    return <CenterMessage>Checking admin session…</CenterMessage>;
  }
  if (!authed) {
    return <CenterMessage>You must log in at <a href="/admin" className="underline">/admin</a> first.</CenterMessage>;
  }

  const totalPages = Math.max(1, Math.ceil(total / 50));

  const segmentTabs: Array<{ key: Segment; label: string; count: number }> = [
    { key: 'all',      label: 'All',       count: totalsBySegment.user + totalsBySegment.merchant },
    { key: 'user',     label: 'Users',     count: totalsBySegment.user },
    { key: 'merchant', label: 'Merchants', count: totalsBySegment.merchant },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Waitlist</h1>
            <p className="text-sm text-zinc-400">{formatCount(total)} signup{total === 1 ? '' : 's'}</p>
          </div>
          <button onClick={load} className="border border-zinc-800 rounded px-3 py-2 text-sm hover:bg-zinc-900 flex items-center gap-1.5">
            <RefreshCw size={14} /> Refresh
          </button>
        </header>

        {/* Segment tab bar — replaces the old "All segments / Users / Merchants"
            dropdown. Counts per tab respond to the current status / risk /
            hypothesis / search filters so the admin always sees how many user
            vs merchant rows match the active filter set. */}
        <div className="flex gap-1 border-b border-zinc-800 mb-4 overflow-x-auto">
          {segmentTabs.map(t => {
            const active = segment === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setSegment(t.key); setPage(1); }}
                className={`px-4 py-2.5 text-sm font-semibold uppercase tracking-wider border-b-2 transition-colors flex items-center gap-2 ${
                  active
                    ? 'border-emerald-400 text-emerald-300'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t.label}
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                  active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-900 text-zinc-500'
                }`}>
                  {formatCount(t.count)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <select value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(1); }}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm">
            <option value="waitlisted">Waitlisted</option>
            <option value="active">Active</option>
            <option value="rejected">Rejected</option>
            <option value="all">All statuses</option>
          </select>
          <select value={risk} onChange={(e) => { setRisk(e.target.value as RiskFilter); setPage(1); }}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm">
            <option value="all">All risk</option>
            <option value="trusted_clean">Trusted + Clean</option>
            <option value="neutral">Neutral</option>
            <option value="suspect_plus">Suspect+</option>
            <option value="high_risk_plus">High-risk+</option>
            <option value="critical">Critical only</option>
          </select>
          <select value={hypothesis} onChange={(e) => { setHypothesis(e.target.value as HypothesisFilter); setPage(1); }}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm">
            <option value="all">All hypotheses</option>
            <option value="flagged">Flagged only (non-NORMAL)</option>
            <option value="NORMAL">Normal</option>
            <option value="BOT_FARM">Bot farm</option>
            <option value="REFERRAL_RING">Referral ring</option>
            <option value="SANCTIONED">Sanctioned</option>
            <option value="MONEY_MULE">Money mule</option>
            <option value="IDENTITY_FRAUD">Identity fraud</option>
            <option value="LOW_QUALITY">Low quality</option>
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as SortMode); setPage(1); }}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm">
            <option value="joined_desc">Newest first</option>
            <option value="joined_asc">Oldest first</option>
            <option value="risk_desc">Risk: high → low</option>
            <option value="risk_asc">Risk: low → high</option>
            <option value="points_desc">Points: high → low</option>
            <option value="points_asc">Points: low → high</option>
          </select>
          <div className="flex-1 min-w-[200px] relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text" placeholder="Search by email, username, business name"
              value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100}
              className="w-full bg-zinc-900 border border-zinc-800 rounded pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-3">Email</th>
                <th className="text-left px-3 py-3">Type</th>
                <th className="text-left px-3 py-3">Name</th>
                <th className="text-right px-3 py-3">BLIP</th>
                <th className="text-right px-3 py-3">Refs</th>
                <th className="text-right px-3 py-3">Tasks</th>
                <th className="text-left px-3 py-3">Risk</th>
                <th className="text-left px-3 py-3">Hypothesis</th>
                <th className="text-left px-3 py-3">Joined</th>
                <th className="text-left px-3 py-3">Status</th>
                <th className="text-right px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading && (
                <tr><td colSpan={11} className="text-center py-8"><Loader2 className="animate-spin inline" /></td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={11} className="text-center py-8 text-zinc-500">No signups match</td></tr>
              )}
              {!loading && rows.map((r) => (
                <tr key={`${r.actor_type}:${r.id}`} className="hover:bg-zinc-900/50">
                  <td className="px-3 py-3 font-mono text-xs">{r.email ?? '—'}</td>
                  <td className="px-3 py-3 text-xs uppercase tracking-wider text-zinc-500">{r.actor_type}</td>
                  <td className="px-3 py-3">
                    {r.business_name ?? r.display_name ?? r.username ?? '—'}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">{formatCount(r.blip_points ?? 0)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatCount(r.referrals_count)}</td>
                  <td className="px-3 py-3 text-right font-mono">{formatCount(r.tasks_completed_count)}</td>
                  <td className="px-3 py-3">
                    <RiskBadge label={r.risk_label} score={r.risk_score} confidence={r.confidence} />
                  </td>
                  <td className="px-3 py-3">
                    <HypothesisChip
                      hypothesis={r.hypothesis}
                      confidence={r.hypothesis_confidence}
                      margin={r.hypothesis_margin}
                    />
                  </td>
                  <td className="px-3 py-3 text-xs text-zinc-500">
                    {r.waitlist_joined_at ? new Date(r.waitlist_joined_at).toLocaleDateString('en-US') : '—'}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={r.waitlist_status} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setDetailRow(r)}
                        className="text-xs bg-zinc-800/60 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 rounded px-2 py-1 flex items-center gap-1"
                        title="View details"
                      >
                        <Eye size={12} /> View
                      </button>
                      {r.waitlist_status === 'waitlisted' && (
                        <>
                          <button
                            onClick={() => act(r, 'activate')}
                            disabled={acting === `${r.actor_type}:${r.id}`}
                            className="text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 rounded px-2 py-1 flex items-center gap-1"
                          >
                            <Check size={12} /> Activate
                          </button>
                          <button
                            onClick={() => act(r, 'reject')}
                            disabled={acting === `${r.actor_type}:${r.id}`}
                            className="text-xs bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 rounded px-2 py-1 flex items-center gap-1"
                          >
                            <X size={12} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-zinc-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
              className="border border-zinc-800 rounded px-3 py-1 text-xs disabled:opacity-40">Prev</button>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
              className="border border-zinc-800 rounded px-3 py-1 text-xs disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      {detailRow && (
        <WaitlistDetailModal
          actorType={detailRow.actor_type}
          id={detailRow.id}
          onClose={() => setDetailRow(null)}
          onAction={() => { void load(); }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'waitlisted' | 'active' | 'rejected' }) {
  const cls = status === 'active'
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : status === 'waitlisted'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-red-500/10 text-red-400 border-red-500/20';
  return <span className={`text-[10px] font-bold uppercase tracking-wider border rounded px-2 py-0.5 ${cls}`}>{status}</span>;
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 flex items-center justify-center text-sm">{children}</div>
  );
}
