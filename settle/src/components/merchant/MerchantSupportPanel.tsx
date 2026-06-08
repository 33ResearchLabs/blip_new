"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ArrowRight,
  Search,
  Mic,
  Send,
  Ticket,
  HelpCircle,
  ExternalLink,
  Wallet,
  IndianRupee,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  Lock,
  ShieldCheck,
  CheckCircle2,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCw,
  Download,
  Paperclip,
  X as XIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { copyToClipboard } from "@/lib/clipboard";

// Class tokens lifted from the surrounding Settings tabs so this panel reads
// as native tab content rather than a pasted-in surface.
const CARD = "bg-white/[0.02] border border-white/[0.06]";
const FIELD = "bg-white/[0.04] border border-white/[0.08]";
const INPUT =
  "w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/30 transition-colors";
const LABEL =
  "text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block";
const BTN_PRIMARY =
  "w-full py-3 rounded-xl bg-[#f5f5f7] text-[#0b0b0c] font-bold text-sm hover:bg-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2";

const TELEGRAM_DM_URL = "https://t.me/blipmoney_community";

// ─── Types ───
type IssueStatus = "open" | "in_progress" | "resolved" | "closed" | "rejected";

interface RecentOrder {
  id: string;
  order_number: string;
  type: "buy" | "sell";
  fiat_amount: number;
  fiat_currency: string;
  crypto_amount: number;
  status: string;
  created_at: string;
}

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

type CategoryKey = "payment" | "backend" | "other";

interface TicketForm {
  categoryLabel: string;
  apiCategory: CategoryKey;
  subject: string;
  description: string;
  orderId: string;
}

const INITIAL_FORM: TicketForm = {
  categoryLabel: "",
  apiCategory: "other",
  subject: "",
  description: "",
  orderId: "",
};

const TICKET_CATEGORIES: { key: CategoryKey; label: string; icon: LucideIcon }[] = [
  { key: "payment", label: "Payment not released / stuck escrow", icon: Wallet },
  { key: "payment", label: "Wrong amount received", icon: IndianRupee },
  { key: "other", label: "User dispute not resolving", icon: AlertTriangle },
  { key: "other", label: "Account flagged / suspended", icon: Lock },
  { key: "other", label: "Tier upgrade issue", icon: TrendingUp },
  { key: "other", label: "Something else", icon: HelpCircle },
];

// Hub grid — each card pre-selects a category and jumps straight to the form.
const COMMON_ISSUES: {
  key: string;
  title: string;
  Icon: LucideIcon;
  category: { label: string; api: CategoryKey };
}[] = [
  { key: "stuck-escrow",    title: "Payment not released / stuck escrow", Icon: Wallet,        category: { label: "Payment not released / stuck escrow", api: "payment" } },
  { key: "wrong-amount",    title: "Wrong amount received",               Icon: IndianRupee,   category: { label: "Wrong amount received",               api: "payment" } },
  { key: "dispute",         title: "User dispute not resolving",          Icon: AlertTriangle, category: { label: "User dispute not resolving",          api: "other"   } },
  { key: "account-flagged", title: "Account flagged / suspended",         Icon: Lock,          category: { label: "Account flagged / suspended",         api: "other"   } },
  { key: "tier-upgrade",    title: "Tier upgrade not reflected",          Icon: TrendingUp,    category: { label: "Tier upgrade issue",                  api: "other"   } },
  { key: "escrow-delayed",  title: "Escrow release delayed",              Icon: ShieldCheck,   category: { label: "Payment not released / stuck escrow", api: "payment" } },
];

const STATUS_FILTERS: Array<{ value: "" | IssueStatus; label: string }> = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
];

const QuickAction = ({
  label,
  Icon,
  onClick,
}: {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
}) => (
  <motion.button
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    className={`flex flex-col items-center justify-center gap-2 py-4 rounded-2xl ${FIELD} hover:bg-white/[0.06] transition-colors`}
  >
    <span className={`w-10 h-10 rounded-full ${FIELD} flex items-center justify-center`}>
      <Icon className="w-4 h-4 text-white/70" strokeWidth={2} />
    </span>
    <span className="text-[13px] font-bold text-white">{label}</span>
  </motion.button>
);

