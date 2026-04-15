'use client';

/**
 * Admin → Error Logs dashboard.
 *
 * Read-only viewer over the error_logs table. Polls every 10s.
 * When ENABLE_ERROR_TRACKING is off the server returns 404 — we show a
 * friendly notice instead of a broken list.
 *
 * Nav bar matches the other admin pages (Console / Live Feed / Access
 * Control / Accounts / Disputes / Monitor / Error Logs / Price).
 */

import Link from 'next/link';
import { Radio } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface ErrorLogRow {
  id: string;
  type: string;
  message: string;
  severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  order_id: string | null;
  user_id: string | null;
  merchant_id: string | null;
  source: 'frontend' | 'backend' | 'worker';
  metadata: Record<string, unknown>;
  created_at: string;
  // Only present when grouped=true
  occurrence_count?: number;
  first_seen_at?: string;
  last_seen_at?: string;
  latest_id?: string;
}

const SEV_STYLES: Record<ErrorLogRow['severity'], string> = {
  INFO: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  WARN: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  ERROR: 'text-red-400 bg-red-500/10 border-red-500/20',
  CRITICAL: 'text-rose-300 bg-rose-600/20 border-rose-500/40',
};

// Machine-readable `type` codes → plain-English descriptions. Prefix match
// (longest match wins), with fallbacks by top-level namespace so unknown
// types still get a sensible label.
const TYPE_LABELS: Array<[string, string]> = [
  // Exact types first
  ['solana.balance_fetch_failed', 'Solana balance fetch failed (devnet/RPC issue)'],
  ['solana.airdrop_failed', 'Solana devnet airdrop failed'],
  ['ui.api_fail.network', 'Network / connection lost (request never reached the server)'],
  ['ui.api_fail.5xx', 'Server error (5xx response)'],
  ['ui.api_fail.rate_limited', 'Rate limited (429 – too many requests)'],
  ['ui.api_fail.unauthorized', 'Unauthorized (401 – session expired or not logged in)'],
  ['ui.api_fail.forbidden', 'Forbidden (403 – user not allowed to do this)'],
  ['ui.api_fail.not_found', 'Not found (404)'],
  ['ui.api_fail.client_error', 'Client error (4xx response)'],
  ['ui.api_fail', 'API request failed'],
  ['ui.unhandled_rejection', 'Unhandled promise rejection (uncaught async error)'],
  ['ui.window_error', 'Uncaught error in page'],
  ['api.unhandled_exception', 'Unhandled exception in API route'],
  ['api.error_response.500', 'API returned 500 Internal Server Error'],
  ['api.error_response.502', 'API returned 502 Bad Gateway'],
  ['api.error_response.503', 'API returned 503 Service Unavailable'],
  ['api.error_response.504', 'API returned 504 Gateway Timeout'],
  ['api.error_response.', 'API returned an error response'],
  ['api.exception', 'Unhandled server exception'],
  ['api.5xx', 'Server responded with 5xx'],
  ['process.unhandled_rejection', 'Server unhandled promise rejection (escaped all try/catch)'],
  ['process.uncaught_exception', 'Server uncaught exception (Node process)'],
  ['blipscan.forward_poll_failed', 'Blipscan indexer: forward-poll failed (new transactions not indexed this cycle)'],
  ['blipscan.backfill_failed', 'Blipscan indexer: backfill failed (historical transactions not indexed)'],
  ['blipscan.api_exception', 'Blipscan explorer: unhandled API exception'],
  ['worker.tick_failed', 'Worker tick failed (continued polling)'],
  ['db.slow_query', 'Slow DB query (>500 ms)'],
  ['db.slow_transaction', 'Slow DB transaction'],
  ['db.transaction_failed', 'DB transaction rolled back'],
  ['db.error.23505', 'DB unique constraint violation (duplicate key)'],
  ['db.error.23503', 'DB foreign-key violation'],
  ['db.error.23502', 'DB not-null violation'],
  ['db.error.23514', 'DB check constraint violation'],
  ['db.error.40001', 'DB serialization failure (concurrent write conflict)'],
  ['db.error.40P01', 'DB deadlock detected'],
  ['db.error.57P01', 'DB connection terminated by admin'],
  ['db.error.53300', 'DB too many connections'],
  ['db.error.', 'DB error'],
  ['ratelimit.triggered', 'Rate limit hit (user/IP exceeded allowed request rate)'],
  ['auth.session_revoked_or_expired', 'Request rejected — session was revoked or expired'],
  ['auth.no_active_sessions', 'Request rejected — actor has no active sessions'],
  ['order.stuck', 'Order stuck in non-terminal state past timeout'],
  ['order.timer_mismatch', 'Order timer mismatch between sides'],
  ['chat.undelivered', 'Chat message failed to deliver within 2 min'],
  ['escrow.state_mismatch', 'Completed order has no escrow funder (should be impossible)'],
  ['ledger.balance_drift', 'Merchant balance drifted from ledger sum'],
  ['idempotency.retry_storm', 'Client retried the same action aggressively'],
  ['anomaly.check_failed', 'Anomaly sweeper check itself threw'],
  // Namespace prefixes (fallbacks)
  ['solana.', 'Solana / blockchain error'],
  ['ui.api_fail.', 'API request failed'],
  ['ui.', 'Frontend error'],
  ['api.', 'Backend API error'],
  ['db.', 'Database issue'],
  ['auth.', 'Authentication issue'],
  ['ratelimit.', 'Rate limit event'],
  ['process.', 'Node process error'],
  ['ledger.', 'Ledger inconsistency'],
  ['idempotency.', 'Idempotency anomaly'],
  ['anomaly.', 'Anomaly sweeper issue'],
  ['blipscan.', 'Blipscan indexer / explorer issue'],
  ['worker.', 'Background worker issue'],
  ['order.', 'Order anomaly'],
  ['chat.', 'Chat issue'],
  ['escrow.', 'Escrow issue'],
  ['test.', '(diagnostic test entry)'],
  ['errorTracking.', '(error-tracking system self-test)'],
  ['manual.', '(manual test entry)'],
];

