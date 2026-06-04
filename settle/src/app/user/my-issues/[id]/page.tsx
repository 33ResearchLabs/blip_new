"use client";

/**
 * /user/my-issues/[id] — full detail of a support ticket the user filed.
 *
 * Backed by GET /api/issues/:id (user-scoped — returns 404 if the caller
 * doesn't own this ticket, so there's no info leak). Mirrors the merchant
 * /market/my-issues/[id] detail, re-themed for the user shell.
 *
 * The "Replies & updates" timeline renders status_history entries. Staff
 * answers (posted via the admin panel) arrive as by_type='admin' entries
 * with a note — that's how the user reads our response.
 */

import { useCallback, useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  LifeBuoy,
  Paperclip,
  ShieldCheck,
  X as XIcon,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { copyToClipboard } from "@/lib/clipboard";
import { useUserTheme } from "@/hooks/useUserTheme";

type IssueStatus = "open" | "in_progress" | "resolved" | "closed" | "rejected";

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

export default function UserMyIssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { theme: userTheme } = useUserTheme();
  const isUserLight = userTheme === "light";

  const [issue, setIssue] = useState<IssueDetailApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/issues/${id}`);
      if (res.status === 404) {
        setError("Ticket not found");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setIssue(data.data as IssueDetailApi);
    } catch (e) {
      setError((e as Error).message || "Failed to load ticket");
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

  // v1 fallback: pre-Phase-1 tickets only have screenshot_url and no
  // screenshots[] array.
  const resolvedShots: IssueScreenshot[] = issue
    ? Array.isArray(issue.screenshots) && issue.screenshots.length > 0
      ? issue.screenshots
      : issue.screenshot_url
        ? [{ id: issue.id, url: issue.screenshot_url, type: "screenshot" as const }]
        : []
    : [];
  const resolvedAttachments: IssueAttachment[] = issue?.attachments ?? [];
  const resolvedHistory: StatusHistoryEntry[] = issue?.status_history ?? [];

  return (
    <div
      className={`user-scope ${isUserLight ? "user-light" : ""} min-h-dvh`}
      style={{ background: "var(--color-surface-base)" }}
    >
      <div className="mx-auto w-full max-w-[560px] px-5 py-5">
        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-[12px] text-text-tertiary hover:text-text-secondary mb-4"
        >
          <ArrowLeft size={12} />
          Back to My Tickets
        </button>

        {error ? (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-600 text-[13px]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">{error}</div>
              <div className="opacity-70">
                The ticket may have been removed, or it was filed under a
                different account.
              </div>
            </div>
          </div>
        ) : loading || !issue ? (
          <div className="space-y-3">
            <div className="h-6 w-2/3 bg-surface-raised rounded animate-pulse" />
            <div className="h-3 w-1/3 bg-surface-raised rounded animate-pulse" />
            <div className="h-32 bg-surface-card border border-border-subtle rounded-2xl animate-pulse" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="space-y-2 mb-5">
              <div className="flex flex-wrap items-center gap-2">
                <LifeBuoy className="w-5 h-5 text-text-secondary shrink-0" />
                <h1 className="text-[20px] font-semibold text-text-primary">
                  {issue.title}
                </h1>
                <StatusBadge status={issue.status} />
              </div>
              <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-text-tertiary">
                <span>{prettyCategory(issue.category)}</span>
                <span aria-hidden="true">·</span>
                <span>Filed {new Date(issue.created_at).toLocaleString("en-US")}</span>
                <span aria-hidden="true">·</span>
                <span>Updated {new Date(issue.updated_at).toLocaleString("en-US")}</span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  className="inline-flex items-center gap-1 hover:text-text-secondary font-mono"
                  title="Copy tracking ID"
                >
                  {copied ? (
                    <>
                      <Check size={11} />
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
            <section className="rounded-2xl border border-border-subtle bg-surface-card p-4 mb-4">
              <h2 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                Your message
              </h2>
              <p className="text-[14px] whitespace-pre-wrap text-text-primary leading-relaxed">
                {issue.description}
              </p>
            </section>

            {/* Screenshots gallery */}
            {resolvedShots.length > 0 && (
              <section className="mb-4">
                <h2 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  Screenshots ({resolvedShots.length})
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {resolvedShots.map((shot, i) => (
                    <button
                      key={shot.id || `${i}-${shot.url}`}
                      type="button"
                      onClick={() => setLightboxIdx(i)}
                      className="relative group rounded-xl overflow-hidden border border-border-subtle bg-surface-raised aspect-video hover:border-border-medium transition"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={shot.url}
                        alt={`Screenshot ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Attachments */}
            {resolvedAttachments.length > 0 && (
              <section className="mb-4">
                <h2 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                  Attachments ({resolvedAttachments.length})
                </h2>
                <ul className="space-y-1">
                  {resolvedAttachments.map((a, i) => (
                    <li
                      key={`${i}-${a.url}`}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-card border border-border-subtle"
                    >
                      <Paperclip size={12} className="text-text-tertiary shrink-0" />
                      <span className="flex-1 truncate text-[12px] text-text-primary">
                        {a.name || "attachment"}
                      </span>
                      {typeof a.size_bytes === "number" && (
                        <span className="text-[10px] text-text-tertiary shrink-0">
                          {formatBytes(a.size_bytes)}
                        </span>
                      )}
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 p-1 rounded hover:bg-surface-hover text-text-secondary"
                        title="Open"
                      >
                        <Download size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Replies & updates timeline */}
            <section>
              <h2 className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                Replies &amp; updates
              </h2>
              {resolvedHistory.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border-subtle bg-surface-card px-4 py-6 text-center text-[12px] text-text-tertiary">
                  No updates yet. Our team will reply here — you&apos;ll see the
                  status change and any answers on this ticket.
                </div>
              ) : (
                <ol className="relative border-l border-border-subtle pl-4 space-y-3">
                  {resolvedHistory.map((entry, i) => {
                    const isStaff =
                      entry.by_type === "admin" || entry.by_type === "system";
                    return (
                      <li key={i} className="relative">
                        <span
                          className={`absolute -left-[19px] top-1 w-2 h-2 rounded-full border ${
                            entry.status === "resolved"
                              ? "bg-emerald-500 border-emerald-500"
                              : entry.status === "rejected"
                                ? "bg-rose-500 border-rose-500"
                                : entry.status === "in_progress"
                                  ? "bg-amber-500 border-amber-500"
                                  : "bg-text-tertiary border-text-tertiary"
                          }`}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={entry.status} />
                          <span className="text-[11px] text-text-tertiary">
                            {new Date(entry.at).toLocaleString("en-US")}
                          </span>
                          {isStaff && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">
                              <ShieldCheck size={11} />
                              Support
                            </span>
                          )}
                        </div>
                        {entry.note && (
                          <div
                            className={`mt-1.5 text-[13px] whitespace-pre-wrap leading-relaxed ${
                              isStaff
                                ? "rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-text-primary"
                                : "text-text-secondary"
                            }`}
                          >
                            {entry.note}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
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
      cls: "bg-rose-500/15 text-rose-600 border-rose-500/30",
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

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
