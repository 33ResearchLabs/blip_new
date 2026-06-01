'use client';

/**
 * Admin → Worker Health panel. Polls /api/admin/worker-health every 10s and
 * renders a colour-coded table of every worker that has heartbeated into the
 * worker_health table (both fleets). Mirrors the ErrorLogsPanel conventions:
 * dark theme, cookie-based admin auth (bare fetch, httpOnly blip_admin_session),
 * 10s poll, onRefreshStateChange callback.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

type Freshness = 'healthy' | 'warning' | 'critical' | 'stopped' | 'unknown';

interface WorkerRow {
  worker_name: string;
  fleet: string;
  criticality: string;
  status: string;
  effective_status: Freshness;
  expected_interval_ms: number | null;
  last_tick_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  tick_seq: string | number;
  items_processed: string | number;
  last_batch_size: number | null;
  consecutive_errors: number;
  pid: number | null;
  host: string | null;
  updated_at: string;
}

const STATUS_STYLES: Record<Freshness, string> = {
  healthy: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  warning: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  critical: 'text-rose-300 bg-rose-600/20 border-rose-500/40',
  stopped: 'text-foreground/40 bg-foreground/5 border-foreground/10',
  unknown: 'text-foreground/40 bg-foreground/5 border-foreground/10',
};

const STATUS_DOT: Record<Freshness, string> = {
  healthy: 'bg-emerald-400',
  warning: 'bg-amber-400',
  critical: 'bg-rose-400',
  stopped: 'bg-foreground/30',
  unknown: 'bg-foreground/20',
};

function relativeAge(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export interface WorkerHealthPanelProps {
  onRefreshStateChange?: (state: { loading: boolean; lastRefresh: Date }) => void;
}

export default function WorkerHealthPanel({ onRefreshStateChange }: WorkerHealthPanelProps) {
  const [rows, setRows] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/worker-health');
      if (res.status === 401 || res.status === 403) {
        setError('Not authorized. Log in as admin.');
        return;
      }
      if (!res.ok) {
        setError(`Failed to load (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setRows(data.data);
        setNote(data.note || null);
        setLastRefresh(new Date());
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch (e) {
      setError((e as Error).message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const id = setInterval(fetchHealth, 10_000);
    return () => clearInterval(id);
  }, [fetchHealth]);

  useEffect(() => {
    onRefreshStateChange?.({ loading, lastRefresh });
  }, [loading, lastRefresh, onRefreshStateChange]);

  const counts = useMemo(() => {
    const c: Record<Freshness, number> = { healthy: 0, warning: 0, critical: 0, stopped: 0, unknown: 0 };
    for (const r of rows) c[r.effective_status] = (c[r.effective_status] || 0) + 1;
    return c;
  }, [rows]);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['critical', 'warning', 'healthy', 'stopped', 'unknown'] as Freshness[]).map((s) =>
          counts[s] ? (
            <span
              key={s}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-medium ${STATUS_STYLES[s]}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s]}`} />
              {counts[s]} {s}
            </span>
          ) : null,
        )}
        <span className="text-[10px] text-foreground/30 font-mono ml-auto">
          {rows.length} workers{loading ? ' · syncing…' : ''}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}
      {note && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {note}
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-card text-foreground/50">
            <tr>
              <th className="text-left font-medium px-3 py-2">Worker</th>
              <th className="text-left font-medium px-3 py-2">Fleet</th>
              <th className="text-left font-medium px-3 py-2">Crit</th>
              <th className="text-left font-medium px-3 py-2">Status</th>
              <th className="text-left font-medium px-3 py-2">Last Seen</th>
              <th className="text-right font-medium px-3 py-2">Items</th>
              <th className="text-left font-medium px-3 py-2">Last Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-foreground/40">
                  No worker heartbeats yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.worker_name} className="border-t border-border hover:bg-accent-subtle">
                <td className="px-3 py-2 font-mono text-foreground/90">{r.worker_name}</td>
                <td className="px-3 py-2 text-foreground/50">{r.fleet}</td>
                <td className="px-3 py-2 text-foreground/50">{r.criticality}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-medium uppercase ${STATUS_STYLES[r.effective_status]}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[r.effective_status]}`} />
                    {r.effective_status}
                  </span>
                </td>
                <td className="px-3 py-2 text-foreground/60 whitespace-nowrap">{relativeAge(r.last_tick_at)}</td>
                <td className="px-3 py-2 text-right text-foreground/60 font-mono">{String(r.items_processed ?? 0)}</td>
                <td className="px-3 py-2 text-foreground/50 max-w-[28rem] truncate" title={r.last_error || ''}>
                  {r.last_error || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
