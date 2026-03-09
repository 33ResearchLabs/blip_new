'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface DebugData {
  order: any;
  events: any[];
  ledger_entries: any[];
  tx: any;
  invariants: { ok: boolean; violations: string[] };
  meta: any;
}

export default function OrderDebugPage() {
  const params = useParams();
  const orderId = params.id as string;

  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [tokenInput, setTokenInput] = useState('');
  const [data, setData] = useState<DebugData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Action modal state
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem('blip_admin_token'));
  }, []);

  const fetchDebug = useCallback(async (adminToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/orders/${orderId}/debug`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401) {
        localStorage.removeItem('blip_admin_token');
        setToken(null);
        return;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (token) fetchDebug(token);
  }, [token, fetchDebug]);

  const handleCancel = async () => {
    if (!token) return;
    setActionLoading(true);
    setActionResult(null);
    try {
      const res = await fetch(`/api/ops/orders/${orderId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'cancel', reason: cancelReason || 'Admin cancellation via Ops Console' }),
      });
      const json = await res.json();
      if (!res.ok) {
        setActionResult(`Error: ${json.error || res.status}`);
      } else {
        setActionResult('Order cancelled. Refreshing...');
        setShowCancel(false);
        setTimeout(() => fetchDebug(token), 800);
      }
    } catch (err: any) {
      setActionResult(`Error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  // Hydration loading
  if (token === undefined) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-gray-500 text-sm font-mono">Loading...</p>
      </div>
    );
  }

  // Auth gate
  if (!token) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-full max-w-sm">
          <h1 className="text-lg font-mono font-bold text-white mb-1">ops / orders</h1>
          <p className="text-xs text-gray-500 mb-6">Admin authentication required</p>
          <input
            type="text"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tokenInput.trim()) {
                localStorage.setItem('blip_admin_token', tokenInput.trim());
                setToken(tokenInput.trim());
              }
            }}
            placeholder="Paste admin token..."
            className="w-full bg-gray-900 border border-white/10 rounded px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-white/30 mb-3"
          />
          <button
            onClick={() => {
              if (tokenInput.trim()) {
                localStorage.setItem('blip_admin_token', tokenInput.trim());
                setToken(tokenInput.trim());
              }
            }}
            className="w-full py-2 bg-white/10 rounded text-sm font-mono hover:bg-white/20 transition-colors"
          >
            authenticate
          </button>
        </div>
      </div>
    );
  }

  const order = data?.order;
  const canCancel = order && !['completed', 'cancelled', 'expired'].includes(order.status as string);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3 font-mono text-sm">
            <Link href="/ops" className="text-gray-500 hover:text-gray-300">ops</Link>
            <span className="text-gray-700">/</span>
            <Link href="/ops/disputes" className="text-gray-500 hover:text-gray-300">orders</Link>
            <span className="text-gray-700">/</span>
            <span className="text-white truncate max-w-xs">{orderId.slice(0, 12)}…</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchDebug(token)}
              disabled={loading}
              className="text-xs px-3 py-1.5 bg-white/5 rounded hover:bg-white/10 transition-colors font-mono disabled:opacity-50"
            >
              refresh
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('blip_admin_token');
                setToken(null);
              }}
              className="text-xs text-gray-600 hover:text-gray-400 font-mono"
            >
              sign out
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {loading && !data && <p className="text-gray-500 text-sm font-mono">Loading...</p>}
        {error && <p className="text-red-400 text-sm font-mono">Error: {error}</p>}

        {data && (
          <>
            {/* Order Summary + Invariants */}
            <div className="bg-gray-900 border border-white/10 rounded-lg p-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-base font-bold">{order?.order_number}</span>
                    <StatusBadge status={order?.status} />
                  </div>
                  <div className="text-gray-500 text-xs font-mono mt-1">{orderId}</div>
                </div>
                {/* Invariants */}
                {data.invariants.ok ? (
                  <span className="text-emerald-400 text-xs font-mono bg-emerald-900/20 border border-emerald-800/50 px-3 py-1.5 rounded">
                    ✓ All invariants pass
                  </span>
                ) : (
                  <div className="text-right">
                    <span className="text-red-400 text-xs font-mono bg-red-900/20 border border-red-800/50 px-3 py-1.5 rounded block mb-2">
                      ⚠ {data.invariants.violations.length} violation{data.invariants.violations.length !== 1 ? 's' : ''}
                    </span>
                    <ul className="text-xs text-red-400 font-mono text-right space-y-0.5">
                      {data.invariants.violations.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm font-mono">
                <Field label="type" value={order?.type} />
                <Field label="crypto" value={`${order?.crypto_amount} USDC`} />
                <Field label="fiat" value={`${order?.fiat_amount} AED`} />
                <Field label="version" value={order?.order_version} />
                <Field label="user_id" value={order?.user_id?.slice(0, 12)} />
                <Field label="merchant_id" value={order?.merchant_id?.slice(0, 12)} />
                {order?.buyer_merchant_id && (
                  <Field label="buyer_merchant" value={order.buyer_merchant_id.slice(0, 12)} />
                )}
                <Field label="created" value={formatTimestamp(order?.created_at)} />
                {order?.accepted_at && <Field label="accepted" value={formatTimestamp(order.accepted_at)} />}
                {order?.escrowed_at && <Field label="escrowed" value={formatTimestamp(order.escrowed_at)} />}
                {order?.payment_sent_at && <Field label="paid" value={formatTimestamp(order.payment_sent_at)} />}
                {order?.completed_at && <Field label="completed" value={formatTimestamp(order.completed_at)} />}
                {order?.cancelled_at && <Field label="cancelled" value={formatTimestamp(order.cancelled_at)} />}
                {order?.expires_at && <Field label="expires" value={formatTimestamp(order.expires_at)} />}
                {order?.escrow_tx_hash && (
                  <Field label="escrow_tx" value={order.escrow_tx_hash.slice(0, 16) + '…'} />
                )}
                {order?.release_tx_hash && (
                  <Field label="release_tx" value={order.release_tx_hash.slice(0, 16) + '…'} />
                )}
              </div>
            </div>

            {/* Admin Actions */}
            {canCancel && (
              <div className="bg-gray-900 border border-white/10 rounded-lg p-4">
                <h2 className="text-sm font-mono text-gray-400 mb-3">Admin Actions</h2>
                {actionResult && (
                  <p className={`text-xs font-mono mb-3 ${actionResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                    {actionResult}
                  </p>
                )}
                {!showCancel ? (
                  <button
                    onClick={() => setShowCancel(true)}
                    className="text-sm px-4 py-2 bg-red-900/30 border border-red-800/50 text-red-400 rounded hover:bg-red-900/50 transition-colors font-mono"
                  >
                    Force Cancel
                  </button>
                ) : (
                  <div className="flex items-start gap-3">
                    <input
                      type="text"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Reason (optional)..."
                      className="flex-1 bg-black border border-white/10 rounded px-3 py-2 text-sm font-mono text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
                    />
                    <button
                      onClick={handleCancel}
                      disabled={actionLoading}
                      className="px-4 py-2 bg-red-900/50 border border-red-700 text-red-300 rounded text-sm font-mono hover:bg-red-900/70 transition-colors disabled:opacity-50"
                    >
                      {actionLoading ? 'Cancelling…' : 'Confirm Cancel'}
                    </button>
                    <button
                      onClick={() => setShowCancel(false)}
                      className="px-3 py-2 text-gray-500 hover:text-gray-300 text-sm font-mono"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Event Timeline */}
            {data.events.length > 0 && (
              <div>
                <h2 className="text-sm font-mono text-gray-400 mb-3">
                  Event Timeline ({data.events.length})
                </h2>
                <div className="bg-gray-900 border border-white/10 rounded-lg overflow-hidden">
                  <table className="w-full text-sm font-mono">
                    <thead>
                      <tr className="text-gray-500 text-left border-b border-white/10 text-xs">
                        <th className="py-2 px-4">#</th>
                        <th className="py-2 pr-4">event</th>
                        <th className="py-2 pr-4">transition</th>
                        <th className="py-2 pr-4">actor</th>
                        <th className="py-2 pr-4">request_id</th>
                        <th className="py-2 pr-4">time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((ev, i) => (
                        <tr key={ev.id as string} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-2 px-4 text-gray-600">{i + 1}</td>
                          <td className="py-2 pr-4 text-white">{ev.event_type as string}</td>
                          <td className="py-2 pr-4 text-gray-400 text-xs">
                            {ev.old_status && ev.new_status
                              ? `${ev.old_status} → ${ev.new_status}`
                              : ev.new_status || '-'}
                          </td>
                          <td className="py-2 pr-4 text-gray-400 text-xs">
                            {ev.actor_type as string}:{(ev.actor_id as string)?.slice(0, 8)}
                          </td>
                          <td className="py-2 pr-4">
                            {ev.request_id ? (
                              <button
                                onClick={() => navigator.clipboard.writeText(ev.request_id as string)}
                                title="Click to copy"
                                className="text-gray-600 hover:text-gray-400 text-xs"
                              >
                                {(ev.request_id as string).slice(0, 8)}…
                              </button>
                            ) : (
                              <span className="text-red-500 text-xs">null</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-gray-400 text-xs">
                            {formatTimestamp(ev.created_at as string)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Ledger Entries */}
            {data.ledger_entries.length > 0 && (
              <div>
                <h2 className="text-sm font-mono text-gray-400 mb-3">
                  Ledger Entries ({data.ledger_entries.length})
                </h2>
                <div className="bg-gray-900 border border-white/10 rounded-lg overflow-x-auto">
                  <table className="w-full text-sm font-mono">
                    <thead>
                      <tr className="text-gray-500 text-left border-b border-white/10 text-xs">
                        <th className="py-2 px-4">entry_type</th>
                        <th className="py-2 pr-4">amount</th>
                        <th className="py-2 pr-4">asset</th>
                        <th className="py-2 pr-4">account</th>
                        <th className="py-2 pr-4">balance</th>
                        <th className="py-2 pr-4">idempotency_key</th>
                        <th className="py-2 pr-4">time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ledger_entries.map((le) => (
                        <tr key={le.id as string} className="border-b border-white/5 hover:bg-white/5">
                          <td className="py-2 px-4">
                            <EntryTypeBadge type={le.entry_type as string} />
                          </td>
                          <td className="py-2 pr-4 text-gray-300">{le.amount as string}</td>
                          <td className="py-2 pr-4 text-gray-400">{le.asset as string}</td>
                          <td className="py-2 pr-4 text-gray-500 text-xs">
                            {le.account_type as string}:{(le.account_id as string)?.slice(0, 8)}
                          </td>
                          <td className="py-2 pr-4 text-gray-400 text-xs">
                            {le.balance_before as string} → {le.balance_after as string}
                          </td>
                          <td className="py-2 pr-4">
                            {le.idempotency_key ? (
                              <button
                                onClick={() => navigator.clipboard.writeText(le.idempotency_key as string)}
                                title="Click to copy"
                                className="text-gray-600 hover:text-gray-400 text-xs"
                              >
                                {(le.idempotency_key as string).slice(0, 12)}…
                              </button>
                            ) : (
                              <span className="text-gray-700 text-xs">-</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-gray-400 text-xs">
                            {formatTimestamp(le.created_at as string)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TX Info */}
            {data.tx && (
              <div className="bg-gray-900 border border-white/10 rounded-lg p-4">
                <h2 className="text-sm font-mono text-gray-400 mb-3">Transaction</h2>
                <pre className="text-xs text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(data.tx, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
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

function EntryTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    escrow_lock: 'text-purple-400',
    escrow_release: 'text-emerald-400',
    escrow_refund: 'text-amber-400',
    credit: 'text-emerald-400',
    debit: 'text-red-400',
    fee: 'text-gray-400',
  };
  return <span className={`text-xs ${colors[type] || 'text-gray-300'}`}>{type}</span>;
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-gray-300 truncate">{value ?? '-'}</div>
    </div>
  );
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('en-GB', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return ts;
  }
}
