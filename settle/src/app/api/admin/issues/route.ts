/**
 * GET /api/admin/issues — admin listing + filtering of issue reports.
 *
 * Query params (all optional):
 *   ?status=open|in_progress|resolved|closed
 *   ?category=ui_bug|backend|payment|performance|other
 *   ?priority=low|medium|high|critical
 *   ?source=manual|auto
 *   ?limit=1..500 (default 100)
 *
 * AUTH: admin only (HMAC token via requireAdminAuth).
 * FLAG: returns 404 when ENABLE_ISSUE_REPORTING is off.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { ISSUE_REPORTING_ENABLED } from '@/lib/issueReporter/featureFlag';
import {
  IssueCategory,
  IssuePriority,
  IssueSource,
  IssueStatus,
  listIssues,
} from '@/lib/issueReporter/repository';

const VALID_STATUS: IssueStatus[] = ['open', 'in_progress', 'resolved', 'closed'];
const VALID_CATEGORY: IssueCategory[] = [
  'ui_bug',
  'backend',
  'payment',
  'performance',
  'other',
];
const VALID_PRIORITY: IssuePriority[] = ['low', 'medium', 'high', 'critical'];
const VALID_SOURCE: IssueSource[] = ['manual', 'auto'];

export async function GET(request: NextRequest) {
  if (!ISSUE_REPORTING_ENABLED) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const sp = request.nextUrl.searchParams;
  const status = sp.get('status') as IssueStatus | null;
  const category = sp.get('category') as IssueCategory | null;
  const priority = sp.get('priority') as IssuePriority | null;
  const source = sp.get('source') as IssueSource | null;
  const rawLimit = parseInt(sp.get('limit') || '100', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(500, rawLimit))
    : 100;

  if (status && !VALID_STATUS.includes(status)) {
    return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
  }
  if (category && !VALID_CATEGORY.includes(category)) {
    return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 });
  }
  if (priority && !VALID_PRIORITY.includes(priority)) {
    return NextResponse.json({ success: false, error: 'Invalid priority' }, { status: 400 });
  }
  if (source && !VALID_SOURCE.includes(source)) {
    return NextResponse.json({ success: false, error: 'Invalid source' }, { status: 400 });
  }

  try {
    const rows = await listIssues({
      status: status || undefined,
      category: category || undefined,
      priority: priority || undefined,
      source: source || undefined,
      limit,
    });
    return NextResponse.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    console.error('[admin/issues] list failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch issues' },
      { status: 500 },
    );
  }
}
