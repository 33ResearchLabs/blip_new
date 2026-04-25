"use client";

/**
 * /merchant/my-issues/[id] — full detail of an issue the actor filed.
 *
 * Backed by GET /api/issues/:id (user-scoped — returns 404 if the
 * caller doesn't own this issue, no info leak).
 *
 * Layout:
 *   - Header: title, status badge, tracking ID (copy), category, timestamps
 *   - Description block
 *   - Screenshots gallery (grid; click to open full-size)
 *   - Attachments list (link out, no preview)
 *   - Status timeline (oldest → newest), one row per status_history entry
 */

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Bug,
  Check,
  Copy,
  Download,
  Loader2,
  Paperclip,
  X as XIcon,
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

interface IssueScreenshot {
  id: string;
  url: string;
  type: "screenshot" | "upload";
  mime?: string;
  size_bytes?: number;
  created_at?: string;
}

interface IssueAttachment {
  url: string;
  name: string;
  mime?: string;
  size_bytes?: number;
}

interface StatusHistoryEntry {
  status: IssueStatus;
  at: string;
  by_type: "admin" | "system" | "user" | "merchant";
  by_id: string | null;
  note?: string;
}

interface IssueDetailApi {
  id: string;
  title: string;
  description: string;
  category: string;
  status: IssueStatus;
  priority: string;
  screenshot_url: string | null;
  screenshots: IssueScreenshot[] | null;
  attachments: IssueAttachment[] | null;
  status_history: StatusHistoryEntry[] | null;
  created_at: string;
  updated_at: string;
}

