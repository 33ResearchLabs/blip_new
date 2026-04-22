/**
 * Admin endpoints for a single issue report.
 *
 * GET   /api/admin/issues/:id          — full row (incl. attachments, notes)
 * PATCH /api/admin/issues/:id          — update status / priority / add note
 *
 * Body for PATCH (all fields optional — send only what's changing):
 *   { status?: 'open' | 'in_progress' | 'resolved' | 'closed',
 *     priority?: 'low' | 'medium' | 'high' | 'critical',
 *     note?: string,          // appended to admin_notes
 *     resolvedBy?: string }   // recorded when status → resolved/closed
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { ISSUE_REPORTING_ENABLED } from '@/lib/issueReporter/featureFlag';
import {
  appendAdminNote,
  getIssueById,
  IssuePriority,
  IssueStatus,
  updateIssue,
} from '@/lib/issueReporter/repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUS: IssueStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_PRIORITY: IssuePriority[] = ['low', 'medium', 'high', 'critical'];

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!ISSUE_REPORTING_ENABLED) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const authErr = requireAdminAuth(request);
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
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  }

  let body: {
    status?: string;
    priority?: string;
    note?: string;
    resolvedBy?: string;
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

  try {
    let row = await updateIssue(id, {
      status: body.status as IssueStatus | undefined,
      priority: body.priority as IssuePriority | undefined,
      resolvedBy: body.resolvedBy,
    });
    if (!row) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (typeof body.note === 'string' && body.note.trim()) {
      row = await appendAdminNote(id, {
        note: body.note.trim().slice(0, 2000),
        author: body.resolvedBy || 'admin',
        at: new Date().toISOString(),
      });
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
