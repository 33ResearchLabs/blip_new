/**
 * Admin endpoints for a single issue report.
 *
 * GET   /api/admin/issues/:id          — full row (incl. attachments, notes)
 * PATCH /api/admin/issues/:id          — update status / priority / add note
 *
 * Body for PATCH (all fields optional — send only what's changing):
 *   { status?: 'open' | 'in_progress' | 'resolved' | 'closed' | 'rejected',
 *     priority?: 'low' | 'medium' | 'high' | 'critical',
 *     note?: string,              // appended to admin_notes (internal-only)
 *     statusNote?: string,        // appended to status_history (user-visible).
 *     resolvedBy?: string,        // recorded when status → resolved/closed/rejected
 *     escalatedDepartment?: string } // routes ticket to a dept (risk|finance|compliance|...)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { ISSUE_REPORTING_ENABLED } from '@/lib/issueReporter/featureFlag';
import {
  appendAdminNote,
  appendIssueReply,
  getIssueById,
  IssuePriority,
  IssueStatus,
  updateIssue,
} from '@/lib/issueReporter/repository';
import { query } from '@/lib/db';
import { triggerEvent } from '@/lib/pusher/server';
import { getUserChannel } from '@/lib/pusher/channels';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUS: IssueStatus[] = ['open', 'in_progress', 'resolved', 'closed', 'rejected'];
const VALID_PRIORITY: IssuePriority[] = ['low', 'medium', 'high', 'critical'];
const VALID_DEPARTMENTS = ['risk', 'finance', 'compliance', 'engineering', 'legal', 'operations'];

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!ISSUE_REPORTING_ENABLED) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  }
  const row = await getIssueById(id);
  if (!row) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: row });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!ISSUE_REPORTING_ENABLED) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  }

  let body: {
    status?: string;
    priority?: string;
    note?: string;
    statusNote?: string;
    resolvedBy?: string;
    escalatedDepartment?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.status && !VALID_STATUS.includes(body.status as IssueStatus)) {
    return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
  }
  if (body.priority && !VALID_PRIORITY.includes(body.priority as IssuePriority)) {
    return NextResponse.json({ success: false, error: 'Invalid priority' }, { status: 400 });
  }
  if (body.escalatedDepartment && !VALID_DEPARTMENTS.includes(body.escalatedDepartment)) {
    return NextResponse.json({ success: false, error: 'Invalid department' }, { status: 400 });
  }

  try {
    const statusByType = body.status ? ('admin' as const) : undefined;
    const statusById = body.status ? body.resolvedBy ?? null : undefined;
    const trimmedStatusNote =
      typeof body.statusNote === 'string' && body.statusNote.trim()
        ? body.statusNote.trim().slice(0, 2000)
        : undefined;

    let row = await updateIssue(id, {
      status: body.status as IssueStatus | undefined,
      priority: body.priority as IssuePriority | undefined,
      resolvedBy: body.resolvedBy,
      statusNote: trimmedStatusNote,
      statusByType,
      statusById,
    });
    if (!row) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    // Escalation: stamp department + escalated_at
    if (body.escalatedDepartment) {
      const updated = await query<{ id: string; created_by: string | null; actor_type: string | null }>(
        `UPDATE issues SET escalated_department = $1, escalated_at = NOW(), status = 'escalated',
         status_history = status_history || $2::jsonb, updated_at = NOW()
         WHERE id = $3 RETURNING id, created_by, actor_type`,
        [
          body.escalatedDepartment,
          JSON.stringify([{
            status: 'escalated',
            at: new Date().toISOString(),
            by_type: 'admin',
            by_id: body.resolvedBy ?? null,
            note: `Escalated to ${body.escalatedDepartment}`,
          }]),
          id,
        ],
      );
      // Refresh row after escalation update
      const refreshed = await getIssueById(id);
      if (refreshed) row = refreshed;
      // Notify user via Pusher if we have their user id
      const userId = updated[0]?.actor_type === 'user' ? updated[0]?.created_by : null;
      if (userId) {
        triggerEvent(getUserChannel(userId), 'notification:new', {
          type: 'ticket_escalated',
          ticketId: id,
          title: 'Ticket Escalated',
          message: `Your support ticket has been escalated to the ${body.escalatedDepartment} team for review.`,
        }).catch(() => {});
      }
    }

    // Answer-only path: a user-visible note with no status change
    if (!body.status && !body.escalatedDepartment && trimmedStatusNote) {
      const replied = await appendIssueReply(id, {
        note: trimmedStatusNote,
        byType: 'admin',
        byId: body.resolvedBy ?? null,
      });
      if (replied) row = replied;
    }

    if (typeof body.note === 'string' && body.note.trim()) {
      row = await appendAdminNote(id, {
        note: body.note.trim().slice(0, 2000),
        author: body.resolvedBy || 'admin',
        at: new Date().toISOString(),
      });
    }

    // Send Pusher notification to user when ticket is resolved
    if (body.status === 'resolved' && row && row.created_by && row.actor_type === 'user') {
      triggerEvent(getUserChannel(row.created_by), 'notification:new', {
        type: 'ticket_resolved',
        ticketId: id,
        title: 'Support Ticket Resolved',
        message: trimmedStatusNote || 'Your support ticket has been resolved.',
        ticketRef: id.slice(0, 8).toUpperCase(),
      }).catch(() => {});
    }

    return NextResponse.json({ success: true, data: row });
  } catch (err) {
    console.error('[admin/issues/:id] update failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to update issue' },
      { status: 500 },
    );
  }
}