export default function MyIssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // App router (Next 15+) gives params as a Promise; unwrap with `use`.
  const { id } = use(params);

  const [issue, setIssue] = useState<IssueDetailApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Lightbox: index of the screenshot being viewed full-size, or null
  // when the gallery is in thumbnail mode.
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/issues/${id}`);
      if (res.status === 404) {
        setError("Issue not found");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setIssue(data.data as IssueDetailApi);
    } catch (e) {
      setError((e as Error).message || "Failed to load issue");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCopyId = useCallback(async () => {
    if (!issue) return;
    const ok = await copyToClipboard(issue.id);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }, [issue]);

  // Resolve the screenshots list with a v1 fallback: pre-Phase-1 issues
  // only have screenshot_url populated and no screenshots[] array.
  const resolvedShots: IssueScreenshot[] = issue
    ? Array.isArray(issue.screenshots) && issue.screenshots.length > 0
      ? issue.screenshots
      : issue.screenshot_url
        ? [
            {
              id: issue.id,
              url: issue.screenshot_url,
              type: "screenshot" as const,
            },
          ]
        : []
    : [];
  const resolvedAttachments: IssueAttachment[] = issue?.attachments ?? [];
  const resolvedHistory: StatusHistoryEntry[] = issue?.status_history ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MerchantNavbar activePage="dashboard" />
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div>
          <Link
            href="/merchant/my-issues"
            className="inline-flex items-center gap-1 text-[12px] text-foreground/50 hover:text-foreground/80"
          >
            <ArrowLeft size={12} />
            Back to My Issues
          </Link>
        </div>

        {error ? (
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-300 text-[13px]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">{error}</div>
              <div className="opacity-70">
                The issue may have been removed, or it was filed under a
                different account.
              </div>
            </div>
          </div>
        ) : loading || !issue ? (
          <div className="space-y-3">
            <div className="h-6 w-2/3 bg-foreground/10 rounded animate-pulse" />
            <div className="h-3 w-1/3 bg-foreground/10 rounded animate-pulse" />
            <div className="h-32 bg-foreground/[0.04] border border-border rounded-lg animate-pulse" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Bug className="w-5 h-5 text-amber-400 shrink-0" />
                <h1 className="text-[20px] font-semibold">{issue.title}</h1>
                <StatusBadge status={issue.status} />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-foreground/50">
                <span>{prettyCategory(issue.category)}</span>
                <span aria-hidden="true">·</span>
                <span>Filed {new Date(issue.created_at).toLocaleString("en-US")}</span>
                <span aria-hidden="true">·</span>
                <span>
                  Updated{" "}
                  {new Date(issue.updated_at).toLocaleString("en-US")}
                </span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="inline-flex items-center gap-1 hover:text-foreground/80 font-mono"
                  title="Copy tracking ID"
                >
                  {copied ? (
                    <>
                      <Check size={11} className="text-emerald-400" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      {issue.id}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Description */}
            <section className="rounded-lg border border-border bg-foreground/[0.02] p-4">
              <h2 className="text-[12px] font-medium text-foreground/60 uppercase tracking-wide mb-2">
                Description
              </h2>
              <p className="text-[14px] whitespace-pre-wrap text-foreground/85 leading-relaxed">
                {issue.description}
              </p>
            </section>

            {/* Screenshots gallery */}
            {resolvedShots.length > 0 && (
              <section>
                <h2 className="text-[12px] font-medium text-foreground/60 uppercase tracking-wide mb-2">
                  Screenshots ({resolvedShots.length})
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {resolvedShots.map((shot, i) => (
                    <button
                      key={shot.id || `${i}-${shot.url}`}
                      type="button"
                      onClick={() => setLightboxIdx(i)}
                      className="relative group rounded-md overflow-hidden border border-border bg-black/40 aspect-video hover:border-foreground/30 transition"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={shot.url}
                        alt={`Screenshot ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <span
                        className={`absolute bottom-1 left-1 px-1.5 py-px rounded text-[9px] leading-none font-mono uppercase tracking-wide ${
                          shot.type === "upload"
                            ? "bg-sky-500/80 text-white"
                            : "bg-amber-500/80 text-black"
                        }`}
                      >
                        {shot.type === "upload" ? "Upload" : "Capture"}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Attachments */}
            {resolvedAttachments.length > 0 && (
              <section>
                <h2 className="text-[12px] font-medium text-foreground/60 uppercase tracking-wide mb-2">
                  Attachments ({resolvedAttachments.length})
                </h2>
                <ul className="space-y-1">
                  {resolvedAttachments.map((a, i) => (
                    <li
                      key={`${i}-${a.url}`}
                      className="flex items-center gap-2 px-3 py-2 rounded-md bg-foreground/[0.04] border border-border"
                    >
                      <Paperclip
                        size={12}
                        className="text-foreground/40 shrink-0"
                      />
                      <span className="flex-1 truncate text-[12px]">
                        {a.name || "attachment"}
                      </span>
                      {typeof a.size_bytes === "number" && (
                        <span className="text-[10px] text-foreground/40 shrink-0">
                          {formatBytes(a.size_bytes)}
                        </span>
                      )}
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 p-1 rounded hover:bg-foreground/[0.08] text-foreground/60"
                        title="Open"
                      >
                        <Download size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Timeline */}
            {resolvedHistory.length > 0 && (
              <section>
                <h2 className="text-[12px] font-medium text-foreground/60 uppercase tracking-wide mb-2">
                  Timeline
                </h2>
                <ol className="relative border-l border-border pl-4 space-y-3">
                  {resolvedHistory.map((entry, i) => (
                    <li key={i} className="relative">
                      <span
                        className={`absolute -left-[19px] top-1 w-2 h-2 rounded-full border ${
                          entry.status === "resolved"
                            ? "bg-emerald-400 border-emerald-400"
                            : entry.status === "rejected"
                              ? "bg-rose-400 border-rose-400"
                              : entry.status === "in_progress"
                                ? "bg-amber-400 border-amber-400"
                                : "bg-foreground/40 border-foreground/40"
                        }`}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={entry.status} />
                        <span className="text-[11px] text-foreground/50">
                          {new Date(entry.at).toLocaleString("en-US")}
                        </span>
                        <span className="text-[10px] text-foreground/40 uppercase tracking-wide">
                          by {entry.by_type}
                        </span>
                      </div>
                      {entry.note && (
                        <div className="mt-1 text-[12px] text-foreground/70 whitespace-pre-wrap">
                          {entry.note}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </div>

      {/* Lightbox overlay */}
      {lightboxIdx !== null &&
        resolvedShots[lightboxIdx] &&
        (() => {
          const shot = resolvedShots[lightboxIdx];
          return (
            <div
              role="dialog"
              aria-label="Screenshot"
              className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4"
              onClick={() => setLightboxIdx(null)}
            >
              <button
                type="button"
                onClick={() => setLightboxIdx(null)}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                aria-label="Close"
              >
                <XIcon size={18} />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shot.url}
                alt={`Screenshot ${lightboxIdx + 1}`}
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          );
        })()}
    </div>
  );
}

// ── Helpers (duplicated from list page; small enough to inline) ──────

function StatusBadge({ status }: { status: IssueStatus }) {
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

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