const IssueCard = ({
  title,
  Icon,
  onClick,
}: {
  title: string;
  Icon: LucideIcon;
  onClick: () => void;
}) => (
  <motion.button
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className={`text-left rounded-xl p-3.5 flex items-center gap-3 ${FIELD} hover:bg-white/[0.06] transition-colors`}
  >
    <span className={`w-10 h-10 rounded-full ${FIELD} flex items-center justify-center shrink-0`}>
      <Icon className="w-4 h-4 text-white/70" strokeWidth={2} />
    </span>
    <p className="flex-1 min-w-0 text-[12.5px] font-bold leading-[1.25] text-white">
      {title}
    </p>
    <ArrowRight className="w-3.5 h-3.5 text-white/30 shrink-0" strokeWidth={2.2} />
  </motion.button>
);

export function MerchantSupportPanel({
  merchantId,
}: {
  merchantId?: string | null;
}) {
  const [view, setView] = useState<"hub" | "create" | "tickets" | "detail">("hub");
  const [query, setQuery] = useState("");

  // create-flow state
  const [step, setStep] = useState<"category" | "form" | "success">("category");
  const [form, setForm] = useState<TicketForm>(INITIAL_FORM);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // tickets-list state
  const [issues, setIssues] = useState<IssueRowApi[] | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | IssueStatus>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ticket-detail state
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IssueDetailApi | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copiedDetail, setCopiedDetail] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // Load recent merchant orders for the optional "link order" dropdown.
  useEffect(() => {
    if (!merchantId) return;
    fetchWithAuth(`/api/merchant/orders?merchant_id=${merchantId}&limit=10`)
      .then((r) => r.json())
      .then((d) => {
        const rows = d?.data?.orders ?? d?.data ?? [];
        setOrders(Array.isArray(rows) ? rows.slice(0, 10) : []);
      })
      .catch(() => {});
  }, [merchantId]);

  const loadIssues = useCallback(async (status: "" | IssueStatus) => {
    setIssuesLoading(true);
    setIssuesError(null);
    try {
      const qs = status ? `?status=${status}` : "";
      const res = await fetchWithAuth(`/api/issues${qs}`);
      if (res.status === 404) {
        setIssues([]);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setIssues(Array.isArray(data.data?.issues) ? data.data.issues : []);
    } catch (e) {
      setIssuesError((e as Error).message || "Failed to load tickets");
      setIssues([]);
    } finally {
      setIssuesLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetchWithAuth(`/api/issues/${id}`);
      if (res.status === 404) {
        setDetailError("Ticket not found");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setDetail(data.data as IssueDetailApi);
    } catch (e) {
      setDetailError((e as Error).message || "Failed to load ticket");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Fetch the list whenever the tickets view is active or the filter changes.
  useEffect(() => {
    if (view === "tickets") void loadIssues(statusFilter);
  }, [view, statusFilter, loadIssues]);

  // Fetch the detail whenever the detail view opens for an id.
  useEffect(() => {
    if (view === "detail" && detailId) void loadDetail(detailId);
  }, [view, detailId, loadDetail]);

  const filteredIssues = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMON_ISSUES;
    return COMMON_ISSUES.filter((i) => i.title.toLowerCase().includes(q));
  }, [query]);

  const openTelegram = () => {
    if (typeof window === "undefined") return;
    window.open(TELEGRAM_DM_URL, "_blank", "noopener,noreferrer");
  };

  const openTickets = () => setView("tickets");

  const openDetail = (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailError(null);
    setLightboxIdx(null);
    setReplyText("");
    setReplyError(null);
    setView("detail");
  };

  const handleSendReply = async () => {
    const msg = replyText.trim();
    if (!msg || !detail || replySending) return;
    setReplySending(true);
    setReplyError(null);
    try {
      const res = await fetchWithAuth(`/api/issues/${detail.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setReplyText("");
      await loadDetail(detail.id); // refresh the timeline (polling/refresh)
    } catch (e) {
      setReplyError((e as Error).message || "Failed to send reply");
    } finally {
      setReplySending(false);
    }
  };

  const startCreate = () => {
    setForm(INITIAL_FORM);
    setStep("category");
    setError(null);
    setCreatedId(null);
    setView("create");
  };

  const startCreateWith = (label: string, api: CategoryKey) => {
    setForm({ ...INITIAL_FORM, categoryLabel: label, apiCategory: api });
    setStep("form");
    setError(null);
    setCreatedId(null);
    setView("create");
  };

  const selectCategory = (label: string, api: CategoryKey) => {
    setForm((f) => ({ ...f, categoryLabel: label, apiCategory: api }));
    setStep("form");
  };

  const backToHub = () => {
    setView("hub");
    setStep("category");
    setForm(INITIAL_FORM);
    setError(null);
    setCreatedId(null);
  };

  const handleCreateBack = () => {
    if (step === "form") {
      setStep("category");
      return;
    }
    backToHub();
  };

  const handleCopyRowId = useCallback(async (id: string) => {
    const ok = await copyToClipboard(id);
    if (ok) {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1200);
    }
  }, []);

  const handleCopyDetailId = useCallback(async () => {
    if (!detail) return;
    const ok = await copyToClipboard(detail.id);
    if (ok) {
      setCopiedDetail(true);
      window.setTimeout(() => setCopiedDetail(false), 1200);
    }
  }, [detail]);

  const handleSubmit = async () => {
    if (!form.subject.trim() || !form.description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const metadata: Record<string, unknown> = {
        category_label: form.categoryLabel,
        source: "merchant-in-app-support",
      };
      if (form.orderId) metadata.linked_order_id = form.orderId;

      const res = await fetchWithAuth("/api/issues/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.subject.trim(),
          category: form.apiCategory,
          description: form.description.trim(),
          metadata,
        }),
      });
      if (res.status === 204) {
        throw new Error(
          "Support tickets are temporarily unavailable. Please contact us via Telegram."
        );
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setCreatedId(data.data?.id ?? null);
      setStep("success");
    } catch (e) {
      setError((e as Error).message || "Failed to submit ticket");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    form.subject.trim().length > 0 &&
    form.description.trim().length >= 10 &&
    !submitting;

  // ─── Hub view ───
  if (view === "hub") {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold mb-1">Support</h2>
            <p className="text-sm text-white/40">
              Get help, raise a ticket, or track your existing ones
            </p>
          </div>
          <button
            onClick={openTickets}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl ${FIELD} text-white hover:bg-white/[0.06] transition-colors shrink-0`}
          >
            <Ticket className="w-[15px] h-[15px] text-white/60" strokeWidth={2} />
            <span className="text-[12px] font-bold">My Tickets</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <QuickAction label="Raise a ticket" Icon={Ticket} onClick={startCreate} />
          <QuickAction label="Telegram" Icon={Send} onClick={openTelegram} />
        </div>

        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ${FIELD}`}>
          <Search className="w-[18px] h-[18px] text-white/30 shrink-0" strokeWidth={2} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search issues, payments, disputes..."
            maxLength={100}
            aria-label="Search support topics"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm font-medium text-white placeholder:text-white/20"
          />
          <button
            type="button"
            aria-label="Voice search"
            className="shrink-0 text-white/30 hover:text-white/60 transition-colors"
          >
            <Mic className="w-[17px] h-[17px]" strokeWidth={2} />
          </button>
        </div>

        {filteredIssues.length === 0 ? (
          <div className={`rounded-2xl py-10 px-5 flex flex-col items-center justify-center text-center ${CARD}`}>
            <span className={`w-12 h-12 rounded-full ${FIELD} flex items-center justify-center mb-3`}>
              <Search className="w-[18px] h-[18px] text-white/30" strokeWidth={2} />
            </span>
            <p className="text-sm font-bold text-white mb-1">No matching issues</p>
            <p className="text-xs font-medium text-white/40 mb-4">
              Couldn&apos;t find anything for &ldquo;{query.trim()}&rdquo;.
            </p>
            <button
              onClick={openTelegram}
              className="px-4 py-2 rounded-lg bg-[#f5f5f7] text-[#0b0b0c] text-[12px] font-bold hover:bg-white transition-colors"
            >
              DM support
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2.5">
            {filteredIssues.map(({ key, title, Icon, category }) => (
              <IssueCard
                key={key}
                title={title}
                Icon={Icon}
                onClick={() => startCreateWith(category.label, category.api)}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-center gap-3 pt-1">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white/40">
            <HelpCircle className="w-[14px] h-[14px]" strokeWidth={2} />
            Still need help?
          </span>
          <span className="w-px h-3 bg-white/[0.14]" />
          <button
            onClick={openTelegram}
            className="inline-flex items-center gap-1 text-[12px] font-bold text-white hover:text-white/70 transition-colors"
          >
            Contact us
            <ExternalLink className="w-[12px] h-[12px] text-white/30" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    );
  }

  // ─── Tickets list view ───
  if (view === "tickets") {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setView("hub")}
              aria-label="Back"
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${FIELD} text-white/70 hover:bg-white/[0.06] transition-colors shrink-0`}
            >
              <ChevronLeft className="w-5 h-5" />
            </motion.button>
            <div>
              <h2 className="text-lg font-bold mb-0.5">My Tickets</h2>
              <p className="text-sm text-white/40">
                Tickets you&apos;ve filed and their status
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadIssues(statusFilter)}
            disabled={issuesLoading}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-[12px] rounded-xl ${FIELD} text-white/70 hover:bg-white/[0.06] disabled:opacity-50 transition-colors`}
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${issuesLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Status filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUS_FILTERS.map((f) => {
            const active = f.value === statusFilter;
            return (
              <button
                key={f.value || "all"}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
                  active
                    ? "bg-white/[0.1] text-white"
                    : "bg-white/[0.04] text-white/50 hover:bg-white/[0.07] hover:text-white/80"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {issuesError ? (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-300 text-[13px]">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Could not load tickets</div>
              <div className="opacity-70">{issuesError}</div>
            </div>
          </div>
        ) : issuesLoading && issues === null ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`rounded-xl ${CARD} px-4 py-3`}>
                <div className="h-3 w-1/3 bg-white/10 rounded animate-pulse mb-2" />
                <div className="h-3 w-2/3 bg-white/10 rounded animate-pulse mb-1.5" />
                <div className="h-2 w-1/4 bg-white/10 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : (issues ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.1] bg-white/[0.02] px-6 py-10 text-center">
            <div className="text-sm font-bold text-white">
              {statusFilter ? "No tickets match this filter" : "No tickets yet"}
            </div>
            <div className="text-xs text-white/50 mt-1 max-w-sm mx-auto">
              {statusFilter
                ? "Try the All filter to see everything you've filed."
                : "Raise a ticket and it'll show up here so you can track its status."}
            </div>
            {!statusFilter && (
              <button
                onClick={startCreate}
                className="mt-4 px-4 py-2 rounded-lg bg-[#f5f5f7] text-[#0b0b0c] text-[12px] font-bold hover:bg-white transition-colors"
              >
                Raise a ticket
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {(issues ?? []).map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  onClick={() => openDetail(issue.id)}
                  className={`w-full text-left rounded-xl ${CARD} hover:bg-white/[0.04] transition-colors flex items-start gap-3 px-4 py-3`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={issue.status} />
                      <span className="text-[10px] uppercase tracking-wide text-white/40">
                        {prettyCategory(issue.category)}
                      </span>
                    </div>
                    <div className="text-[14px] font-medium text-white truncate">
                      {issue.title}
                    </div>
                    <div className="text-[12px] text-white/50 line-clamp-1">
                      {issue.description}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-white/40">
                      <span>Filed {relativeTime(issue.created_at)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Updated {relativeTime(issue.updated_at)}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handleCopyRowId(issue.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleCopyRowId(issue.id);
                          }
                        }}
                        className="inline-flex items-center gap-1 hover:text-white/70 font-mono cursor-pointer"
                        title="Copy tracking ID"
                      >
                        {copiedId === issue.id ? (
                          <>
                            <Check className="w-2.5 h-2.5 text-white" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-2.5 h-2.5" />
                            {`${issue.id.slice(0, 8)}…${issue.id.slice(-4)}`}
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/30 shrink-0 mt-1" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ─── Ticket detail view ───
  if (view === "detail") {
    const resolvedShots: IssueScreenshot[] = detail
      ? Array.isArray(detail.screenshots) && detail.screenshots.length > 0
        ? detail.screenshots
        : detail.screenshot_url
          ? [{ id: detail.id, url: detail.screenshot_url, type: "screenshot" as const }]
          : []
      : [];
    const resolvedAttachments: IssueAttachment[] = detail?.attachments ?? [];
    const resolvedHistory: StatusHistoryEntry[] = detail?.status_history ?? [];

    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setView("tickets")}
            aria-label="Back"
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${FIELD} text-white/70 hover:bg-white/[0.06] transition-colors shrink-0`}
          >
            <ChevronLeft className="w-5 h-5" />
          </motion.button>
          <h2 className="text-lg font-bold">Ticket</h2>
        </div>

        {detailError ? (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-300 text-[13px]">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">{detailError}</div>
              <div className="opacity-70">
                The ticket may have been removed, or it was filed under a
                different account.
              </div>
            </div>
          </div>
        ) : detailLoading || !detail ? (
          <div className="space-y-3">
            <div className="h-6 w-2/3 bg-white/10 rounded animate-pulse" />
            <div className="h-3 w-1/3 bg-white/10 rounded animate-pulse" />
            <div className={`h-32 rounded-xl ${CARD} animate-pulse`} />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[18px] font-semibold text-white">
                  {detail.title}
                </h1>
                <StatusBadge status={detail.status} />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/50">
                <span>{prettyCategory(detail.category)}</span>
                <span aria-hidden="true">·</span>
                <span>Filed {new Date(detail.created_at).toLocaleString("en-US")}</span>
                <span aria-hidden="true">·</span>
                <span>Updated {new Date(detail.updated_at).toLocaleString("en-US")}</span>
                <button
                  type="button"
                  onClick={handleCopyDetailId}
                  className="inline-flex items-center gap-1 hover:text-white/80 font-mono"
                  title="Copy tracking ID"
                >
                  {copiedDetail ? (
                    <>
                      <Check className="w-3 h-3 text-white" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      {detail.id}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Description */}
            <section className={`rounded-xl ${CARD} p-4`}>
              <h3 className="text-[12px] font-medium text-white/60 uppercase tracking-wide mb-2">
                Description
              </h3>
              <p className="text-[14px] whitespace-pre-wrap text-white/85 leading-relaxed">
                {detail.description}
              </p>
            </section>

            {/* Screenshots */}
            {resolvedShots.length > 0 && (
              <section>
                <h3 className="text-[12px] font-medium text-white/60 uppercase tracking-wide mb-2">
                  Screenshots ({resolvedShots.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {resolvedShots.map((shot, i) => (
                    <button
                      key={shot.id || `${i}-${shot.url}`}
                      type="button"
                      onClick={() => setLightboxIdx(i)}
                      className="relative rounded-lg overflow-hidden border border-white/[0.08] bg-black/40 aspect-video hover:border-white/30 transition-colors"
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
              <section>
                <h3 className="text-[12px] font-medium text-white/60 uppercase tracking-wide mb-2">
                  Attachments ({resolvedAttachments.length})
                </h3>
                <ul className="space-y-1">
                  {resolvedAttachments.map((a, i) => (
                    <li
                      key={`${i}-${a.url}`}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${FIELD}`}
                    >
                      <Paperclip className="w-3 h-3 text-white/40 shrink-0" />
                      <span className="flex-1 truncate text-[12px] text-white">
                        {a.name || "attachment"}
                      </span>
                      {typeof a.size_bytes === "number" && (
                        <span className="text-[10px] text-white/40 shrink-0">
                          {formatBytes(a.size_bytes)}
                        </span>
                      )}
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 p-1 rounded hover:bg-white/[0.08] text-white/60"
                        title="Open"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Timeline / replies */}
            {resolvedHistory.length > 0 && (
              <section>
                <h3 className="text-[12px] font-medium text-white/60 uppercase tracking-wide mb-2">
                  Replies &amp; updates
                </h3>
                <ol className="relative border-l border-white/[0.1] pl-4 space-y-3">
                  {resolvedHistory.map((entry, i) => (
                    <li key={i} className="relative">
                      <span
                        className={`absolute -left-[19px] top-1 w-2 h-2 rounded-full border ${
                          entry.status === "resolved"
                            ? "bg-white/[0.5] border-white/[0.5]"
                            : entry.status === "rejected"
                              ? "bg-rose-400 border-rose-400"
                              : entry.status === "in_progress"
                                ? "bg-amber-400 border-amber-400"
                                : "bg-white/40 border-white/40"
                        }`}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={entry.status} />
                        <span className="text-[11px] text-white/50">
                          {new Date(entry.at).toLocaleString("en-US")}
                        </span>
                        <span className="text-[10px] text-white/40 uppercase tracking-wide">
                          by {entry.by_type}
                        </span>
                      </div>
                      {entry.note && (
                        <div className="mt-1 text-[12px] text-white/70 whitespace-pre-wrap">
                          {entry.note}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* Reply composer — turns the support timeline into a two-way thread */}
            {detail.status === "closed" ? (
              <p className="text-[12px] text-white/40 text-center pt-1">
                This ticket is closed. Raise a new ticket if you still need help.
              </p>
            ) : (
              <section className="space-y-2">
                <h3 className="text-[12px] font-medium text-white/60 uppercase tracking-wide">
                  Reply
                </h3>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Write a reply to support…"
                  className={`${INPUT} resize-none`}
                />
                {replyError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="text-[12px] text-red-300">{replyError}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] text-white/30">
                    {replyText.length}/1000
                  </span>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSendReply}
                    disabled={!replyText.trim() || replySending}
                    className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#f5f5f7] text-[#0b0b0c] font-bold text-[13px] hover:bg-white transition-colors disabled:opacity-50"
                  >
                    {replySending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {replySending ? "Sending…" : "Send"}
                  </motion.button>
                </div>
              </section>
            )}
          </>
        )}

        {/* Lightbox overlay */}
        {lightboxIdx !== null &&
          resolvedShots[lightboxIdx] &&
          (() => {
            const shot = resolvedShots[lightboxIdx];
            return (
              <div
                role="dialog"
                aria-label="Screenshot"
                className="fixed inset-0 z-[90] bg-black/90 flex items-center justify-center p-4"
                onClick={() => setLightboxIdx(null)}
              >
                <button
                  type="button"
                  onClick={() => setLightboxIdx(null)}
                  className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                  aria-label="Close"
                >
                  <XIcon className="w-[18px] h-[18px]" />
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

  // ─── Create view ───
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {step !== "success" && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={handleCreateBack}
            aria-label="Back"
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${FIELD} text-white/70 hover:bg-white/[0.06] transition-colors shrink-0`}
          >
            <ChevronLeft className="w-5 h-5" />
          </motion.button>
        )}
        <div>
          <h2 className="text-lg font-bold mb-0.5">
            {step === "success" ? "Ticket Submitted" : "Raise a Ticket"}
          </h2>
          <p className="text-sm text-white/40">
            {step === "category"
              ? "Pick a topic to get started"
              : step === "form"
              ? "Tell us what's going on"
              : "We'll be in touch soon"}
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: Category */}
        {step === "category" && (
          <motion.div
            key="category"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-2.5"
          >
            {TICKET_CATEGORIES.map(({ key, label, icon: Icon }) => (
              <motion.button
                key={label}
                whileTap={{ scale: 0.98 }}
                onClick={() => selectCategory(label, key)}
                className={`w-full text-left rounded-xl p-4 flex items-center gap-3 ${FIELD} hover:bg-white/[0.06] transition-colors`}
              >
                <span className={`w-10 h-10 rounded-full ${FIELD} flex items-center justify-center shrink-0`}>
                  <Icon className="w-4 h-4 text-white/70" strokeWidth={2} />
                </span>
                <span className="flex-1 text-[13.5px] font-bold text-white">
                  {label}
                </span>
                <ChevronDown
                  className="w-4 h-4 text-white/30 rotate-[-90deg] shrink-0"
                  strokeWidth={2}
                />
              </motion.button>
            ))}
          </motion.div>
        )}

        {/* Step 2: Form */}
        {step === "form" && (
          <motion.div
            key="form"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={`rounded-2xl p-5 space-y-4 ${CARD}`}
          >
            {form.categoryLabel && (
              <span className="inline-flex items-center self-start px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-[12px] font-bold text-white/80">
                {form.categoryLabel}
              </span>
            )}

            <div>
              <label className={LABEL}>Subject</label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subject: e.target.value }))
                }
                maxLength={200}
                placeholder="Brief summary of your issue"
                className={INPUT}
              />
            </div>

            <div>
              <label className={LABEL}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                maxLength={1000}
                rows={5}
                placeholder="Describe what happened — include order IDs, amounts, and any steps you've already tried…"
                className={`${INPUT} resize-none`}
              />
              <p className="text-[10px] text-white/30 mt-1 text-right">
                {form.description.length}/1000
              </p>
            </div>

            {orders.length > 0 && (
              <div>
                <label className={LABEL}>
                  Linked order{" "}
                  <span className="text-white/30 normal-case font-sans tracking-normal">
                    (optional)
                  </span>
                </label>
                <div className="relative">
                  <select
                    value={form.orderId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, orderId: e.target.value }))
                    }
                    className={`${INPUT} appearance-none pr-9`}
                  >
                    <option value="">No specific order</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        #{o.order_number} · {o.type.toUpperCase()} ·{" "}
                        {o.fiat_currency}{" "}
                        {Number(o.fiat_amount).toLocaleString()} · {o.status}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-[12.5px] text-red-300">{error}</span>
              </div>
            )}

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={BTN_PRIMARY}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              {submitting ? "Submitting…" : "Submit Ticket"}
            </motion.button>

            <p className="text-[11px] text-white/30 text-center">
              Our team typically responds within 24 hours.
            </p>
          </motion.div>
        )}

        {/* Step 3: Success */}
        {step === "success" && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className={`rounded-2xl p-8 flex flex-col items-center text-center gap-5 ${CARD}`}
          >
            <div className="w-20 h-20 rounded-full bg-white/[0.06] border border-white/[0.1] flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-white" strokeWidth={1.8} />
            </div>
            <div>
              <p className="text-[20px] font-extrabold text-white tracking-[-0.02em]">
                Ticket Raised
              </p>
              <p className="text-[13px] text-white/50 mt-1.5 max-w-[260px] mx-auto">
                We&apos;ve received your ticket and will get back to you within
                24 hours.
              </p>
              {createdId && (
                <p className="mt-2 text-[11px] font-mono text-white/30">
                  Ref: {createdId.slice(0, 8).toUpperCase()}
                </p>
              )}
            </div>

            <div className="w-full space-y-2.5">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={openTickets}
                className={`w-full py-3 rounded-xl ${FIELD} text-sm font-bold text-white hover:bg-white/[0.06] transition-colors`}
              >
                View My Tickets
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={backToHub}
                className={BTN_PRIMARY}
              >
                Done
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IssueStatus }) {
  const map: Record<IssueStatus, { label: string; cls: string }> = {
    open: { label: "Open", cls: "bg-white/10 text-white/60 border-white/15" },
    in_progress: {
      label: "In Progress",
      cls: "bg-amber-500/15 text-amber-300 border-amber-500/25",
    },
    resolved: {
      label: "Resolved",
      cls: "bg-white/[0.08] text-white border-white/[0.14]",
    },
    rejected: {
      label: "Rejected",
      cls: "bg-rose-500/15 text-rose-300 border-rose-500/25",
    },
    closed: {
      label: "Closed",
      cls: "bg-white/[0.06] text-white/40 border-white/10",
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

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
