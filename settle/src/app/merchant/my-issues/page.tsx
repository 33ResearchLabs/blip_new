"use client";

/**
 * /merchant/my-issues — list of issues the signed-in actor has filed.
 *
 * Backed by GET /api/issues (user-scoped). The endpoint enforces that
 * only the caller's own reports are returned, so this page never
 * exposes anyone else's submissions even if the URL is shared.
 *
 * UX:
 *   - Status pill filter (All / Open / In Progress / Resolved / Rejected)
 *   - Click a row to open /merchant/my-issues/[id]
 *   - Copy-to-clipboard "Tracking ID" inline for support escalation
 *   - Skeleton + empty + error states (no infinite spinners)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bug,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { copyToClipboard } from "@/lib/clipboard";

type IssueStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed"
  | "rejected";

interface IssueRowApi {
  id: string;
  title: string;
  description: string;
  category: string;
  status: IssueStatus;
  priority: string;
  created_at: string;
  updated_at: string;
}

const STATUS_FILTERS: Array<{ value: "" | IssueStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
];

export default function MyIssuesPage() {
  const [issues, setIssues] = useState<IssueRowApi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | IssueStatus>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(
    async (status: "" | IssueStatus) => {
      setLoading(true);
      setError(null);
      try {
        const qs = status ? `?status=${status}` : "";
        const res = await fetchWithAuth(`/api/issues${qs}`);
        if (res.status === 404) {
          // Feature flag off — render empty rather than scary error.
          setIssues([]);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        setIssues(Array.isArray(data.data?.issues) ? data.data.issues : []);
      } catch (e) {
        setError((e as Error).message || "Failed to load issues");
        setIssues([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(statusFilter);
  }, [load, statusFilter]);

  const handleCopyId = useCallback(async (id: string) => {
    const ok = await copyToClipboard(id);
    if (ok) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1200);
    }
  }, []);

  const trimmedShortId = useCallback(
    (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`,
    [],
  );

  const sortedIssues = useMemo(() => issues ?? [], [issues]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* No matching nav tab for My Issues — pass "dashboard" as a
          neutral default. When we add a dedicated nav entry later, the
          NavPage union should be extended and this prop swapped over. */}
      <MerchantNavbar activePage="dashboard" />
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold flex items-center gap-2">
              <Bug className="w-5 h-5 text-amber-400" />
              My Issues
            </h1>
            <p className="text-[12px] text-foreground/50 mt-1">
              Reports you&apos;ve filed and their current status. Open one to
              see screenshots, attachments, and the full timeline.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(statusFilter)}
            disabled={loading}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border border-border bg-foreground/[0.04] hover:bg-foreground/[0.08] disabled:opacity-50 transition"
            title="Refresh"
          >
            <RefreshCw
              size={12}
              className={loading ? "animate-spin" : ""}
            />
            Refresh
          </button>
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const active = f.value === statusFilter;
            return (
              <button
                key={f.value || "all"}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium transition ${
                  active
                    ? "bg-amber-500 text-black"
                    : "bg-foreground/[0.04] text-foreground/60 hover:bg-foreground/[0.08] hover:text-foreground/90"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* States: error / loading / empty / list */}
        {error ? (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-300 text-[13px]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Could not load issues</div>
              <div className="opacity-70">{error}</div>
            </div>
          </div>
        ) : loading && issues === null ? (
          <SkeletonList />
        ) : sortedIssues.length === 0 ? (
          <EmptyState filtered={!!statusFilter} />
        ) : (
          <ul className="space-y-2">
            {sortedIssues.map((issue) => (
              <li
                key={issue.id}
                className="rounded-lg border border-border bg-foreground/[0.02] hover:bg-foreground/[0.04] transition"
              >
                <Link
                  href={`/merchant/my-issues/${issue.id}`}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={issue.status} />
                      <span className="text-[10px] uppercase tracking-wide text-foreground/40">
                        {prettyCategory(issue.category)}
                      </span>
                    </div>
                    <div className="text-[14px] font-medium truncate">
                      {issue.title}
                    </div>
                    <div className="text-[12px] text-foreground/50 line-clamp-1">
                      {issue.description}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-foreground/40">
                      <span>Filed {relativeTime(issue.created_at)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Updated {relativeTime(issue.updated_at)}</span>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleCopyId(issue.id);
                        }}
                        className="inline-flex items-center gap-1 hover:text-foreground/70 font-mono"
                        title="Copy tracking ID"
                      >
                        {copiedId === issue.id ? (
                          <>
                            <Check size={10} className="text-emerald-400" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy size={10} />
                            {trimmedShortId(issue.id)}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-foreground/30 shrink-0 mt-1"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IssueStatus }) {
  // Color mapping per spec: open=gray, in_progress=yellow, resolved=green,
  // rejected=red. 'closed' (admin-only terminal) treated as a darker gray
  // so it visually reads as "done, no action needed".
  const map: Record<IssueStatus, { label: string; cls: string }> = {
    open: {
      label: "Open",
      cls: "bg-foreground/10 text-foreground/60 border-foreground/15",
    },
    in_progress: {
      label: "In Progress",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    },
    resolved: {
      label: "Resolved",
      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-rose-500/15 text-rose-300 border-rose-500/25",
    },
    closed: {
      label: "Closed",
      cls: "bg-foreground/[0.06] text-foreground/40 border-foreground/10",
    },
  };
  const m = map[status] ?? map.open;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium uppercase tracking-wide border ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

function prettyCategory(c: string): string {
  switch (c) {
    case "ui_bug":
      return "UI Bug";
    case "backend":
      return "Backend";
    case "payment":
      return "Payment";
    case "performance":
      return "Performance";
    default:
      return "Other";
  }
}

function relativeTime(iso: string): string {
  // Lightweight relative-time formatter — keeps the list compact. For
  // long-ago timestamps we just show the date; we don't need 100%
  // accuracy here.
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function SkeletonList() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="rounded-lg border border-border bg-foreground/[0.02] px-4 py-3"
        >
          <div className="h-3 w-1/3 bg-foreground/10 rounded animate-pulse mb-2" />
          <div className="h-3 w-2/3 bg-foreground/10 rounded animate-pulse mb-1.5" />
          <div className="h-2 w-1/4 bg-foreground/10 rounded animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-foreground/[0.02] px-6 py-10 text-center">
      <Loader2
        className="mx-auto mb-3 text-foreground/20"
        size={20}
        style={{ animation: "none" }}
      />
      <div className="text-[14px] font-medium">
        {filtered ? "No issues match this filter" : "No issues filed yet"}
      </div>
      <div className="text-[12px] text-foreground/50 mt-1 max-w-sm mx-auto">
        {filtered
          ? "Try the All filter to see everything you've reported."
          : "Hit the Report Issue button (bottom-right or Ctrl+Shift+I) to file your first one — it'll show up here so you can track its status."}
      </div>
    </div>
  );
}
