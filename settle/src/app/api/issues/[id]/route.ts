/**
 * GET /api/issues/[id]
 *
 * User-scoped single-issue fetch. Returns the issue only if it was
 * filed by the authenticated actor — otherwise responds 404 (no leak
 * about whether the id exists).
 *
 * Powers the "My Issue Detail" page: title, description, screenshots
 * gallery, attachments, current status, and status_history timeline.
 */

import { NextRequest } from 'next/server';
import {
  requireAuth,
  successResponse,
  errorResponse,
  notFoundResponse,
} from '@/lib/middleware/auth';
import { ISSUE_REPORTING_ENABLED } from '@/lib/issueReporter/featureFlag';
import {
  getIssueByIdForActor,
  IssueActorType,
} from '@/lib/issueReporter/repository';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!ISSUE_REPORTING_ENABLED) {
    return errorResponse('Issue reporting is disabled', 404);
  }

  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return errorResponse('Use /api/admin/issues/[id] for staff queries', 403);
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    // Reject malformed ids early — saves a round-trip to PG which would
    // 22P02 otherwise.
    return notFoundResponse('Issue');
  }

  try {
    const row = await getIssueByIdForActor(
      id,
      auth.actorType as IssueActorType,
      auth.actorId,
    );
    if (!row) return notFoundResponse('Issue');
    return successResponse(row);
  } catch (err) {
    console.error('[issues:get] query failed', err);
    return errorResponse('Failed to load issue', 500);
  }
}
