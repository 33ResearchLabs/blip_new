/**
 * DB access layer for the `issues` table.
 * All writes go through here so the POST endpoint stays slim and admin
 * routes reuse the same shape.
 */

import { query, queryOne } from '@/lib/db';

export type IssueCategory = 'ui_bug' | 'backend' | 'payment' | 'performance' | 'other';
// 'rejected' added in migration 109. Keep 'closed' for legacy admin
// flows — both are terminal but rejected is user-visible (we couldn't
// reproduce / not a bug), closed is admin-internal cleanup.
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed' | 'rejected';
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';
export type IssueSource = 'manual' | 'auto';
export type IssueActorType = 'user' | 'merchant' | 'compliance' | 'anonymous';

export interface IssueAttachment {
  url: string;
  name: string;
  mime: string;
  size_bytes: number;
}

// Screenshots are first-class, ordered, and tagged with their origin
// (in-app capture vs. manual upload) so the UI can render them with
// the right affordances. Stored in the `screenshots` JSONB column.
export interface IssueScreenshot {
  id: string;
  url: string;
  type: 'screenshot' | 'upload';
  mime?: string;
  size_bytes?: number;
  created_at: string;
}

// One row in the user-visible status timeline. Append-only —
// updateIssueStatus pushes entries atomically.
export interface IssueStatusHistoryEntry {
  status: IssueStatus;
  at: string;
  by_type: 'admin' | 'system' | 'user' | 'merchant';
  by_id: string | null;
  note?: string;
}

export interface AdminNote {
  note: string;
  author: string;
  at: string;
}

export interface IssueRow {
  id: string;
  title: string;
  category: IssueCategory;
  description: string;
  screenshot_url: string | null;
  screenshots: IssueScreenshot[];
  attachments: IssueAttachment[];
  status: IssueStatus;
  status_history: IssueStatusHistoryEntry[];
  priority: IssuePriority;
  source: IssueSource;
  created_by: string | null;
  actor_type: IssueActorType | null;
  metadata: Record<string, unknown>;
  admin_notes: AdminNote[];
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
}

export interface CreateIssueInput {
  title: string;
  category: IssueCategory;
  description: string;
  // Legacy single-screenshot URL — kept for back-compat with the v1
  // reporter modal. New callers should populate `screenshots` instead;
  // when both are provided, screenshots[] is the canonical list and
  // screenshotUrl is left as a hint of "the first one" for downstream
  // consumers that haven't migrated yet.
  screenshotUrl: string | null;
  // v2 multi-screenshot array. Optional (undefined = legacy caller).
  screenshots?: IssueScreenshot[];
  attachments: IssueAttachment[];
  createdBy: string | null;
  actorType: IssueActorType | null;
  metadata: Record<string, unknown>;
  source: IssueSource;
  priority?: IssuePriority;
}

export async function createIssue(input: CreateIssueInput): Promise<IssueRow> {
  // Resolve the canonical screenshots list: prefer the explicit array
  // when the caller supplies one, otherwise synthesize a single-entry
  // list from the legacy screenshotUrl so the new UI sees a consistent
  // shape. The legacy `screenshot_url` column is also written so any
  // pre-Phase-1 admin code keeps working unchanged.
  const screenshots: IssueScreenshot[] =
    input.screenshots && input.screenshots.length > 0
      ? input.screenshots
      : input.screenshotUrl
        ? [
            {
              id: cryptoRandomId(),
              url: input.screenshotUrl,
              type: 'screenshot',
              created_at: new Date().toISOString(),
            },
          ]
        : [];
  const screenshotUrl = input.screenshotUrl ?? screenshots[0]?.url ?? null;

  // Seed status_history with the initial open entry attributed to the
  // submitting actor. Anonymous + compliance submissions collapse to
  // 'system' since their identifier isn't a persistent entity in the
  // user-visible timeline. The admin PATCH endpoint appends subsequent
  // entries with by_type='admin'.
  const initialHistory: IssueStatusHistoryEntry[] = [
    {
      status: 'open',
      at: new Date().toISOString(),
      by_type:
        input.actorType === 'user' || input.actorType === 'merchant'
          ? input.actorType
          : 'system',
      by_id: input.createdBy,
    },
  ];

  const row = await queryOne<IssueRow>(
    `INSERT INTO issues
       (title, category, description, screenshot_url, screenshots, attachments,
        status_history, source, created_by, actor_type, metadata, priority)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11::jsonb, $12)
     RETURNING *`,
    [
      input.title,
      input.category,
      input.description,
      screenshotUrl,
      JSON.stringify(screenshots),
      JSON.stringify(input.attachments || []),
      JSON.stringify(initialHistory),
      input.source,
      input.createdBy,
      input.actorType,
      JSON.stringify(input.metadata || {}),
      input.priority || 'medium',
    ],
  );
  if (!row) throw new Error('Failed to insert issue');
  return row;
}

