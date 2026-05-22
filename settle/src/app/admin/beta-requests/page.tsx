"use client";

/**
 * /admin/beta-requests — review queue for the "Send Request for Merchant
 * P2P App Test" submissions from the waitlist dashboard.
 *
 * Loads from GET /api/admin/beta-requests (admin-cookie auth) and lets
 * the reviewer change status via PATCH /api/admin/beta-requests/[id].
 *
 * Auth follows the same shape as /admin/disputes — session probe + login
 * card + token sentinel. Layout matches the other admin pages so it
 * slots into the nav without visual drift.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, CheckCircle2, XCircle, MessageSquare, Mail,
  Store, Globe, DollarSign, Clock,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { ADMIN_COOKIE_SENTINEL } from "@/lib/api/adminSession";
import { formatCount, formatFiat } from "@/lib/format";

type Status = "pending" | "approved" | "rejected" | "contacted";

interface BetaRequest {
  id: string;
  actor_id: string;
  actor_type: "user" | "merchant";
  email: string | null;
  display_name: string | null;
  business_name: string | null;
  country_code: string | null;
  expected_trading_amount_usd: string | null;
  status: Status;
  requested_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  admin_notes: string | null;
}

const STATUS_FILTERS: { key: Status | "all"; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "contacted", label: "Contacted" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const STATUS_BADGE: Record<Status, string> = {
  pending: "text-amber-300 bg-amber-500/10 border-amber-500/30",
  contacted: "text-sky-300 bg-sky-500/10 border-sky-500/30",
  approved: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  rejected: "text-red-300 bg-red-500/10 border-red-500/30",
};

function relativeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export default function BetaRequestsPage() {
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  const [requests, setRequests] = useState<BetaRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<Status | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  // ── Session probe ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetchWithAuth("/api/auth/admin");
        const data = await res.json();
        if (data?.success && data.data?.valid) {
          setAdminToken(ADMIN_COOKIE_SENTINEL);
          setIsAuthenticated(true);
        }
      } catch { /* ignore — falls through to unauthenticated state */ }
      finally { setIsCheckingSession(false); }
    })();
  }, []);

  // ── Data load ──
  const fetchData = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetchWithAuth(`/api/admin/beta-requests?${params.toString()}`);
      const data = await res.json();
      if (data?.success) {
        setRequests(data.data.requests || []);
        setCounts(data.data.counts || {});
      }
    } catch (err) {
      console.error("[admin/beta-requests] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, [adminToken, statusFilter]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  async function updateStatus(id: string, next: Status) {
    if (acting) return;
    setActing(id);
    try {
      const res = await fetchWithAuth(`/api/admin/beta-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (data?.success) await fetchData();
      else console.warn("[admin/beta-requests] update failed:", data?.error);
    } catch (err) {
      console.error("[admin/beta-requests] update threw", err);
    } finally {
      setActing(null);
    }
  }

  // ── Auth gates ──
  if (isCheckingSession) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-5 h-5 animate-spin text-foreground/40" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="px-8 py-10">
        <p className="text-sm text-foreground/60">
          Sign in via the admin Console to view beta access requests.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full px-6 md:px-8 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Beta Access Requests</h1>
          <p className="text-xs text-foreground/40 mt-0.5">
            Merchants requesting access to the P2P app test programme.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void fetchData()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-card border border-border-medium hover:border-text-tertiary transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Status pills */}
      <div className="flex items-center gap-1 mb-4 border-b border-section-divider">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.key;
          const count = f.key === "all"
            ? Object.values(counts).reduce((s, n) => s + n, 0)
            : counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                active
                  ? "text-foreground border-foreground"
                  : "text-foreground/40 hover:text-foreground/70 border-transparent"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-[10px] text-foreground/30">{formatCount(count)}</span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-card border-b border-section-divider">
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-foreground/40">
              <th className="px-4 py-2.5">Merchant</th>
              <th className="px-4 py-2.5">Contact</th>
              <th className="px-4 py-2.5">Expected Volume</th>
              <th className="px-4 py-2.5">Country</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Requested</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && requests.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-foreground/40">
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              </td></tr>
            ) : requests.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-foreground/40 text-xs">
                No {statusFilter === "all" ? "" : statusFilter} requests yet.
              </td></tr>
            ) : requests.map((r) => {
              const amount = r.expected_trading_amount_usd != null
                ? formatFiat(Number(r.expected_trading_amount_usd), "USD")
                : "—";
              const canApprove = r.status === "pending" || r.status === "contacted";
              const canReject = r.status === "pending" || r.status === "contacted";
              const canContact = r.status === "pending";
              return (
                <tr key={r.id} className="border-b border-section-divider last:border-0 hover:bg-card/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Store className="w-3.5 h-3.5 text-foreground/40" />
                      <div>
                        <div className="font-semibold text-foreground">
                          {r.business_name || r.display_name || "—"}
                        </div>
                        <div className="text-[10px] text-foreground/30 font-mono">{r.actor_id.slice(0, 8)}…</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <Mail className="w-3 h-3 text-foreground/30" />
                      <span className="break-all">{r.email || "—"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <DollarSign className="w-3 h-3 text-foreground/30" />
                      {amount}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                      <Globe className="w-3 h-3 text-foreground/30" />
                      {r.country_code || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] border rounded ${STATUS_BADGE[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-foreground/50" title={r.requested_at}>
                      <Clock className="w-3 h-3 text-foreground/30" />
                      {relativeAgo(r.requested_at)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canContact && (
                        <button
                          type="button"
                          onClick={() => void updateStatus(r.id, "contacted")}
                          disabled={acting === r.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-sky-500/30 text-sky-300 hover:bg-sky-500/10 disabled:opacity-50"
                        >
                          <MessageSquare className="w-3 h-3" /> Contact
                        </button>
                      )}
                      {canApprove && (
                        <button
                          type="button"
                          onClick={() => void updateStatus(r.id, "approved")}
                          disabled={acting === r.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Approve
                        </button>
                      )}
                      {canReject && (
                        <button
                          type="button"
                          onClick={() => void updateStatus(r.id, "rejected")}
                          disabled={acting === r.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <XCircle className="w-3 h-3" /> Reject
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
