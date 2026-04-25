/**
 * GET /api/issues
 *
 * User-scoped list of the caller's own issue reports — powers the
 * "My Issues" page. Strictly returns only issues whose
 * (actor_type, created_by) match the authenticated session.
 *
 * Query params:
 *   ?status=open|in_progress|resolved|closed|rejected   (optional)
 *   ?limit=N                                            (1..200, default 50)
 *
 * Anonymous reports (no created_by) are NEVER returned here — they
 * have no owner to bind to. Admins use /api/admin/issues to see them.
 */

import { NextRequest } from 'next/server';
import {
  requireAuth,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { ISSUE_REPORTING_ENABLED } from '@/lib/issueReporter/featureFlag';
import {
  listIssuesForActor,
  IssueStatus,
  IssueActorType,
} from '@/lib/issueReporter/repository';

const VALID_STATUSES: IssueStatus[] = [
  'open',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
];

export async function GET(request: NextRequest) {
  if (!ISSUE_REPORTING_ENABLED) {
    return errorResponse('Issue reporting is disabled', 404);
  }

  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  // The actor_type column only stores 'user' | 'merchant' | 'compliance'
  // | 'anonymous'. Compliance staff and admins use the admin endpoint;
  // here we only expose the per-account view.
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return errorResponse('Use /api/admin/issues for staff queries', 403);
  }

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam && (VALID_STATUSES as string[]).includes(statusParam)
      ? (statusParam as IssueStatus)
      : undefined;
  const limit = Math.max(
    1,
    Math.min(200, parseInt(url.searchParams.get('limit') || '50', 10) || 50),
  );

  try {
    const rows = await listIssuesForActor(
      auth.actorType as IssueActorType,
      auth.actorId,
      { status, limit },
    );
    return successResponse({ issues: rows, count: rows.length });
  } catch (err) {
    console.error('[issues:list] query failed', err);
    return errorResponse('Failed to load issues', 500);
  }
}