// Node 19+ exposes crypto.randomUUID on globalThis. Fall back to a
// time+random hex string when it's somehow missing — these ids are
// client-visible only (used to key screenshot list items) and aren't
// security-sensitive.
function cryptoRandomId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface ListIssuesFilters {
  status?: IssueStatus;
  category?: IssueCategory;
  priority?: IssuePriority;
  source?: IssueSource;
  createdBy?: string;
  limit?: number;
}

export async function listIssues(filters: ListIssuesFilters = {}): Promise<IssueRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    clauses.push(`category = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    clauses.push(`priority = $${params.length}`);
  }
  if (filters.source) {
    params.push(filters.source);
    clauses.push(`source = $${params.length}`);
  }
  if (filters.createdBy) {
    params.push(filters.createdBy);
    clauses.push(`created_by = $${params.length}`);
  }

  const limit = Math.max(1, Math.min(500, filters.limit ?? 100));
  params.push(limit);

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return query<IssueRow>(
    `SELECT * FROM issues ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
}

export async function getIssueById(id: string): Promise<IssueRow | null> {
  return queryOne<IssueRow>(`SELECT * FROM issues WHERE id = $1`, [id]);
}

export interface UpdateIssueInput {
  status?: IssueStatus;
  priority?: IssuePriority;
  resolvedBy?: string | null;
  // When status is set, the caller may pass an optional note + author
  // that gets appended to status_history alongside the new status. This
  // is what powers the user-visible timeline on the detail page.
  statusNote?: string;
  statusByType?: 'admin' | 'system' | 'user' | 'merchant';
  statusById?: string | null;
}

export async function updateIssue(
  id: string,
  patch: UpdateIssueInput,
): Promise<IssueRow | null> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];

  if (patch.status) {
    params.push(patch.status);
    sets.push(`status = $${params.length}`);

    // Resolved/closed/rejected are all terminal — stamp resolved_at if
    // not already set. Reopens (back to open/in_progress) clear it.
    const isTerminal =
      patch.status === 'resolved' ||
      patch.status === 'closed' ||
      patch.status === 'rejected';
    if (isTerminal) {
      sets.push(`resolved_at = COALESCE(resolved_at, NOW())`);
      if (patch.resolvedBy !== undefined) {
        params.push(patch.resolvedBy);
        sets.push(`resolved_by = $${params.length}`);
      }
    } else {
      sets.push(`resolved_at = NULL`);
      sets.push(`resolved_by = NULL`);
    }

    // Append a status_history entry atomically inside the same UPDATE.
    // by_type defaults to 'admin' since this path is the admin PATCH
    // endpoint; callers updating from another context can override.
    const historyEntry: IssueStatusHistoryEntry = {
      status: patch.status,
      at: new Date().toISOString(),
      by_type: patch.statusByType ?? 'admin',
      by_id: patch.statusById ?? null,
      ...(patch.statusNote ? { note: patch.statusNote } : {}),
    };
    params.push(JSON.stringify([historyEntry]));
    sets.push(`status_history = status_history || $${params.length}::jsonb`);
  }

  if (patch.priority) {
    params.push(patch.priority);
    sets.push(`priority = $${params.length}`);
  }

  if (sets.length === 1) {
    // No actual field changes — return current row unchanged.
    return getIssueById(id);
  }

  params.push(id);
  return queryOne<IssueRow>(
    `UPDATE issues SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
}

/**
 * User-scoped listing for the "My Issues" page. Filters strictly on
 * (actor_type, created_by) — never returns an issue that wasn't filed
 * by the supplied actor. Anonymous reports (created_by = NULL) are
 * never returned here on purpose; they have no owner to bind to.
 */
export async function listIssuesForActor(
  actorType: IssueActorType,
  createdBy: string,
  filters: { status?: IssueStatus; limit?: number } = {},
): Promise<IssueRow[]> {
  const params: unknown[] = [actorType, createdBy];
  const clauses = ['actor_type = $1', 'created_by = $2'];
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  params.push(limit);
  return query<IssueRow>(
    `SELECT * FROM issues
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
    params,
  );
}

/**
 * User-scoped single fetch. Returns null when the issue exists but
 * was filed by a different actor — same shape as a true 404 so the
 * caller doesn't need to distinguish.
 */
export async function getIssueByIdForActor(
  id: string,
  actorType: IssueActorType,
  createdBy: string,
): Promise<IssueRow | null> {
  return queryOne<IssueRow>(
    `SELECT * FROM issues
       WHERE id = $1 AND actor_type = $2 AND created_by = $3`,
    [id, actorType, createdBy],
  );
}

/**
 * Append a single admin note. We store as a JSONB array and append
 * atomically so concurrent admins don't lose notes.
 */
export async function appendAdminNote(
  id: string,
  note: AdminNote,
): Promise<IssueRow | null> {
  return queryOne<IssueRow>(
    `UPDATE issues
     SET admin_notes = admin_notes || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify([note]), id],
  );
}
