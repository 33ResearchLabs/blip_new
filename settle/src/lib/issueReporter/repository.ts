/**
 * DB access layer for the `issues` table.
 * All writes go through here so the POST endpoint stays slim and admin
 * routes reuse the same shape.
 */

import { query, queryOne } from '@/lib/db';

export type IssueCategory = 'ui_bug' | 'backend' | 'payment' | 'performance' | 'other';
export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';
export type IssueSource = 'manual' | 'auto';
export type IssueActorType = 'user' | 'merchant' | 'compliance' | 'anonymous';

export interface IssueAttachment {
  url: string;
  name: string;
  mime: string;
  size_bytes: number;
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
  attachments: IssueAttachment[];
  status: IssueStatus;
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
  screenshotUrl: string | null;
  attachments: IssueAttachment[];
  createdBy: string | null;
  actorType: IssueActorType | null;
  metadata: Record<string, unknown>;
  source: IssueSource;
  priority?: IssuePriority;
}

export async function createIssue(input: CreateIssueInput): Promise<IssueRow> {
  const row = await queryOne<IssueRow>(
    `INSERT INTO issues
       (title, category, description, screenshot_url, attachments,
        source, created_by, actor_type, metadata, priority)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10)
     RETURNING *`,
    [
      input.title,
      input.category,
      input.description,
      input.screenshotUrl,
      JSON.stringify(input.attachments || []),
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
    if (patch.status === 'resolved' || patch.status === 'closed') {
      sets.push(`resolved_at = COALESCE(resolved_at, NOW())`);
      if (patch.resolvedBy !== undefined) {
        params.push(patch.resolvedBy);
        sets.push(`resolved_by = $${params.length}`);
      }
    } else {
      // Reopen clears the resolved_at / resolved_by markers.
      sets.push(`resolved_at = NULL`);
      sets.push(`resolved_by = NULL`);
    }
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