function describeType(t: string): string {
  for (const [prefix, label] of TYPE_LABELS) {
    if (t === prefix || t.startsWith(prefix)) return label;
  }
  return 'Unclassified error';
}

export default function AdminErrorLogsPage() {
  const [rows, setRows] = useState<ErrorLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>('');
  const [source, setSource] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [orderIdFilter, setOrderIdFilter] = useState<string>('');
  const [selected, setSelected] = useState<ErrorLogRow | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  // Sentry-style "issue grouping" view: collapse duplicate (type, message)
  // rows into one with an occurrence count. Defaults to true.
  const [grouped, setGrouped] = useState(true);
  // Track rows currently being resolved so we can disable the button + show spinner
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const getToken = () => {
    try {
      return localStorage.getItem('blip_admin_token') || '';
    } catch {
      return '';
    }
  };

  // Mark one row (or a whole group) as resolved. Optimistically removes
  // from the list so the UI feels instant. Reverts on error.
  const resolveRow = useCallback(async (row: ErrorLogRow) => {
    setResolvingIds((s) => new Set(s).add(row.id));
    // Optimistic: remove from UI immediately
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      const body = grouped
        ? { type: row.type, message: row.message, resolved: true }
        : { ids: [row.id], resolved: true };
      const res = await fetch(`/api/admin/error-logs`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Revert — put the row back if the server rejected
      setRows((prev) => [row, ...prev]);
      setError(`Failed to resolve: ${(err as Error).message}`);
    } finally {
      setResolvingIds((s) => {
        const next = new Set(s);
        next.delete(row.id);
        return next;
      });
    }
  }, [grouped]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (severity) qs.set('severity', severity);
      if (source) qs.set('source', source);
      if (typeFilter) qs.set('type', typeFilter);
      if (orderIdFilter) qs.set('orderId', orderIdFilter);
      if (grouped) qs.set('grouped', 'true');
      qs.set('limit', '200');

      const res = await fetch(`/api/admin/error-logs?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (res.status === 404) {
        setError(
          'Error tracking is disabled. Set ENABLE_ERROR_TRACKING=true on the server.',
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
  }, [severity, source, typeFilter, orderIdFilter, grouped]);

  useEffect(() => {
    fetchLogs();
    const id = setInterval(fetchLogs, 10_000);
    return () => clearInterval(id);
  }, [fetchLogs]);

  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { INFO: 0, WARN: 0, ERROR: 0, CRITICAL: 0 };
    // In grouped mode, each row represents N occurrences — sum them so the
    // cards show the true number of events, not the number of unique issues.
    for (const r of rows) {
      const n = grouped ? (r.occurrence_count ?? 1) : 1;
      counts[r.severity] = (counts[r.severity] || 0) + n;
    }
    return counts;
  }, [rows, grouped]);

  const secondsAgo = Math.max(0, Math.floor((Date.now() - lastRefresh.getTime()) / 1000));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Admin header — matches other admin pages */}
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
              <Link
                href="/admin"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Console
              </Link>
              <Link
                href="/admin/live"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Live Feed
              </Link>
              <Link
                href="/admin/access-control"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Access Control
              </Link>
              <Link
                href="/admin/accounts"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Accounts
              </Link>
              <Link
                href="/admin/disputes"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Disputes
              </Link>
              <Link
                href="/admin/monitor"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Monitor
              </Link>
              <Link
                href="/admin/error-logs"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-accent-subtle text-foreground transition-colors"
              >
                Error Logs
              </Link>
              <Link
                href="/admin/usdt-inr-price"
                className="px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle transition-colors"
              >
                Price
              </Link>
            </nav>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={async () => {
                setTesting(true);
                setTestResult(null);
                const testId = `admin-test-${Date.now().toString(36)}`;
                let sentryOk = false;
                let localOk = false;

                // 1) Fire to Sentry via the proper @sentry/nextjs SDK.
                // The SDK doesn't expose itself on window.Sentry — import it
                // dynamically instead. beforeSend in sentry.client.config.ts
                // allows this through because it's tagged with testId.
                try {
                  const SentryMod = await import('@sentry/nextjs');
                  if (typeof SentryMod.captureException === 'function') {
                    SentryMod.captureException(
                      new Error(`[Admin test] Sentry verification event ${testId}`),
                      { tags: { testId, source: 'admin_error_logs_page' } }
                    );
                    // Force flush so the event actually leaves the browser
                    // before we report success (avoids false-positive "ok").
                    if (typeof SentryMod.flush === 'function') {
                      await SentryMod.flush(2000).catch(() => {});
                    }
                    sentryOk = true;
                  }
                } catch { /* swallow */ }

                // 2) Fire to our own error_logs via the ingest endpoint so
                // the row shows up in this very dashboard on the next refresh.
                try {
                  const res = await fetch('/api/client-errors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      type: 'test.admin_button',
                      severity: 'INFO',
                      message: `[Admin test] Verification event ${testId}`,
                      metadata: { testId, triggeredFrom: 'admin/error-logs' },
                    }),
                    keepalive: true,
                    credentials: 'same-origin',
                  });
                  localOk = res.ok || res.status === 204;
                } catch { /* swallow */ }

                const parts: string[] = [];
                parts.push(localOk ? '✅ error_logs table' : '❌ error_logs table');
                parts.push(sentryOk ? '✅ Sentry' : '❌ Sentry (SDK init failed — check NEXT_PUBLIC_SENTRY_DSN)');
                setTestResult({
                  ok: localOk && sentryOk,
                  message: parts.join('  ·  '),
                });

                // Refresh the table so the admin sees the new row appear
                setTimeout(() => { fetchLogs(); }, 800);
                setTesting(false);
                setTimeout(() => setTestResult(null), 10_000);
              }}
              disabled={testing}
              className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40"
              title="Fire a verification event to both error_logs and Sentry"
            >
              {testing ? 'Testing…' : 'Test Sentry + Logs'}
            </button>
            <button
              onClick={async () => {
                if (!confirm('Remove all diagnostic / test log entries (test.*, errorTracking.*, manual.*)?')) return;
                try {
                  const res = await fetch('/api/admin/error-logs?scope=test', {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${getToken()}` },
                  });
                  const data = await res.json().catch(() => ({}));
                  if (res.ok && data?.success) {
                    fetchLogs();
                  } else {
                    alert(data?.error || `Failed (HTTP ${res.status})`);
                  }
                } catch (e) {
                  alert((e as Error).message || 'Network error');
                }
              }}
              className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-foreground/[0.04] border border-foreground/[0.08] text-foreground/60 hover:bg-foreground/[0.08]"
              title="Remove test.*, errorTracking.*, manual.* rows"
            >
              Clear Test Logs
            </button>
            <button
              onClick={async () => {
                if (!confirm('Mark ALL currently-visible entries as resolved? (slow queries, heartbeat aborts, etc. — they stay in DB for audit but hide from the list)')) return;
                try {
                  // Resolve every row currently in view — groups resolve by (type, message)
                  const results = await Promise.all(
                    rows.map((r) =>
                      fetch('/api/admin/error-logs', {
                        method: 'PATCH',
                        headers: {
                          Authorization: `Bearer ${getToken()}`,
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(
                          grouped
                            ? { type: r.type, message: r.message, resolved: true }
                            : { ids: [r.id], resolved: true },
                        ),
                      }).then((res) => res.ok),
                    ),
                  );
                  const succeeded = results.filter(Boolean).length;
                  setRows([]);
                  alert(`Resolved ${succeeded} ${grouped ? 'groups' : 'entries'}.`);
                  fetchLogs();
                } catch (e) {
                  alert((e as Error).message || 'Network error');
                }
              }}
              className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-emerald-500/[0.08] border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/[0.15]"
              title="Mark every visible row as resolved (hides from default view)"
            >
              ✓ Resolve All Visible
            </button>
            <button
              onClick={() => setGrouped(g => !g)}
              className={`px-3 py-[5px] rounded-md text-[12px] font-medium border transition-colors ${
                grouped
                  ? 'bg-sky-500/15 border-sky-500/30 text-sky-300 hover:bg-sky-500/25'
                  : 'bg-foreground/[0.04] border-foreground/[0.08] text-foreground/60 hover:bg-foreground/[0.08]'
              }`}
              title="Group identical errors into one row with occurrence count"
            >
              {grouped ? 'Grouped ✓' : 'Grouped'}
            </button>
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-primary/15 border border-primary/30 text-primary hover:bg-primary/25 disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold">Error Logs</h1>
          <p className="text-xs text-foreground/50">
            Unified error + business-anomaly stream. Read-only.
          </p>
        </div>

        {/* Severity summary */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          {(['INFO', 'WARN', 'ERROR', 'CRITICAL'] as const).map((s) => (
            <div key={s} className={`rounded-lg border px-3 py-2 text-xs ${SEV_STYLES[s]}`}>
              <div className="font-bold tracking-wide">{s}</div>
              <div className="text-lg font-mono tabular-nums">{severityCounts[s] || 0}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="bg-card border border-border rounded px-2 py-2"
          >
            <option value="">All severities</option>
            <option>INFO</option>
            <option>WARN</option>
            <option>ERROR</option>
            <option>CRITICAL</option>
          </select>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-card border border-border rounded px-2 py-2"
          >
            <option value="">All sources</option>
            <option>frontend</option>
            <option>backend</option>
            <option>worker</option>
          </select>
          <input
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            placeholder="Type prefix (e.g. api.)"
            className="bg-card border border-border rounded px-2 py-2"
          />
          <input
            value={orderIdFilter}
            onChange={(e) => setOrderIdFilter(e.target.value)}
            placeholder="Order UUID"
            className="bg-card border border-border rounded px-2 py-2 font-mono"
          />
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {testResult && (
          <div
            className={`mb-3 rounded-lg border px-3 py-2 text-sm flex items-center justify-between ${
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            }`}
          >
            <div>
              <span className="font-bold">
                {testResult.ok ? 'Test event sent!' : 'Test event partially sent'}
              </span>
              <span className="ml-2 font-mono text-xs">{testResult.message}</span>
            </div>
            <div className="text-xs opacity-70">
              Check the row below (type <span className="font-mono">test.admin_button</span>) and your
              <a
                href="https://sentry.io/issues/"
                target="_blank"
                rel="noreferrer"
                className="underline ml-1 hover:text-white"
              >
                Sentry Issues tab
              </a>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-card text-foreground/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">
                  {grouped ? 'Last seen' : 'When'}
                </th>
                <th className="text-left px-3 py-2 font-medium">Severity</th>
                {grouped && (
                  <th className="text-right px-3 py-2 font-medium w-16">Count</th>
                )}
                <th className="text-left px-3 py-2 font-medium">What happened</th>
                <th className="text-left px-3 py-2 font-medium">Details</th>
                <th className="text-left px-3 py-2 font-medium">Source</th>
                <th className="text-right px-3 py-2 font-medium w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={grouped ? 7 : 6} className="px-3 py-8 text-center text-foreground/40">
                    No error logs yet.
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => {
                const when = grouped
                  ? r.last_seen_at || r.created_at
                  : r.created_at;
                const count = r.occurrence_count ?? 1;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="border-t border-border hover:bg-accent-subtle cursor-pointer"
                  >
                    <td className="px-3 py-2 font-mono text-foreground/60 whitespace-nowrap">
                      {new Date(when).toLocaleString()}
                      {grouped && r.first_seen_at && r.first_seen_at !== r.last_seen_at && (
                        <div className="text-[10px] text-foreground/30">
                          first: {new Date(r.first_seen_at).toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold ${SEV_STYLES[r.severity]}`}
                      >
                        {r.severity}
                      </span>
                    </td>
                    {grouped && (
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded font-mono font-bold tabular-nums text-[11px] ${
                            count >= 10
                              ? 'bg-red-500/15 text-red-300 border border-red-500/30'
                              : count >= 3
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                : 'bg-foreground/[0.04] text-foreground/60 border border-foreground/[0.08]'
                          }`}
                        >
                          ×{count}
                        </span>
                      </td>
                    )}
                    <td className="px-3 py-2 text-foreground/90">
                      <div className="font-medium">{describeType(r.type)}</div>
                      <div className="text-[10px] font-mono text-foreground/40">{r.type}</div>
                    </td>
                    <td
                      className="px-3 py-2 text-foreground/70 truncate max-w-[340px]"
                      title={r.message}
                    >
                      {r.message}
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground/50">{r.source}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          resolveRow(r);
                        }}
                        disabled={resolvingIds.has(r.id)}
                        className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
                        title={grouped ? `Resolve all ×${r.occurrence_count ?? 1} occurrences` : 'Resolve this error'}
                      >
                        {resolvingIds.has(r.id) ? '…' : '✓ Resolve'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="max-w-2xl w-full bg-background rounded-xl border border-border p-5 max-h-[80vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3 gap-3">
              <div>
                <h2 className="font-bold">{describeType(selected.type)}</h2>
                <div className="text-[10px] font-mono text-foreground/40 mt-0.5">
                  {selected.type}
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-foreground/40 hover:text-foreground shrink-0"
              >
                ✕
              </button>
            </div>
            <div className="text-sm mb-3 text-foreground/90 whitespace-pre-wrap break-words">
              {selected.message}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-foreground/60 mb-3">
              <div>
                Severity: <span className="text-foreground">{selected.severity}</span>
              </div>
              <div>
                Source: <span className="text-foreground">{selected.source}</span>
              </div>
              <div>
                Order:{' '}
                <span className="font-mono text-foreground">{selected.order_id || '—'}</span>
              </div>
              <div>
                User:{' '}
                <span className="font-mono text-foreground">{selected.user_id || '—'}</span>
              </div>
              <div>
                Merchant:{' '}
                <span className="font-mono text-foreground">
                  {selected.merchant_id || '—'}
                </span>
              </div>
              <div>
                When:{' '}
                <span className="text-foreground">
                  {new Date(selected.last_seen_at || selected.created_at).toLocaleString()}
                </span>
              </div>
              {selected.occurrence_count && selected.occurrence_count > 1 && (
                <>
                  <div>
                    Occurrences:{' '}
                    <span className="font-bold text-foreground">×{selected.occurrence_count}</span>
                  </div>
                  {selected.first_seen_at && (
                    <div>
                      First seen:{' '}
                      <span className="text-foreground">
                        {new Date(selected.first_seen_at).toLocaleString()}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="text-[10px] font-mono text-foreground/40 uppercase mb-1">
              Metadata
            </div>
            <pre className="bg-card rounded p-3 text-[11px] overflow-auto border border-border">
              {JSON.stringify(selected.metadata, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
