"use client";

/**
 * Admin view of merchant/user limit-increase requests, rendered inside the
 * Support Tickets panel via the "Limit Requests" toggle. Lists requests with
 * status / kind / actor-type filters + search, and lets an admin approve or
 * reject a pending request.
 *
 * Approving flips the request to 'approved' — getEffectiveLimits() then reads
 * it as the actor's new cap (see getApprovedLimitOverrides), so no separate
 * "apply" step is needed; the higher limit takes effect on the next order.
 *
 * Admin auth rides the same-origin admin cookie (plain fetch, no header),
 * matching IssuesPanel.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, X, Loader2, Search, ArrowRight, RefreshCw } from "lucide-react";
import { formatFiat } from "@/lib/format";

interface LimitRequest {
  id: string;
  actor_type: "user" | "merchant";
  actor_id: string;
  kind: "daily" | "per_transaction";
  current_limit_usd: string;
  requested_limit_usd: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  actor_username: string | null;
  actor_email: string | null;
}

type StatusFilter = "" | "pending" | "approved" | "rejected";
type KindFilter = "" | "daily" | "per_transaction";
type ActorFilter = "" | "user" | "merchant";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const KIND_LABEL: Record<LimitRequest["kind"], string> = {
  daily: "Daily",
  per_transaction: "Per Transaction",
};

const STATUS_STYLE: Record<LimitRequest["status"], string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  approved: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  rejected: "bg-red-500/10 text-red-400 border-red-500/25",
};

function getAdminName(): string {
  try {
    const t = localStorage.getItem("blip_admin_token");
    if (!t) return "admin";
    return atob(t).split(":")[0] || "admin";
  } catch {
    return "admin";
  }
}

export function LimitRequestsPanel() {
  const [rows, setRows] = useState<LimitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  // Server-side filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [kindFilter, setKindFilter] = useState<KindFilter>("");
  const [actorFilter, setActorFilter] = useState<ActorFilter>("");
  // Client-side
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (kindFilter) qs.set("kind", kindFilter);
      if (actorFilter) qs.set("actor_type", actorFilter);
      qs.set("limit", "500");
      const res = await fetch(`/api/admin/limit-requests?${qs.toString()}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        setRows(json.data as LimitRequest[]);
      } else {
        setError(json?.error || "Failed to load limit requests");
      }
    } catch {
      setError("Failed to load limit requests");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, kindFilter, actorFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    setActingId(id);
    try {
      const res = await fetch(`/api/admin/limit-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewedBy: getAdminName() }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) {
        await load();
      } else {
        setError(json?.error || `Failed to ${action} request`);
      }
    } catch {
      setError(`Failed to ${action} request`);
    } finally {
      setActingId(null);
    }
  };

  const q = search.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) =>
          (r.actor_username || "").toLowerCase().includes(q) ||
          (r.actor_email || "").toLowerCase().includes(q) ||
          r.actor_id.toLowerCase().includes(q),
      )
    : rows;

  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-card border border-border p-0.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value || "all"}
              onClick={() => setStatusFilter(t.value)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                statusFilter === t.value
                  ? "bg-foreground/[0.08] text-foreground/90"
                  : "text-foreground/45 hover:text-foreground/70"
              }`}
            >
              {t.label}
              {t.value === "pending" && pendingCount > 0 && (
                <span className="ml-1.5 text-[10px] text-amber-400">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          className="rounded-lg bg-card border border-border px-2.5 py-1.5 text-[12px] text-foreground/80"
        >
          <option value="">All kinds</option>
          <option value="daily">Daily</option>
          <option value="per_transaction">Per Transaction</option>
        </select>

        <select
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value as ActorFilter)}
          className="rounded-lg bg-card border border-border px-2.5 py-1.5 text-[12px] text-foreground/80"
        >
          <option value="">All accounts</option>
          <option value="merchant">Merchants</option>
          <option value="user">Users</option>
        </select>

        <div className="relative flex-1 min-w-[180px]">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/30"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search username, email or ID…"
            maxLength={100}
            className="w-full rounded-lg bg-card border border-border pl-8 pr-3 py-1.5 text-[12px] text-foreground/80 placeholder:text-foreground/30"
          />
        </div>

        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-[12px] text-foreground/70 hover:bg-foreground/[0.04]"
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-foreground/45">
                <th className="px-3 py-2.5 font-medium">Account</th>
                <th className="px-3 py-2.5 font-medium">Limit</th>
                <th className="px-3 py-2.5 font-medium">Current → Requested</th>
                <th className="px-3 py-2.5 font-medium">Reason</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Requested</th>
                <th className="px-3 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center">
                    <Loader2 className="w-4 h-4 animate-spin mx-auto text-foreground/30" />
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-12 text-center text-foreground/35"
                  >
                    No limit requests match these filters.
                  </td>
                </tr>
              ) : (
                visible.map((r) => {
                  const created = new Date(r.created_at);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-border/60 last:border-0 hover:bg-foreground/[0.02]"
                    >
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-foreground/85">
                          {r.actor_username || "—"}
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-foreground/35">
                            {r.actor_type}
                          </span>
                        </div>
                        <div className="text-foreground/40 truncate max-w-[180px]">
                          {r.actor_email || r.actor_id}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-foreground/70">
                        {KIND_LABEL[r.kind]}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-foreground/60">
                          {formatFiat(Number(r.current_limit_usd), "USD")}
                          <ArrowRight size={12} className="text-foreground/30" />
                          <span className="text-foreground/90 font-medium">
                            {formatFiat(Number(r.requested_limit_usd), "USD")}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="block max-w-[200px] truncate text-foreground/55"
                          title={r.reason || ""}
                        >
                          {r.reason || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-semibold capitalize ${STATUS_STYLE[r.status]}`}
                        >
                          {r.status}
                        </span>
                        {r.status !== "pending" && r.reviewed_by && (
                          <div className="mt-1 text-[10px] text-foreground/30">
                            by {r.reviewed_by}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-foreground/50 whitespace-nowrap">
                        {created.toLocaleDateString("en-US", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-3 py-2.5">
                        {r.status === "pending" ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => act(r.id, "approve")}
                              disabled={actingId === r.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/20 disabled:opacity-40"
                            >
                              {actingId === r.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Check size={12} />
                              )}
                              Approve
                            </button>
                            <button
                              onClick={() => act(r.id, "reject")}
                              disabled={actingId === r.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/10 border border-red-500/25 text-red-400 text-[11px] font-medium hover:bg-red-500/20 disabled:opacity-40"
                            >
                              <X size={12} />
                              Reject
                            </button>
                          </div>
                        ) : (
                          <div className="text-right text-foreground/30 text-[11px]">
                            {r.reviewed_at
                              ? new Date(r.reviewed_at).toLocaleDateString(
                                  "en-US",
                                  { day: "numeric", month: "short" },
                                )
                              : "—"}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
