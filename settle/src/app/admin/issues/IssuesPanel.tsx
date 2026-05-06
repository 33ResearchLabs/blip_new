'use client';

/**
 * Pure-content panel for the Issues dashboard. Rendered both by the
 * standalone `/admin/issues` page and the merged `/admin/observability`
 * tabbed page — so nothing in here assumes a specific outer chrome.
 *
 * Exposes the optional `lastRefreshLabel` so the parent's sticky header
 * can surface the "Xs ago" timestamp without the panel rendering its own.
 */

import {
  Calendar,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Filter as FilterIcon,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { formatCount, formatPercentage } from '@/lib/format';

// ─── Types ─────────────────────────────────────────────────────────────────

type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'rejected';
type IssuePriority = 'low' | 'medium' | 'high' | 'critical';
type IssueCategory = 'ui_bug' | 'backend' | 'payment' | 'performance' | 'other';

interface IssueScreenshot {
  id: string;
  url: string;
  type: 'screenshot' | 'upload';
  mime?: string;
  size_bytes?: number;
  created_at?: string;
}

interface IssueStatusHistoryEntry {
  status: IssueStatus;
  at: string;
  by_type: 'admin' | 'system' | 'user' | 'merchant';
  by_id: string | null;
  note?: string;
}

interface IssueRow {
  id: string;
  title: string;
  category: IssueCategory;
  description: string;
  screenshot_url: string | null;
  screenshots: IssueScreenshot[] | null;
  attachments: Array<{ url: string; name: string; mime: string; size_bytes: number }>;
  status: IssueStatus;
  status_history: IssueStatusHistoryEntry[] | null;
  priority: IssuePriority;
  source: 'manual' | 'auto';
  created_by: string | null;
  actor_type: string | null;
  metadata: Record<string, unknown>;
  admin_notes: Array<{ note: string; author: string; at: string }>;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

// ─── Style maps ────────────────────────────────────────────────────────────

const STATUS_PILL: Record<IssueStatus, string> = {
  open: 'text-orange-300 bg-orange-500/10 border-orange-500/30',
  in_progress: 'text-sky-300 bg-sky-500/10 border-sky-500/30',
  resolved: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  closed: 'text-foreground/50 bg-foreground/[0.05] border-border',
  rejected: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
};

const STATUS_DOT: Record<IssueStatus, string> = {
  open: 'bg-orange-400',
  in_progress: 'bg-sky-400',
  resolved: 'bg-emerald-400',
  closed: 'bg-foreground/40',
  rejected: 'bg-rose-400',
};

const STATUS_LABEL: Record<IssueStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
  rejected: 'Rejected',
};

const PRIORITY_PILL: Record<IssuePriority, string> = {
  low: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  medium: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  high: 'text-orange-300 bg-orange-500/10 border-orange-500/30',
  critical: 'text-rose-300 bg-rose-600/20 border-rose-500/40',
};

const PRIORITY_DOT: Record<IssuePriority, string> = {
  low: 'bg-emerald-400',
  medium: 'bg-amber-400',
  high: 'bg-orange-400',
  critical: 'bg-rose-400',
};

const CATEGORY_PILL: Record<IssueCategory, string> = {
  ui_bug: 'text-purple-300 bg-purple-500/10 border-purple-500/30',
  backend: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',
  payment: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  performance: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  other: 'text-foreground/60 bg-foreground/[0.04] border-border',
};

const CATEGORY_LABEL: Record<IssueCategory, string> = {
  ui_bug: 'UI Bug',
  backend: 'Backend',
  payment: 'Payment',
  performance: 'Performance',
  other: 'Other',
};

const STATUS_CHOICES: IssueStatus[] = [
  'open',
  'in_progress',
  'resolved',
  'rejected',
  'closed',
];
const PRIORITY_CHOICES: IssuePriority[] = ['low', 'medium', 'high', 'critical'];
const PAGE_SIZE_CHOICES = [10, 25, 50, 100];

// ─── Helpers ───────────────────────────────────────────────────────────────

function shortId(id: string): string {
  const clean = id.replace(/-/g, '').toUpperCase();
  return `ISS-${clean.slice(0, 4)}`;
}

function readMetaString(
  meta: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | undefined {
  if (!meta) return undefined;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
}

function userDisplay(r: IssueRow): { name: string; sub: string } {
  const username =
    readMetaString(r.metadata, 'username', 'user_name', 'userName', 'name') ||
    undefined;
  const email = readMetaString(r.metadata, 'email');
  if (username && email) return { name: username, sub: email };
  if (username) {
    return {
      name: username,
      sub: r.created_by ? `${r.created_by.slice(0, 8)}…` : '—',
    };
  }
  if (email) return { name: email.split('@')[0], sub: email };
  return {
    name: r.actor_type ? r.actor_type.charAt(0).toUpperCase() + r.actor_type.slice(1) : 'Anonymous',
    sub: r.created_by ? `${r.created_by.slice(0, 12)}…` : '—',
  };
}

function deviceInfo(r: IssueRow): { version?: string; platform?: string; device?: string } {
  const m = r.metadata;
  return {
    version: readMetaString(m, 'app_version', 'appVersion', 'version'),
    platform: readMetaString(m, 'platform', 'os'),
    device: readMetaString(m, 'device', 'device_model', 'deviceModel'),
  };
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date}\n${time}`;
}

function downloadCsv(filename: string, rows: IssueRow[]) {
  const header = [
    'id',
    'title',
    'category',
    'priority',
    'status',
    'created_by',
    'actor_type',
    'created_at',
    'updated_at',
  ];
  const escape = (v: unknown) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const body = rows
    .map((r) =>
      [
        r.id,
        r.title,
        r.category,
        r.priority,
        r.status,
        r.created_by ?? '',
        r.actor_type ?? '',
        r.created_at,
        r.updated_at,
      ]
        .map(escape)
        .join(','),
    )
    .join('\n');
  const csv = `${header.join(',')}\n${body}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Stat card ─────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  totalLabel?: string;
  dotColor?: string;
  active?: boolean;
  onClick?: () => void;
}

function StatCard({
  label,
  value,
  total,
  totalLabel,
  dotColor,
  active,
  onClick,
}: StatCardProps) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const showPct = totalLabel === undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition ${
        active
          ? 'border-orange-500/40 bg-orange-500/[0.04]'
          : 'border-border bg-card hover:border-foreground/20'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          {dotColor ? (
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
          ) : null}
          <span className="text-[11px] text-foreground/50 font-medium">{label}</span>
        </div>
        {totalLabel ? (
          <span className="text-[10px] uppercase tracking-wider text-foreground/35">
            {totalLabel}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xl font-bold tabular-nums text-foreground/90">
          {formatCount(value)}
        </span>
        {showPct ? (
          <span className="text-[11px] tabular-nums text-foreground/40">
            {formatPercentage(pct)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

// ─── Select pill (custom dropdown) ─────────────────────────────────────────

interface SelectProps<T extends string> {
  value: T | '';
  onChange: (v: T | '') => void;
  options: { value: T; label: string }[];
  placeholder: string;
  width?: string;
}

function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  width = 'w-40',
}: SelectProps<T>) {
  const current = options.find((o) => o.value === value);
  return (
    <div className={`relative ${width}`}>
      <select
        value={value}
        onChange={(e) => onChange((e.target.value as T) || '')}
        className="w-full appearance-none bg-card border border-border rounded-lg px-3 py-1.5 pr-8 text-[12px] text-foreground/80 focus:border-foreground/30 focus:outline-none cursor-pointer"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground/40"
      />
      {current ? null : null /* placeholder retains default look */}
    </div>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────

export interface IssuesPanelProps {
  /**
   * Called whenever the list refreshes or polling ticks. Lets a parent
   * render its own "last updated Xs ago" indicator without the panel
   * duplicating that UI.
   */
  onRefreshStateChange?: (state: { loading: boolean; lastRefresh: Date }) => void;
}

export default function IssuesPanel({ onRefreshStateChange }: IssuesPanelProps) {
  // ─── Data ──────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Server-side filters (sent to API)
  const [statusFilter, setStatusFilter] = useState<IssueStatus | ''>('');
  const [categoryFilter, setCategoryFilter] = useState<IssueCategory | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<IssuePriority | ''>('');

  // Client-side filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showDateRange, setShowDateRange] = useState(false);

  // Sort + pagination
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Selection
  const [selected, setSelected] = useState<IssueRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Detail-panel mutation state
  const [pendingStatus, setPendingStatus] = useState<IssueStatus | ''>('');
  const [statusNoteDraft, setStatusNoteDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [savingAction, setSavingAction] = useState(false);

  const dateRangeRef = useRef<HTMLDivElement | null>(null);

  // Admin auth now travels via the httpOnly `blip_admin_session` cookie
  // — sent automatically on same-origin requests. No Authorization
  // header is needed; the cookie cannot be read from JS.

  // ─── Fetch ─────────────────────────────────────────────────────────────
  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (categoryFilter) qs.set('category', categoryFilter);
      if (priorityFilter) qs.set('priority', priorityFilter);
      qs.set('limit', '500');
      const res = await fetch(`/api/admin/issues?${qs.toString()}`);
      if (res.status === 404) {
        setError(
          'Issue reporting is disabled. Set ENABLE_ISSUE_REPORTING=true on the server.',
        );
        setRows([]);
        return;
      }
      if (!res.ok) {
        setError(`Failed to load (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setRows(data.data);
        setLastRefresh(new Date());
      } else {
        setError(data.error || 'Failed to load');
      }
    } catch (e) {
      setError((e as Error).message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, priorityFilter]);

  useEffect(() => {
    fetchIssues();
    const id = setInterval(fetchIssues, 15_000);
    return () => clearInterval(id);
  }, [fetchIssues]);

  useEffect(() => {
    onRefreshStateChange?.({ loading, lastRefresh });
  }, [loading, lastRefresh, onRefreshStateChange]);

  // Keep selected row in sync with refreshed list.
  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.id === selected.id);
    if (fresh && fresh.updated_at !== selected.updated_at) {
      setSelected(fresh);
      setPendingStatus('');
    }
  }, [rows, selected]);

  // Reset page when filters change.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, categoryFilter, priorityFilter, search, startDate, endDate, pageSize]);

  // Close date popover on outside click.
  useEffect(() => {
    if (!showDateRange) return;
    const handler = (e: MouseEvent) => {
      if (
        dateRangeRef.current &&
        !dateRangeRef.current.contains(e.target as Node)
      ) {
        setShowDateRange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDateRange]);

  // ─── Derived ───────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = rows.length;
    const c: Record<IssueStatus, number> = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      closed: 0,
      rejected: 0,
    };
    for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
    return {
      total,
      open: c.open,
      inProgress: c.in_progress,
      resolved: c.resolved,
      closed: c.closed + c.rejected,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let r = rows;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (x) =>
          x.title.toLowerCase().includes(q) ||
          x.description.toLowerCase().includes(q) ||
          x.id.toLowerCase().includes(q) ||
          (x.created_by ?? '').toLowerCase().includes(q),
      );
    }
    if (startDate) {
      const t = new Date(`${startDate}T00:00:00`).getTime();
      if (Number.isFinite(t)) {
        r = r.filter((x) => new Date(x.created_at).getTime() >= t);
      }
    }
    if (endDate) {
      const t = new Date(`${endDate}T23:59:59`).getTime();
      if (Number.isFinite(t)) {
        r = r.filter((x) => new Date(x.created_at).getTime() <= t);
      }
    }
    const sorted = [...r].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return sortDir === 'desc' ? tb - ta : ta - tb;
    });
    return sorted;
  }, [rows, search, startDate, endDate, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);
  const showingFrom = filtered.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, filtered.length);

  const hasFilters =
    !!statusFilter ||
    !!categoryFilter ||
    !!priorityFilter ||
    !!search ||
    !!startDate ||
    !!endDate;

  // ─── Mutations ─────────────────────────────────────────────────────────
  const patchIssue = useCallback(
    async (
      id: string,
      patch: {
        status?: IssueStatus;
        priority?: IssuePriority;
        note?: string;
        statusNote?: string;
      },
    ) => {
      setSavingAction(true);
      try {
        const res = await fetch(`/api/admin/issues/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          setRows((prev) => prev.map((r) => (r.id === id ? data.data : r)));
          setSelected((prev) => (prev && prev.id === id ? data.data : prev));
          setPendingStatus('');
        } else {
          setError(data?.error || `Failed (HTTP ${res.status})`);
        }
      } catch (e) {
        setError((e as Error).message || 'Network error');
      } finally {
        setSavingAction(false);
      }
    },
    [],
  );

  const clearAllFilters = () => {
    setStatusFilter('');
    setCategoryFilter('');
    setPriorityFilter('');
    setSearch('');
    setStartDate('');
    setEndDate('');
  };

  const toggleRowSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllSelect = () => {
    setSelectedIds((prev) => {
      if (prev.size === paginated.length && paginated.length > 0) return new Set();
      return new Set(paginated.map((r) => r.id));
    });
  };

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold leading-tight text-foreground/90">
            Issues
          </h1>
          <p className="text-[12px] text-foreground/45 mt-0.5">
            Manage and resolve user issues and support tickets
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            downloadCsv(
              `issues-${new Date().toISOString().slice(0, 10)}.csv`,
              filtered,
            )
          }
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-[12px] text-foreground/80 hover:bg-foreground/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download size={13} /> Export
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2">
        <StatCard
          label="All Issues"
          value={stats.total}
          total={stats.total}
          totalLabel="Total"
          active={!statusFilter}
          onClick={() => setStatusFilter('')}
        />
        <StatCard
          label="Open"
          value={stats.open}
          total={stats.total}
          dotColor="bg-orange-400"
          active={statusFilter === 'open'}
          onClick={() => setStatusFilter(statusFilter === 'open' ? '' : 'open')}
        />
        <StatCard
          label="In Progress"
          value={stats.inProgress}
          total={stats.total}
          dotColor="bg-sky-400"
          active={statusFilter === 'in_progress'}
          onClick={() =>
            setStatusFilter(statusFilter === 'in_progress' ? '' : 'in_progress')
          }
        />
        <StatCard
          label="Resolved"
          value={stats.resolved}
          total={stats.total}
          dotColor="bg-emerald-400"
          active={statusFilter === 'resolved'}
          onClick={() =>
            setStatusFilter(statusFilter === 'resolved' ? '' : 'resolved')
          }
        />
        <StatCard
          label="Closed"
          value={stats.closed}
          total={stats.total}
          dotColor="bg-foreground/40"
          active={statusFilter === 'closed'}
          onClick={() => setStatusFilter(statusFilter === 'closed' ? '' : 'closed')}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-[320px]">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/35"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues..."
            maxLength={100}
            className="w-full bg-card border border-border rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-foreground/80 placeholder:text-foreground/30 focus:border-foreground/30 focus:outline-none"
          />
        </div>

        <Select<IssueCategory>
          value={categoryFilter}
          onChange={setCategoryFilter}
          placeholder="All Categories"
          options={(Object.entries(CATEGORY_LABEL) as [IssueCategory, string][]).map(
            ([v, label]) => ({ value: v, label }),
          )}
          width="w-36"
        />
        <Select<IssuePriority>
          value={priorityFilter}
          onChange={setPriorityFilter}
          placeholder="All Priorities"
          options={PRIORITY_CHOICES.map((p) => ({
            value: p,
            label: p.charAt(0).toUpperCase() + p.slice(1),
          }))}
          width="w-36"
        />
        <Select<IssueStatus>
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All Statuses"
          options={STATUS_CHOICES.map((s) => ({
            value: s,
            label: STATUS_LABEL[s],
          }))}
          width="w-36"
        />

        <div className="relative" ref={dateRangeRef}>
          <button
            type="button"
            onClick={() => setShowDateRange((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[12px] ${
              startDate || endDate
                ? 'border-orange-500/40 text-orange-300 bg-orange-500/5'
                : 'bg-card border-border text-foreground/60 hover:border-foreground/30'
            }`}
          >
            <Calendar size={13} />
            <span className="tabular-nums">
              {startDate || endDate
                ? `${startDate || '…'} — ${endDate || '…'}`
                : 'Start date — End date'}
            </span>
          </button>
          {showDateRange ? (
            <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-border bg-card p-3 shadow-xl">
              <div className="space-y-2">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-foreground/40 mb-1">
                    Start date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-[12px] text-foreground/80 focus:outline-none focus:border-foreground/30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-foreground/40 mb-1">
                    End date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-[12px] text-foreground/80 focus:outline-none focus:border-foreground/30"
                  />
                </div>
                <div className="flex justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                    }}
                    className="text-[11px] text-foreground/50 hover:text-foreground/80"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDateRange(false)}
                    className="text-[11px] font-medium text-orange-300 hover:text-orange-200"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={clearAllFilters}
          disabled={!hasFilters}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-border text-[12px] text-foreground/70 hover:bg-foreground/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
          title={hasFilters ? 'Clear all filters' : 'No filters active'}
        >
          <FilterIcon size={13} /> Filters
        </button>

        <div className="ml-auto" />

        <button
          type="button"
          disabled
          title="Manual issue creation is currently disabled"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 text-white text-[12px] font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create Issue <Plus size={14} />
        </button>
      </div>

      {error ? (
        <div className="px-3 py-2 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[12px]">
          {error}
        </div>
      ) : null}

      {/* Main grid: table + detail panel */}
      <div
        className={`grid gap-3 ${
          selected ? 'grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px]' : 'grid-cols-1'
        }`}
      >
        {/* Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-foreground/45 border-b border-border">
                  <th className="w-8 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.size === paginated.length && paginated.length > 0
                      }
                      onChange={toggleAllSelect}
                      className="accent-orange-500"
                    />
                  </th>
                  <th className="text-left px-2 py-2.5 font-medium">
                    <button
                      type="button"
                      onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
                      className="inline-flex items-center gap-1 hover:text-foreground/80"
                    >
                      ID
                      <span className="text-foreground/40">{sortDir === 'desc' ? '↓' : '↑'}</span>
                    </button>
                  </th>
                  <th className="text-left px-2 py-2.5 font-medium">Title</th>
                  <th className="text-left px-2 py-2.5 font-medium">Category</th>
                  <th className="text-left px-2 py-2.5 font-medium">User</th>
                  <th className="text-left px-2 py-2.5 font-medium">Priority</th>
                  <th className="text-left px-2 py-2.5 font-medium">Status</th>
                  <th className="text-left px-2 py-2.5 font-medium whitespace-nowrap">
                    Created At
                  </th>
                  <th className="text-right px-3 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-foreground/35">
                      No issues match the current filters.
                    </td>
                  </tr>
                ) : (
                  paginated.map((r) => {
                    const user = userDisplay(r);
                    const isSelected = selected?.id === r.id;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setSelected(r)}
                        className={`border-b border-border last:border-0 cursor-pointer transition ${
                          isSelected
                            ? 'bg-orange-500/[0.04]'
                            : 'hover:bg-foreground/[0.02]'
                        }`}
                      >
                        <td
                          className="w-8 px-3 py-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(r.id)}
                            onChange={() => toggleRowSelect(r.id)}
                            className="accent-orange-500"
                          />
                        </td>
                        <td className="px-2 py-2.5 font-mono text-foreground/55 whitespace-nowrap">
                          {shortId(r.id)}
                        </td>
                        <td className="px-2 py-2.5 max-w-[280px]">
                          <div className="flex items-center gap-1.5">
                            {r.screenshot_url || r.screenshots?.length ? (
                              <Camera
                                size={11}
                                className="text-foreground/30 shrink-0"
                              />
                            ) : null}
                            {r.attachments?.length > 0 ? (
                              <FileText
                                size={11}
                                className="text-foreground/30 shrink-0"
                              />
                            ) : null}
                            <span
                              className={`truncate ${
                                isSelected
                                  ? 'text-orange-300'
                                  : 'text-orange-300/85 hover:text-orange-200'
                              }`}
                            >
                              {r.title}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-md border text-[10px] font-medium ${CATEGORY_PILL[r.category]}`}
                          >
                            {CATEGORY_LABEL[r.category]}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 max-w-[180px]">
                          <div className="flex flex-col leading-tight">
                            <span className="text-foreground/85 truncate">
                              {user.name}
                            </span>
                            <span className="text-[10px] text-foreground/40 font-mono truncate">
                              {user.sub}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ${PRIORITY_PILL[r.priority]}`}
                          >
                            <span
                              className={`inline-block h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[r.priority]}`}
                            />
                            {r.priority.charAt(0).toUpperCase() + r.priority.slice(1)}
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ${STATUS_PILL[r.status]}`}
                          >
                            <span
                              className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[r.status]}`}
                            />
                            {STATUS_LABEL[r.status]}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 whitespace-pre text-foreground/55 leading-tight tabular-nums">
                          {fmtDateTime(r.created_at)}
                        </td>
                        <td
                          className="px-3 py-2.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setSelected(r)}
                            className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40 hover:text-foreground/80"
                            aria-label="Open details"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-t border-border bg-foreground/[0.01]">
            <div className="text-[11px] text-foreground/45">
              Showing {showingFrom} to {showingTo} of {filtered.length} results
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1 rounded border border-border bg-card text-foreground/60 hover:bg-foreground/[0.04] disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeft size={13} />
              </button>
              {pageNumbers(page, pageCount).map((n, i) =>
                n === '…' ? (
                  <span
                    key={`gap-${i}`}
                    className="px-1.5 text-[11px] text-foreground/30"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPage(n)}
                    className={`min-w-[24px] px-1.5 py-0.5 rounded text-[11px] font-medium tabular-nums ${
                      page === n
                        ? 'bg-orange-500 text-white'
                        : 'bg-card border border-border text-foreground/70 hover:bg-foreground/[0.04]'
                    }`}
                  >
                    {n}
                  </button>
                ),
              )}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount}
                className="p-1 rounded border border-border bg-card text-foreground/60 hover:bg-foreground/[0.04] disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRight size={13} />
              </button>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                className="ml-2 bg-card border border-border rounded px-1.5 py-0.5 text-[11px] text-foreground/70 focus:outline-none"
              >
                {PAGE_SIZE_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Detail panel */}
        {selected ? (
          <DetailPanel
            issue={selected}
            pendingStatus={pendingStatus}
            setPendingStatus={setPendingStatus}
            statusNoteDraft={statusNoteDraft}
            setStatusNoteDraft={setStatusNoteDraft}
            noteDraft={noteDraft}
            setNoteDraft={setNoteDraft}
            saving={savingAction}
            onClose={() => setSelected(null)}
            onPatch={patchIssue}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Pagination helper ────────────────────────────────────────────────────

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | '…')[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('…');
  pages.push(total);
  return pages;
}

// ─── Detail panel ─────────────────────────────────────────────────────────

interface DetailPanelProps {
  issue: IssueRow;
  pendingStatus: IssueStatus | '';
  setPendingStatus: (s: IssueStatus | '') => void;
  statusNoteDraft: string;
  setStatusNoteDraft: (v: string) => void;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  saving: boolean;
  onClose: () => void;
  onPatch: (
    id: string,
    patch: {
      status?: IssueStatus;
      priority?: IssuePriority;
      note?: string;
      statusNote?: string;
    },
  ) => Promise<void>;
}

function DetailPanel({
  issue,
  pendingStatus,
  setPendingStatus,
  statusNoteDraft,
  setStatusNoteDraft,
  noteDraft,
  setNoteDraft,
  saving,
  onClose,
  onPatch,
}: DetailPanelProps) {
  const user = userDisplay(issue);
  const device = deviceInfo(issue);
  const shots: IssueScreenshot[] =
    Array.isArray(issue.screenshots) && issue.screenshots.length > 0
      ? issue.screenshots
      : issue.screenshot_url
        ? [{ id: issue.id, url: issue.screenshot_url, type: 'screenshot' as const }]
        : [];

  const applyPendingStatus = async () => {
    if (!pendingStatus || pendingStatus === issue.status) return;
    await onPatch(issue.id, {
      status: pendingStatus,
      ...(statusNoteDraft.trim() ? { statusNote: statusNoteDraft.trim() } : {}),
    });
    setStatusNoteDraft('');
  };

  return (
    <aside className="bg-card border border-border rounded-xl flex flex-col self-start sticky top-3 max-h-[calc(100vh-32px)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-foreground/85">
            Issue Details
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-medium ${STATUS_PILL[issue.status]}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[issue.status]}`}
            />
            {STATUS_LABEL[issue.status]}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40"
            aria-label="More"
          >
            <MoreHorizontal size={14} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/40"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[12px]">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono font-semibold text-foreground/90">
            {shortId(issue.id)}
          </span>
          <span className="text-[11px] text-foreground/45">
            Created:{' '}
            {new Date(issue.created_at).toLocaleString('en-US', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </span>
        </div>
        <h2 className="text-orange-300 font-semibold leading-snug">
          {issue.title}
        </h2>

        {/* Field grid */}
        <div className="grid grid-cols-3 gap-3 border-y border-border py-3">
          <FieldBlock label="Category">
            <span
              className={`inline-flex px-2 py-0.5 rounded-md border text-[10px] font-medium ${CATEGORY_PILL[issue.category]}`}
            >
              {CATEGORY_LABEL[issue.category]}
            </span>
          </FieldBlock>
          <FieldBlock label="Priority">
            <span className="inline-flex items-center gap-1 text-foreground/85">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[issue.priority]}`}
              />
              {issue.priority.charAt(0).toUpperCase() + issue.priority.slice(1)}
            </span>
          </FieldBlock>
          <FieldBlock label="User">
            <div className="leading-tight">
              <div className="text-foreground/85 truncate">{user.name}</div>
              <div className="text-[10px] text-foreground/40 font-mono truncate">
                {user.sub}
              </div>
            </div>
          </FieldBlock>
          <FieldBlock label="Version">
            <span className="text-foreground/80">{device.version || '—'}</span>
          </FieldBlock>
          <FieldBlock label="Platform">
            <span className="text-foreground/80">{device.platform || '—'}</span>
          </FieldBlock>
          <FieldBlock label="Device">
            <span className="text-foreground/80">{device.device || '—'}</span>
          </FieldBlock>
        </div>

        {/* Description */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-foreground/40 mb-1">
            Description
          </div>
          <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed">
            {issue.description}
          </p>
        </div>

        {/* Screenshots */}
        {shots.length > 0 ? (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-foreground/40 mb-2">
              Screenshots ({shots.length})
            </div>
            <div className="grid grid-cols-3 gap-2">
              {shots.map((shot, i) => (
                <a
                  key={shot.id || `${i}-${shot.url}`}
                  href={shot.url}
                  target="_blank"
                  rel="noreferrer"
                  className="relative block rounded border border-border overflow-hidden bg-black/40 aspect-video hover:border-foreground/30 transition"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.url}
                    alt={`Screenshot ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {/* Attachments */}
        {issue.attachments?.length > 0 ? (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-foreground/40 mb-2">
              Attachments
            </div>
            <ul className="space-y-1.5">
              {issue.attachments.map((a, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-md bg-foreground/[0.04] border border-border"
                >
                  <FileText size={13} className="text-foreground/40 shrink-0" />
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate text-foreground/80 hover:underline"
                  >
                    {a.name}
                  </a>
                  <span className="text-[10px] text-foreground/45 tabular-nums">
                    {(a.size_bytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 rounded hover:bg-foreground/[0.06] text-foreground/50"
                    aria-label="Download"
                  >
                    <Download size={12} />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Actions block */}
        <div className="border-t border-border pt-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wider text-foreground/40">
            Actions
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="relative">
              <select
                value={pendingStatus || ''}
                onChange={(e) => setPendingStatus((e.target.value as IssueStatus) || '')}
                disabled={saving}
                className="w-full appearance-none bg-background border border-border rounded-lg px-2.5 py-2 pr-7 text-[12px] text-foreground/80 focus:outline-none focus:border-foreground/30 disabled:opacity-50"
              >
                <option value="">Change Status</option>
                {STATUS_CHOICES.filter((s) => s !== issue.status).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40"
              />
            </div>
            <button
              type="button"
              onClick={applyPendingStatus}
              disabled={
                saving || !pendingStatus || pendingStatus === issue.status
              }
              className="px-3 py-2 rounded-lg bg-orange-500 text-white text-[12px] font-medium hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Update Issue
            </button>
            <button
              type="button"
              onClick={() => onPatch(issue.id, { status: 'closed' })}
              disabled={saving || issue.status === 'closed'}
              className="px-3 py-2 rounded-lg bg-card border border-orange-500/40 text-orange-300 text-[12px] font-medium hover:bg-orange-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Close Issue
            </button>
            <button
              type="button"
              disabled
              title="Agent assignment not yet enabled"
              className="px-3 py-2 rounded-lg bg-card border border-border text-foreground/70 text-[12px] font-medium hover:bg-foreground/[0.04] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Assign to Agent
            </button>
          </div>

          {/* Optional reply note */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground/40 mb-1">
              Reply (visible to reporter)
            </label>
            <textarea
              value={statusNoteDraft}
              onChange={(e) => setStatusNoteDraft(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Add an optional reply that will appear in the reporter's timeline…"
              className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground/80 placeholder:text-foreground/30 focus:outline-none focus:border-foreground/30"
            />
          </div>

          {/* Priority quick-set */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-foreground/40 mb-1">
              Priority
            </label>
            <div className="flex flex-wrap gap-1">
              {PRIORITY_CHOICES.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={saving || issue.priority === p}
                  onClick={() => onPatch(issue.id, { priority: p })}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-medium ${
                    issue.priority === p
                      ? PRIORITY_PILL[p]
                      : 'bg-foreground/[0.03] border-border text-foreground/60 hover:bg-foreground/[0.07]'
                  } disabled:opacity-50`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[p]}`}
                  />
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Internal note */}
          <div>
            <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-foreground/40 mb-1">
              <MessageSquarePlus size={11} /> Internal note
            </label>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="Add context for other admins…"
              className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-foreground/80 placeholder:text-foreground/30 focus:outline-none focus:border-foreground/30"
            />
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={async () => {
                  if (!noteDraft.trim()) return;
                  await onPatch(issue.id, { note: noteDraft });
                  setNoteDraft('');
                }}
                disabled={saving || !noteDraft.trim()}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-foreground text-background disabled:opacity-40"
              >
                Add note
              </button>
            </div>
          </div>

          {issue.admin_notes?.length > 0 ? (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">
                Admin notes ({issue.admin_notes.length})
              </div>
              <ul className="space-y-1.5">
                {issue.admin_notes.map((n, i) => (
                  <li
                    key={i}
                    className="px-2.5 py-1.5 rounded-md bg-foreground/[0.04] border border-border text-[12px]"
                  >
                    <div className="text-[10px] text-foreground/45 mb-0.5">
                      {n.author} · {new Date(n.at).toLocaleString()}
                    </div>
                    <div className="whitespace-pre-wrap text-foreground/80">
                      {n.note}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Activity timeline */}
        {issue.status_history && issue.status_history.length > 0 ? (
          <div className="border-t border-border pt-4">
            <div className="text-[11px] uppercase tracking-wider text-foreground/40 mb-2">
              Activity Timeline
            </div>
            <ol className="relative border-l border-border pl-4 space-y-3">
              {issue.status_history.map((entry, i) => (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[19px] top-1 inline-block h-2 w-2 rounded-full border-2 border-background ${STATUS_DOT[entry.status]}`}
                  />
                  <div className="flex flex-wrap items-baseline gap-1.5 leading-snug">
                    <span className="text-foreground/80">
                      {i === 0 ? 'Issue created' : `Status changed to ${STATUS_LABEL[entry.status]}`}
                    </span>
                  </div>
                  <div className="text-[10px] text-foreground/45 mt-0.5">
                    {new Date(entry.at).toLocaleString('en-US', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })}{' '}
                    · by {entry.by_type}
                  </div>
                  {entry.note ? (
                    <div className="mt-1 text-[12px] text-foreground/70 whitespace-pre-wrap">
                      {entry.note}
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">
        {label}
      </div>
      <div className="text-[12px]">{children}</div>
    </div>
  );
}
