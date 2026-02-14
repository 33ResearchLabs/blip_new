'use client';

/**
 * Ops Debug Page (localhost-only)
 *
 * Tabs: Outbox | Stuck Orders | Workers | Order Search
 * Route: /ops
 *
 * Production guard: renders 404 if NODE_ENV === 'production'.
 */

import { useState, useEffect, useCallback } from 'react';

type Tab = 'outbox' | 'stuck' | 'workers' | 'search';

export default function OpsPage() {
  const [tab, setTab] = useState<Tab>('outbox');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [blocked, setBlocked] = useState(false);

  const fetchData = useCallback(async (currentTab: Tab, orderId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ tab: currentTab });
      if (currentTab === 'search' && orderId) {
        params.set('order_id', orderId);
      }
      const res = await fetch(`/api/ops?${params}`);
      if (res.status === 404) {
        setBlocked(true);
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      setData(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'search') fetchData(tab);
  }, [tab, fetchData]);

  // Auto-refresh non-search tabs every 10s
  useEffect(() => {
    if (tab === 'search') return;
    const iv = setInterval(() => fetchData(tab), 10000);
    return () => clearInterval(iv);
  }, [tab, fetchData]);

  if (blocked) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-gray-500">Not found</p>
      </div>
    );
  }

  const handleSearch = () => {
    if (searchInput.trim()) fetchData('search', searchInput.trim());
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div>
            <h1 className="text-lg font-mono font-bold tracking-tight">ops</h1>
            <p className="text-xs text-gray-500 mt-0.5">localhost debug panel</p>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-600">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            dev
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/10 px-6">
        <div className="max-w-7xl mx-auto flex gap-0">
          {(['outbox', 'stuck', 'workers', 'search'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-mono border-b-2 transition-colors ${
                tab === t
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {loading && !data && <p className="text-gray-500 text-sm">Loading...</p>}
        {error && <p className="text-red-400 text-sm">Error: {error}</p>}

        {tab === 'outbox' && data?.tab === 'outbox' && <OutboxPanel data={data} />}
        {tab === 'stuck' && data?.tab === 'stuck' && <StuckPanel data={data} />}
        {tab === 'workers' && data?.tab === 'workers' && <WorkersPanel data={data} />}
        {tab === 'search' && (
          <SearchPanel
            data={data?.tab === 'search' ? data : null}
            searchInput={searchInput}
            setSearchInput={setSearchInput}
            onSearch={handleSearch}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}

// ── Outbox Panel ──

function OutboxPanel({ data }: { data: any }) {
  const rows = data.rows || [];
  const counts = data.counts || {};

  return (
    <div>
      <div className="flex gap-4 mb-4">
        {Object.entries(counts).map(([status, count]) => (
          <div key={status} className="bg-gray-900 border border-white/10 rounded px-3 py-2">
            <div className="text-xs text-gray-500">{status}</div>
            <div className="text-lg font-mono">{count as number}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-500 text-sm">No pending outbox rows.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-gray-500 text-left border-b border-white/10">
                <th className="py-2 pr-3">order_id</th>
                <th className="py-2 pr-3">event</th>
                <th className="py-2 pr-3">attempts</th>
                <th className="py-2 pr-3">age</th>
                <th className="py-2 pr-3">last_error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id} className="border-b border-white/5 hover:bg-gray-900/50">
                  <td className="py-1.5 pr-3 text-blue-400">{row.order_id?.slice(0, 8)}</td>
                  <td className="py-1.5 pr-3">{row.event_type}</td>
                  <td className="py-1.5 pr-3">{row.attempts}/{row.max_attempts}</td>
                  <td className="py-1.5 pr-3 text-gray-400">{formatAge(row.age_sec)}</td>
                  <td className="py-1.5 pr-3 text-red-400 truncate max-w-xs">{row.last_error || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Stuck Orders Panel ──

function StuckPanel({ data }: { data: any }) {
  const totals = data.totals || {};
  const buckets = data.buckets || [];
  const expired = data.expiredNotTerminal || [];

  return (
    <div>
      {/* Totals */}
      <div className="flex gap-4 mb-6">
        {Object.entries(totals).map(([status, count]) => (
          <div key={status} className="bg-gray-900 border border-white/10 rounded px-3 py-2">
            <div className="text-xs text-gray-500">{status}</div>
            <div className="text-lg font-mono">{count as number}</div>
          </div>
        ))}
      </div>

      {/* Age buckets */}
      <h3 className="text-sm text-gray-400 mb-2">Age Buckets</h3>
      {buckets.length === 0 ? (
        <p className="text-gray-500 text-sm mb-6">No active orders.</p>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="text-gray-500 text-left border-b border-white/10">
                <th className="py-2 pr-3">status</th>
                <th className="py-2 pr-3">bucket</th>
                <th className="py-2 pr-3">count</th>
                <th className="py-2 pr-3">oldest</th>
                <th className="py-2 pr-3">newest</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b: any, i: number) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-1.5 pr-3">{b.status}</td>
                  <td className="py-1.5 pr-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${bucketColor(b.bucket)}`}>
                      {b.bucket}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3">{b.count}</td>
                  <td className="py-1.5 pr-3 text-gray-400">{b.oldest_age_min}m</td>
                  <td className="py-1.5 pr-3 text-gray-400">{b.newest_age_min}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Past-expiry orders */}
      {expired.length > 0 && (
        <>
          <h3 className="text-sm text-amber-400 mb-2">Past Expiry (not terminal)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="text-gray-500 text-left border-b border-white/10">
                  <th className="py-2 pr-3">order</th>
                  <th className="py-2 pr-3">status</th>
                  <th className="py-2 pr-3">expires_at</th>
                </tr>
              </thead>
              <tbody>
                {expired.map((o: any) => (
                  <tr key={o.id} className="border-b border-white/5">
                    <td className="py-1.5 pr-3 text-blue-400">{o.order_number || o.id.slice(0, 8)}</td>
                    <td className="py-1.5 pr-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="py-1.5 pr-3 text-red-400">{o.expires_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Workers Panel ──

function WorkersPanel({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      {['outbox', 'expiry'].map((name) => {
        const w = data[name] || {};
        const isRunning = w.lastRun;
        const ageSec = isRunning
          ? Math.round((Date.now() - new Date(w.lastRun).getTime()) / 1000)
          : null;

        return (
          <div key={name} className="bg-gray-900 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-mono text-sm">{name}</h3>
              <span className={`inline-flex items-center gap-1.5 text-xs ${
                isRunning ? 'text-emerald-400' : 'text-red-400'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  isRunning ? 'bg-emerald-500' : 'bg-red-500'
                }`} />
                {isRunning ? 'running' : 'stopped'}
              </span>
            </div>
            {isRunning ? (
              <div className="grid grid-cols-2 gap-3 text-sm font-mono">
                <div>
                  <div className="text-xs text-gray-500">last run</div>
                  <div className="text-gray-300">{ageSec}s ago</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">
                    {name === 'outbox' ? 'total processed' : 'total expired'}
                  </div>
                  <div className="text-gray-300">
                    {name === 'outbox' ? w.totalProcessed ?? '-' : w.totalExpired ?? '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">last batch</div>
                  <div className="text-gray-300">{w.lastBatchSize ?? '-'}</div>
                </div>
                {w.pid && (
                  <div>
                    <div className="text-xs text-gray-500">pid</div>
                    <div className="text-gray-300">{w.pid}</div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">Worker not running or no heartbeat file.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Search Panel ──

function SearchPanel({
  data,
  searchInput,
  setSearchInput,
  onSearch,
  loading,
}: {
  data: any;
  searchInput: string;
  setSearchInput: (v: string) => void;
  onSearch: () => void;
  loading: boolean;
}) {
  return (
    <div>
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          placeholder="Order ID or order number..."
          className="flex-1 bg-gray-900 border border-white/10 rounded px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
        />
        <button
          onClick={onSearch}
          disabled={loading}
          className="px-4 py-2 bg-white/10 rounded text-sm font-mono hover:bg-white/20 transition-colors disabled:opacity-50"
        >
          search
        </button>
      </div>

      {data && (
        <>
          {data.orders?.length === 0 ? (
            <p className="text-gray-500 text-sm">No orders found.</p>
          ) : (
            <>
              {/* Order details */}
              {data.orders?.map((order: any) => (
                <div key={order.id} className="bg-gray-900 border border-white/10 rounded-lg p-4 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="font-mono text-sm text-blue-400">{order.order_number}</span>
                      <span className="text-gray-500 text-xs ml-2">{order.id}</span>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm font-mono">
                    <Field label="type" value={order.type} />
                    <Field label="crypto" value={`${order.crypto_amount} USDC`} />
                    <Field label="fiat" value={`${order.fiat_amount} AED`} />
                    <Field label="version" value={order.order_version} />
                    <Field label="user_id" value={order.user_id?.slice(0, 8)} />
                    <Field label="merchant_id" value={order.merchant_id?.slice(0, 8)} />
                    {order.buyer_merchant_id && (
                      <Field label="buyer_merchant" value={order.buyer_merchant_id?.slice(0, 8)} />
                    )}
                    <Field label="created" value={formatTimestamp(order.created_at)} />
                    {order.accepted_at && <Field label="accepted" value={formatTimestamp(order.accepted_at)} />}
                    {order.escrowed_at && <Field label="escrowed" value={formatTimestamp(order.escrowed_at)} />}
                    {order.payment_sent_at && <Field label="paid" value={formatTimestamp(order.payment_sent_at)} />}
                    {order.completed_at && <Field label="completed" value={formatTimestamp(order.completed_at)} />}
                    {order.cancelled_at && <Field label="cancelled" value={formatTimestamp(order.cancelled_at)} />}
                    {order.expires_at && <Field label="expires" value={formatTimestamp(order.expires_at)} />}
                    {order.escrow_tx_hash && <Field label="escrow_tx" value={order.escrow_tx_hash.slice(0, 16)} />}
                    {order.release_tx_hash && <Field label="release_tx" value={order.release_tx_hash.slice(0, 16)} />}
                  </div>
                </div>
              ))}

              {/* Event timeline */}
              {data.events?.length > 0 && (
                <div>
                  <h3 className="text-sm text-gray-400 mb-2 font-mono">Event Timeline</h3>
                  <div className="space-y-0">
                    {data.events.map((ev: any, i: number) => (
                      <div
                        key={ev.id}
                        className="flex items-start gap-3 border-l-2 border-white/10 pl-3 py-2 hover:bg-gray-900/30"
                      >
                        <span className="text-xs text-gray-500 font-mono w-4 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono">{ev.event_type}</span>
                            {ev.old_status && ev.new_status && (
                              <span className="text-xs text-gray-500">
                                {ev.old_status} → {ev.new_status}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {ev.actor_type}:{ev.actor_id?.slice(0, 8)} at {formatTimestamp(ev.created_at)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Shared Components ──

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-gray-300 truncate">{value ?? '-'}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-700 text-gray-300',
    accepted: 'bg-blue-900/50 text-blue-300',
    escrowed: 'bg-purple-900/50 text-purple-300',
    payment_sent: 'bg-amber-900/50 text-amber-300',
    payment_confirmed: 'bg-amber-900/50 text-amber-300',
    completed: 'bg-emerald-900/50 text-emerald-300',
    cancelled: 'bg-red-900/50 text-red-300',
    expired: 'bg-gray-800 text-gray-400',
    disputed: 'bg-red-900/50 text-red-300',
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono ${colors[status] || 'bg-gray-800 text-gray-400'}`}>
      {status}
    </span>
  );
}

// ── Helpers ──

function formatAge(seconds: number | null): string {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function bucketColor(bucket: string): string {
  switch (bucket) {
    case '0-15m': return 'bg-emerald-900/50 text-emerald-300';
    case '15m-1h': return 'bg-amber-900/50 text-amber-300';
    case '1h-24h': return 'bg-red-900/50 text-red-300';
    case '24h+': return 'bg-red-800 text-red-200';
    default: return 'bg-gray-800 text-gray-400';
  }
}
