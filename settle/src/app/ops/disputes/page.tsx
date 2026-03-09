'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

type Filter = 'needs_attention' | 'disputed' | 'stuck';

interface Order {
  id: string;
  order_number: string;
  status: string;
  type: string;
  crypto_amount: string;
  fiat_amount: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  user_id: string;
  order_version: number;
  created_at: string;
  escrowed_at: string | null;
  payment_sent_at: string | null;
  expires_at: string | null;
  dispute_reason?: string;
  disputed_at?: string;
  age_sec: number;
}

export default function OpsDisputesPage() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [tokenInput, setTokenInput] = useState('');
  const [filter, setFilter] = useState<Filter>('disputed');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem('blip_admin_token'));
  }, []);

  const fetchOrders = useCallback(async (currentFilter: Filter, adminToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/orders?filter=${currentFilter}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (res.status === 401) {
        localStorage.removeItem('blip_admin_token');
        setToken(null);
        return;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) fetchOrders(filter, token);
  }, [filter, token, fetchOrders]);

  // Loading state (hydration)
  if (token === undefined) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-gray-500 text-sm font-mono">Loading...</p>
      </div>
    );
  }

  // Not authenticated
  if (!token) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-full max-w-sm">
          <h1 className="text-lg font-mono font-bold text-white mb-1">ops / disputes</h1>
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

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <Link href="/ops" className="text-gray-500 hover:text-gray-300 font-mono text-sm">
              ops
            </Link>
            <span className="text-gray-700">/</span>
            <h1 className="text-sm font-mono font-bold">disputes</h1>
          </div>
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

      {/* Filter tabs */}
      <div className="border-b border-white/10 px-6">
        <div className="max-w-7xl mx-auto flex gap-0">
          {(['needs_attention', 'disputed', 'stuck'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2.5 text-sm font-mono border-b-2 transition-colors ${
                filter === f
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {loading && <p className="text-gray-500 text-sm font-mono">Loading...</p>}
        {error && <p className="text-red-400 text-sm font-mono">Error: {error}</p>}

        {!loading && !error && (
          <>
            <div className="mb-3 text-xs text-gray-500 font-mono">{orders.length} order{orders.length !== 1 ? 's' : ''}</div>
            {orders.length === 0 ? (
              <p className="text-gray-500 text-sm font-mono">No orders in this category.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="text-gray-500 text-left border-b border-white/10">
                      <th className="py-2 pr-4">order</th>
                      <th className="py-2 pr-4">status</th>
                      <th className="py-2 pr-4">type</th>
                      <th className="py-2 pr-4">amount</th>
                      <th className="py-2 pr-4">age</th>
                      <th className="py-2 pr-4">dispute reason</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-white/5 hover:bg-gray-900/40">
                        <td className="py-2 pr-4">
                          <div className="text-blue-400">{o.order_number || o.id.slice(0, 8)}</div>
                          <div className="text-gray-600 text-xs">{o.id.slice(0, 12)}…</div>
                        </td>
                        <td className="py-2 pr-4">
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="py-2 pr-4 text-gray-300">{o.type}</td>
                        <td className="py-2 pr-4">
                          <div className="text-gray-300">{o.crypto_amount} USDC</div>
                          <div className="text-gray-500 text-xs">{o.fiat_amount} AED</div>
                        </td>
                        <td className="py-2 pr-4 text-gray-400">{formatAge(o.age_sec)}</td>
                        <td className="py-2 pr-4 text-gray-400 max-w-xs truncate">
                          {o.dispute_reason || '-'}
                        </td>
                        <td className="py-2">
                          <Link
                            href={`/ops/orders/${o.id}`}
                            className="text-xs px-2 py-1 bg-white/5 rounded hover:bg-white/10 transition-colors"
                          >
                            inspect →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
    <span className={`px-2 py-0.5 rounded text-xs ${colors[status] || 'bg-gray-800 text-gray-400'}`}>
      {status}
    </span>
  );
}

function formatAge(seconds: number): string {
  if (!seconds) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
