'use client';

// /admin/waitlist — admin view of all waitlist signups across users and merchants.
// Uses the same admin-cookie auth as the other /admin/* pages.

import { useCallback, useEffect, useState } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { formatCount } from '@/lib/format';
import { Loader2, Check, X, Search, RefreshCw } from 'lucide-react';

interface Row {
  id: string;
  actor_type: 'user' | 'merchant';
  email: string | null;
  display_name: string | null;
  username: string | null;
  waitlist_status: 'waitlisted' | 'active' | 'rejected';
  waitlist_joined_at: string | null;
  waitlist_source: string | null;
  blip_points: number | null;
  referral_code: string | null;
  business_name: string | null;
}

type Segment = 'all' | 'user' | 'merchant';
type Status = 'waitlisted' | 'active' | 'rejected' | 'all';

export default function AdminWaitlistPage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  const [segment, setSegment] = useState<Segment>('all');
  const [status, setStatus] = useState<Status>('waitlisted');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

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
        segment, status, page: String(page), limit: '50',
      });
      if (debouncedSearch) sp.set('q', debouncedSearch);
      const res = await fetchWithAuth(`/api/admin/waitlist?${sp.toString()}`);
      const data = await res.json();
      if (data.success) {
        setRows(data.data.rows);
        setTotal(data.data.total);
      }
    } catch (err) {
      console.error('Failed to load waitlist', err);
    } finally {
      setLoading(false);
    }
  }, [authed, segment, status, page, debouncedSearch]);

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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Waitlist</h1>
            <p className="text-sm text-zinc-400">{formatCount(total)} signup{total === 1 ? '' : 's'}</p>
          </div>
          <button onClick={load} className="border border-zinc-800 rounded px-3 py-2 text-sm hover:bg-zinc-900 flex items-center gap-1.5">
            <RefreshCw size={14} /> Refresh
          </button>
        </header>

        <div className="flex flex-wrap gap-3 mb-4">
          <select value={segment} onChange={(e) => { setSegment(e.target.value as Segment); setPage(1); }}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm">
            <option value="all">All segments</option>
            <option value="user">Users</option>
            <option value="merchant">Merchants</option>
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value as Status); setPage(1); }}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm">
            <option value="waitlisted">Waitlisted</option>
            <option value="active">Active</option>
            <option value="rejected">Rejected</option>
            <option value="all">All statuses</option>
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
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-right px-4 py-3">BLIP</th>
                <th className="text-left px-4 py-3">Joined</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading && (
                <tr><td colSpan={8} className="text-center py-8"><Loader2 className="animate-spin inline" /></td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-zinc-500">No signups match</td></tr>
              )}
              {!loading && rows.map((r) => (
                <tr key={`${r.actor_type}:${r.id}`} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-mono text-xs">{r.email ?? '—'}</td>
                  <td className="px-4 py-3 text-xs uppercase tracking-wider text-zinc-500">{r.actor_type}</td>
                  <td className="px-4 py-3">
                    {r.business_name ?? r.display_name ?? r.username ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatCount(r.blip_points ?? 0)}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {r.waitlist_joined_at ? new Date(r.waitlist_joined_at).toLocaleDateString('en-US') : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{r.waitlist_source ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.waitlist_status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.waitlist_status === 'waitlisted' && (
                      <div className="flex justify-end gap-1.5">
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
                      </div>
                    )}
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
