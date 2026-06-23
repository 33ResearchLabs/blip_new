"use client";

/**
 * /user/my-issues — list of support tickets the signed-in user has filed.
 *
 * Backed by GET /api/issues (user-scoped). The endpoint enforces that only
 * the caller's own tickets are returned, so this page never exposes anyone
 * else's submissions even if the URL is shared. Mirrors the merchant
 * /market/my-issues list, re-themed for the user (light/cream) shell.
 *
 * Reached from the Support screen's "My Tickets" affordance. Tickets are
 * created via the existing IssueReporter (openIssueReporter()).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Copy,
  LifeBuoy,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { copyToClipboard } from "@/lib/clipboard";
import { useUserTheme } from "@/hooks/useUserTheme";

type IssueStatus = "open" | "in_progress" | "resolved" | "closed" | "rejected";

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

export default function UserMyIssuesPage() {
  const router = useRouter();
  const { theme: userTheme } = useUserTheme();
  const isUserLight = userTheme === "light";

  const [issues, setIssues] = useState<IssueRowApi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | IssueStatus>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async (status: "" | IssueStatus) => {
    setLoading(true);
    setError(null);
    try {
      const qs = status ? `?status=${status}` : "";
      const res = await fetchWithAuth(`/api/issues${qs}`);
      if (res.status === 404) {
        // Feature flag off — render empty rather than a scary error.
        setIssues([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setIssues(Array.isArray(data.data?.issues) ? data.data.issues : []);
    } catch (e) {
      setError((e as Error).message || "Failed to load tickets");
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }, []);

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
    <div
      className={`user-scope ${isUserLight ? "user-light" : ""} min-h-dvh`}
      style={{ background: "var(--color-surface-base)" }}
    >
      <div className="mx-auto w-full max-w-[560px] px-5 py-5">
        {/* Header */}
        <header className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Back"
            className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1 bg-surface-raised border border-border-subtle"
          >
            <ArrowLeft className="w-[18px] h-[18px] text-text-secondary" />
          </button>
          <div className="flex items-center gap-2">
            <LifeBuoy className="w-[18px] h-[18px] text-text-secondary" />
            <h1 className="text-[17px] font-semibold text-text-primary">
              My Tickets
            </h1>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => void load(statusFilter)}
            disabled={loading}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg border border-border-subtle bg-surface-card hover:bg-surface-hover disabled:opacity-50 transition text-text-secondary"
            title="Refresh"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </header>

        <p className="text-[12px] text-text-tertiary mb-4">
          Tickets you&apos;ve raised and their current status. Open one to see
          the full timeline and our replies.
        </p>

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {STATUS_FILTERS.map((f) => {
            const active = f.value === statusFilter;
            return (
              <button
                key={f.value || "all"}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1 rounded-full text-[12px] font-semibold transition border ${
                  active
                    ? "bg-accent text-accent-text border-accent"
                    : "bg-surface-card text-text-secondary border-border-subtle hover:bg-surface-hover"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* States: error / loading / empty / list */}
        {error ? (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-error-border bg-error-dim text-error text-[13px]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Could not load tickets</div>
              <div className="opacity-70">{error}</div>
            </div>
          </div>
        ) : loading && issues === null ? (
          <SkeletonList />
        ) : sortedIssues.length === 0 ? (
          <EmptyState filtered={!!statusFilter} />
        ) : (
          <ul className="space-y-2">
            {sortedIssues.map((issue) => {
              const accent =
                issue.status === "open"
                  ? "bg-amber-400"
                  : issue.status === "in_progress"
                    ? "bg-sky-400"
                    : issue.status === "resolved"
                      ? "bg-emerald-400"
                      : issue.status === "rejected"
                        ? "bg-error"
                        : "bg-zinc-400/40";
              return (
                <li
                  key={issue.id}
                  className="rounded-2xl border border-border-subtle bg-surface-card hover:bg-surface-hover hover:border-border-medium transition overflow-hidden"
                >
                  <Link
                    href={`/user/my-issues/${issue.id}`}
                    className="group flex items-stretch"
                  >
                    {/* status accent rail */}
                    <span className={`w-1 shrink-0 ${accent}`} aria-hidden="true" />
                    <div className="flex-1 min-w-0 flex items-center gap-3 pl-3.5 pr-3 py-3.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <StatusBadge status={issue.status} />
                          <span className="px-1.5 py-0.5 rounded-md bg-surface-raised border border-border-subtle text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                            {prettyCategory(issue.category)}
                          </span>
                        </div>
                        <div className="text-[14.5px] font-semibold text-text-primary truncate leading-tight">
                          {issue.title}
                        </div>
                        <div className="text-[12px] text-text-tertiary line-clamp-1 mt-0.5">
                          {issue.description}
                        </div>
                        <div className="flex items-center gap-2.5 mt-2.5 text-[10.5px] text-text-tertiary">
                          <span className="inline-flex items-center gap-1">
                            <Clock size={11} />
                            {relativeTime(issue.created_at)}
                          </span>
                          <span className="w-0.5 h-0.5 rounded-full bg-text-tertiary/50" aria-hidden="true" />
                          <span>Updated {relativeTime(issue.updated_at)}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void handleCopyId(issue.id);
                            }}
                            className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-surface-raised border border-border-subtle hover:bg-surface-hover hover:text-text-secondary font-mono transition"
                            title="Copy tracking ID"
                          >
                            {copiedId === issue.id ? (
                              <>
                                <Check size={10} className="text-emerald-500" />
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
                        className="text-text-tertiary group-hover:text-text-secondary group-hover:translate-x-0.5 transition-all shrink-0 self-center"
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IssueStatus }) {
  const map: Record<IssueStatus, { label: string; cls: string }> = {
    open: {
      label: "Open",
      cls: "bg-surface-raised text-text-secondary border-border-subtle",
    },
    in_progress: {
      label: "In Progress",
      cls: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    },
    resolved: {
      label: "Resolved",
      cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-error/15 text-error border-error-border",
    },
    closed: {
      label: "Closed",
      cls: "bg-surface-raised text-text-tertiary border-border-subtle",
    },
  };
  const m = map[status] ?? map.open;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-semibold uppercase tracking-wide border ${m.cls}`}
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
          className="rounded-2xl border border-border-subtle bg-surface-card px-4 py-3.5"
        >
          <div className="h-3 w-1/3 bg-surface-raised rounded animate-pulse mb-2" />
          <div className="h-3 w-2/3 bg-surface-raised rounded animate-pulse mb-1.5" />
          <div className="h-2 w-1/4 bg-surface-raised rounded animate-pulse" />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-border-subtle bg-surface-card px-6 py-10 text-center">
      <Loader2
        className="mx-auto mb-3 text-text-tertiary"
        size={20}
        style={{ animation: "none" }}
      />
      <div className="text-[14px] font-semibold text-text-primary">
        {filtered ? "No tickets match this filter" : "No tickets yet"}
      </div>
      <div className="text-[12px] text-text-tertiary mt-1 max-w-sm mx-auto">
        {filtered
          ? "Try the All filter to see everything you've raised."
          : "Tap “Raise a ticket” on the Support screen to file your first one — it'll show up here so you can track its status."}
      </div>
    </div>
  );
}
