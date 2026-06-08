/**
 * POST /api/issues/[id]/reply
 *
 * Reporter-facing reply: lets the user/merchant who filed a ticket post a
 * message back on their own ticket, turning the one-way support timeline
 * into a two-way thread. The message is appended to status_history as a
 * `by_type: 'user' | 'merchant'` entry (pinned to the ticket's current
 * status), which the detail-page "Replies & updates" timeline already
 * renders. Admin answers continue to arrive via /api/admin/issues/[id].
 *
 * SAFETY:
 *   - Feature-flagged (404 when ENABLE_ISSUE_REPORTING is off)
 *   - user/merchant tokens only (staff use the admin route)
 *   - Ownership-guarded: 404 if the ticket wasn't filed by this actor
 *     (no leak about whether the id exists)
 *   - Rate limited (MESSAGE_LIMIT: 30 req/min)
 *   - Closed tickets are archived — replies are rejected with 409
 */

import { NextRequest } from 'next/server';
import { checkRateLimit, MESSAGE_LIMIT } from '@/lib/middleware/rateLimit';
import {
  requireAuth,
  successResponse,
  errorResponse,
  notFoundResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';
import { ISSUE_REPORTING_ENABLED } from '@/lib/issueReporter/featureFlag';
import {
  getIssueByIdForActor,
  appendIssueReply,
  IssueActorType,
} from '@/lib/issueReporter/repository';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Matches the chat-message cap (and the Zod/maxLength pairing convention).
const MAX_MESSAGE_LEN = 1000;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!ISSUE_REPORTING_ENABLED) {
    return errorResponse('Issue reporting is disabled', 404);
  }

  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return errorResponse('Use /api/admin/issues/[id] for staff replies', 403);
  }

  const rateLimitResponse = await checkRateLimit(
    request,
    'issues-reply',
    MESSAGE_LIMIT,
  );
  if (rateLimitResponse) return rateLimitResponse;

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    // Reject malformed ids early — saves a 22P02 round-trip to PG.
    return notFoundResponse('Issue');
  }

  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Invalid JSON body']);
  }

  const message =
    typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return validationErrorResponse(['message is required']);
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return validationErrorResponse([
      `message must be ${MAX_MESSAGE_LEN} characters or fewer`,
    ]);
  }

  try {
    // Ownership guard — only the actor who filed the ticket may reply.
    const row = await getIssueByIdForActor(
      id,
      auth.actorType as IssueActorType,
      auth.actorId,
    );
    if (!row) return notFoundResponse('Issue');

    if (row.status === 'closed') {
      return errorResponse('This ticket is closed', 409);
    }

    const updated = await appendIssueReply(id, {
      note: message,
      byType: auth.actorType as 'user' | 'merchant',
      byId: auth.actorId,
    });
    if (!updated) return notFoundResponse('Issue');

    return successResponse(updated);
  } catch (err) {
    console.error('[issues:reply] append failed', err);
    return errorResponse('Failed to post reply', 500);
  }
}
