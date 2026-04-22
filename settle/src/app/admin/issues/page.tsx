'use client';

/**
 * Admin → Issues dashboard.
 *
 * Read + triage view over the `issues` table. User-initiated reports
 * are surfaced here (distinct from the auto-error `/admin/error-logs`
 * view). Polls every 15s.
 */

import Link from 'next/link';
import {
  Bug,
  Camera,
  ChevronRight,
  FileText,
  MessageSquarePlus,
  Radio,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
type IssuePriority = 'low' | 'medium' | 'high' | 'critical';
type IssueCategory =
  | 'ui_bug'
  | 'backend'
  | 'payment'
  | 'performance'
  | 'other';

interface IssueRow {
  id: string;
  title: string;
  category: IssueCategory;
  description: string;
  screenshot_url: string | null;
  attachments: Array<{ url: string; name: string; mime: string; size_bytes: number }>;
  status: IssueStatus;
  priority: IssuePriority;
  source: 'manual' | 'auto';
  created_by: string | null;
  actor_type: string | null;
  metadata: Record<string, unknown>;
  admin_notes: Array<{ note: string; author: string; at: string }>;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

const STATUS_STYLES: Record<IssueStatus, string> = {
  open: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  in_progress: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  resolved: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  closed: 'text-foreground/50 bg-foreground/[0.05] border-border',
};

const PRIORITY_STYLES: Record<IssuePriority, string> = {
  low: 'text-foreground/60 bg-foreground/[0.04] border-border',
  medium: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  high: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  critical: 'text-rose-300 bg-rose-600/20 border-rose-500/40',
};

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  ui_bug: 'UI Bug',
  backend: 'Backend',
  payment: 'Payment',
  performance: 'Performance',
  other: 'Other',
};

const STATUS_TRANSITIONS: IssueStatus[] = [
  'open',
  'in_progress',
  'resolved',
  'closed',
];

export default function AdminIssuesPage() {
  const [rows, setRows] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [priority, setPriority] = useState<string>('');
  const [selected, setSelected] = useState<IssueRow | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [noteDraft, setNoteDraft] = useState('');
  const [savingAction, setSavingAction] = useState(false);

  const getToken = () => {
    try {
      return localStorage.getItem('blip_admin_token') || '';
    } catch {
      return '';
    }
  };

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (category) qs.set('category', category);
      if (priority) qs.set('priority', priority);
      qs.set('limit', '200');
      const res = await fetch(`/api/admin/issues?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 404) {
        setError(
          'Issue reporting is disabled. Set ENABLE_ISSUE_REPORTING=true on the server.',
        );
        setRows([]);
        return;
      }
      if (!res.ok) {
        setError(`Failed to load (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setRows(data.data);
        setLastRefresh(new Date());
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch (e) {
      setError((e as Error).message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [status, category, priority]);

  useEffect(() => {
    fetchIssues();
    const id = setInterval(fetchIssues, 15_000);
    return () => clearInterval(id);
  }, [fetchIssues]);

  // Keep selection fresh — when a row is open in the detail drawer and
  // the list refreshes, reconcile the detail view with the latest row.
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.id === selected.id);
    if (fresh && fresh.updated_at !== selected.updated_at) setSelected(fresh);
  }, [rows, selected]);

  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [rows]);

  const patchIssue = useCallback(
    async (
      id: string,
      patch: { status?: IssueStatus; priority?: IssuePriority; note?: string },
    ) => {
      setSavingAction(true);
      try {
        const res = await fetch(`/api/admin/issues/${id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${getToken()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          // Update both the list and the drawer selection.
          setRows((prev) => prev.map((r) => (r.id === id ? data.data : r)));
          setSelected((prev) => (prev && prev.id === id ? data.data : prev));
        } else {
          setError(data?.error || `Failed (HTTP ${res.status})`);
        }
      } catch (e) {
        setError((e as Error).message || 'Network error');
      } finally {
        setSavingAction(false);
      }
    },
    [],
  );

  const secondsAgo = Math.max(
    0,
    Math.floor((Date.now() - lastRefresh.getTime()) / 1000),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <Radio size={14} className="text-[var(--color-success)] animate-pulse" />
            <span className="text-sm font-bold">Admin</span>
            <span className="text-[10px] text-foreground/30 font-mono">
              {loading ? 'syncing…' : `${secondsAgo}s ago`}
            </span>
          </div>
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-card rounded-lg p-[3px]">
              {[
                ['/admin', 'Console'],
                ['/admin/live', 'Live Feed'],
                ['/admin/access-control', 'Access Control'],
                ['/admin/accounts', 'Accounts'],
                ['/admin/disputes', 'Disputes'],
                ['/admin/monitor', 'Monitor'],
                ['/admin/error-logs', 'Error Logs'],
                ['/admin/issues', 'Issues'],
                ['/admin/usdt-inr-price', 'Price'],
              ].map(([href, label]) => {
                const active = href === '/admin/issues';
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`px-3 py-[5px] rounded-md text-[12px] font-medium transition-colors ${
                      active
                        ? 'bg-accent-subtle text-foreground'
                        : 'text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle'
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* Counts cards */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          {(['open', 'in_progress', 'resolved', 'closed'] as IssueStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(status === s ? '' : s)}
              className={`text-left px-3 py-2 rounded-lg border transition ${
                status === s
                  ? 'bg-foreground/[0.06] border-foreground/20'
                  : 'bg-card border-border hover:bg-foreground/[0.03]'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide text-foreground/40">
                {s.replace('_', ' ')}
              </div>
              <div className="text-xl font-semibold">{counts[s] ?? 0}</div>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-[12px]">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="px-2 py-1 rounded-md bg-card border border-border"
          >
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="px-2 py-1 rounded-md bg-card border border-border"
          >
            <option value="">All priorities</option>
            {(['low', 'medium', 'high', 'critical'] as IssuePriority[]).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {(status || category || priority) && (
            <button
              type="button"
              onClick={() => {
                setStatus('');
                setCategory('');
                setPriority('');
              }}
              className="px-2 py-1 rounded-md bg-foreground/[0.05] hover:bg-foreground/[0.09]"
            >
              Clear filters
            </button>
          )}
        </div>

        {error && (
          <div className="mb-3 px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[12px]">
            {error}
          </div>
        )}

        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-foreground/[0.03] text-foreground/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Title</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Priority</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Reporter</th>
                <th className="text-left px-3 py-2 font-medium">Created</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-foreground/40">
                    No issues match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border hover:bg-foreground/[0.02] cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {r.screenshot_url && (
                          <Camera size={11} className="text-foreground/40 shrink-0" />
                        )}
                        {r.attachments?.length > 0 && (
                          <FileText size={11} className="text-foreground/40 shrink-0" />
                        )}
                        <span className="truncate max-w-[320px]">{r.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-foreground/60">
                      {CATEGORY_LABELS[r.category]}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] uppercase ${PRIORITY_STYLES[r.priority]}`}
                      >
                        {r.priority}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] uppercase ${STATUS_STYLES[r.status]}`}
                      >
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-foreground/60 font-mono text-[11px]">
                      {r.created_by ? r.created_by.slice(0, 8) : 'anon'}
                    </td>
                    <td className="px-3 py-2 text-foreground/50 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-foreground/30">
                      <ChevronRight size={12} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* Detail drawer */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <aside className="w-full max-w-2xl h-full bg-background border-l border-border overflow-auto">
            <div className="sticky top-0 bg-background/95 backdrop-blur border-b border-border px-4 h-12 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <Bug size={14} /> Issue detail
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-1 rounded-md hover:bg-foreground/[0.05]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <div className="text-[18px] font-semibold leading-tight">
                  {selected.title}
                </div>
                <div className="text-[11px] text-foreground/40 font-mono mt-1">
                  #{selected.id}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px]">
                <span
                  className={`inline-flex px-1.5 py-0.5 rounded border uppercase ${STATUS_STYLES[selected.status]}`}
                >
                  {selected.status.replace('_', ' ')}
                </span>
                <span
                  className={`inline-flex px-1.5 py-0.5 rounded border uppercase ${PRIORITY_STYLES[selected.priority]}`}
                >
                  {selected.priority}
                </span>
                <span className="inline-flex px-1.5 py-0.5 rounded border bg-foreground/[0.04] border-border">
                  {CATEGORY_LABELS[selected.category]}
                </span>
                <span className="inline-flex px-1.5 py-0.5 rounded border bg-foreground/[0.04] border-border">
                  {selected.source}
                </span>
              </div>

              <div>
                <div className="text-[11px] uppercase text-foreground/40 mb-1">
                  Description
                </div>
                <p className="text-[13px] whitespace-pre-wrap">
                  {selected.description}
                </p>
              </div>

              {selected.screenshot_url && (
                <div>
                  <div className="text-[11px] uppercase text-foreground/40 mb-1">
                    Screenshot
                  </div>
                  <a
                    href={selected.screenshot_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={selected.screenshot_url}
                      alt="Issue screenshot"
                      className="max-w-full rounded border border-border"
                    />
                  </a>
                </div>
              )}

              {selected.attachments?.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase text-foreground/40 mb-1">
                    Attachments
                  </div>
                  <ul className="space-y-1">
                    {selected.attachments.map((a, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 px-2 py-1 rounded bg-foreground/[0.04] text-[12px]"
                      >
                        <FileText size={12} className="text-foreground/40" />
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 truncate hover:underline"
                        >
                          {a.name}
                        </a>
                        <span className="text-foreground/40">
                          {Math.round(a.size_bytes / 1024)}KB
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="text-[11px] uppercase text-foreground/40 mb-1">
                  Metadata
                </div>
                <pre className="text-[11px] bg-foreground/[0.04] border border-border rounded p-2 overflow-auto max-h-48">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </div>

              {/* Actions */}
              <div className="border-t border-border pt-3 space-y-3">
                <div>
                  <div className="text-[11px] uppercase text-foreground/40 mb-1">
                    Status
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {STATUS_TRANSITIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={savingAction || selected.status === s}
                        onClick={() => patchIssue(selected.id, { status: s })}
                        className={`px-2 py-1 rounded-md border text-[11px] uppercase ${
                          selected.status === s
                            ? 'bg-foreground text-background border-foreground'
                            : 'bg-foreground/[0.04] border-border hover:bg-foreground/[0.08]'
                        } disabled:opacity-40`}
                      >
                        {s.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase text-foreground/40 mb-1">
                    Priority
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(['low', 'medium', 'high', 'critical'] as IssuePriority[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        disabled={savingAction || selected.priority === p}
                        onClick={() => patchIssue(selected.id, { priority: p })}
                        className={`px-2 py-1 rounded-md border text-[11px] uppercase ${
                          selected.priority === p
                            ? 'bg-foreground text-background border-foreground'
                            : 'bg-foreground/[0.04] border-border hover:bg-foreground/[0.08]'
                        } disabled:opacity-40`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase text-foreground/40 mb-1 flex items-center gap-1">
                    <MessageSquarePlus size={11} />
                    Internal note
                  </div>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    maxLength={2000}
                    rows={2}
                    placeholder="Add context for other admins…"
                    className="w-full px-2 py-1.5 rounded-md bg-foreground/[0.04] border border-border text-[12px]"
                  />
                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      disabled={savingAction || !noteDraft.trim()}
                      onClick={async () => {
                        await patchIssue(selected.id, { note: noteDraft });
                        setNoteDraft('');
                      }}
                      className="px-2 py-1 rounded-md text-[11px] font-medium bg-foreground text-background disabled:opacity-40"
                    >
                      Add note
                    </button>
                  </div>
                </div>

                {selected.admin_notes?.length > 0 && (
                  <div>
                    <div className="text-[11px] uppercase text-foreground/40 mb-1">
                      Notes ({selected.admin_notes.length})
                    </div>
                    <ul className="space-y-1">
                      {selected.admin_notes.map((n, i) => (
                        <li
                          key={i}
                          className="px-2 py-1.5 rounded bg-foreground/[0.04] text-[12px]"
                        >
                          <div className="text-foreground/40 text-[10px] mb-0.5">
                            {n.author} · {new Date(n.at).toLocaleString()}
                          </div>
                          <div className="whitespace-pre-wrap">{n.note}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
