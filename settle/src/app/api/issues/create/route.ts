/**
 * POST /api/issues/create
 *
 * User-initiated issue report ingest. Accepts anonymous submissions
 * (pre-login crashes still matter) but tags the actor type/id when a
 * valid session token is presented.
 *
 * BODY:
 *   {
 *     title: string,           required, ≤ 200 chars
 *     category: string,        enum: ui_bug | backend | payment | performance | other
 *     description: string,     required, ≤ 500 chars
 *     screenshot?: dataUrl,    optional base64 JPEG/PNG, ≤ 400KB
 *     attachments?: [          optional, ≤ 5 files, each ≤ 25MB
 *       { name, dataUrl }
 *     ],
 *     metadata?: object        optional auto-collected context
 *   }
 *
 * SAFETY:
 *   - Feature-flagged (returns 204 when ENABLE_ISSUE_REPORTING is off)
 *   - Rate limited per IP/actor (STRICT_LIMIT: 10 req/min — creating
 *     issues is heavier than telemetry pings)
 *   - Auth OPTIONAL (same policy as /api/client-errors)
 *   - Body hard-capped at 30MB (screenshot + attachments combined)
 *   - Returns the created row so the UI can toast with an ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { ISSUE_REPORTING_ENABLED } from '@/lib/issueReporter/featureFlag';
import { getAuthContext } from '@/lib/middleware/auth';
import { createIssue, IssueAttachment, IssueCategory } from '@/lib/issueReporter/repository';
import {
  uploadIssueScreenshot,
  uploadIssueAttachment,
} from '@/lib/issueReporter/upload';

// 30MB hard cap — one screenshot + up to 5 attachments. Individual field
// caps (400KB screenshot, 25MB per attachment) are enforced inside the
// upload helpers; this is a perimeter guard against abuse.
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

const VALID_CATEGORIES: IssueCategory[] = [
  'ui_bug',
  'backend',
  'payment',
  'performance',
  'other',
];

export async function POST(request: NextRequest) {
  if (!ISSUE_REPORTING_ENABLED) {
    return new NextResponse(null, { status: 204 });
  }

  const rateLimitResponse = await checkRateLimit(request, 'issues-create', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  // Perimeter body-size guard (declared Content-Length). Reading happens
  // lazily below so we avoid buffering massive payloads we'd reject.
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { success: false, error: 'Request body too large (max 30MB combined)' },
      { status: 413 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // ── Validate required fields ────────────────────────────────────────
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category : 'other';

  if (!title || title.length > 200) {
    return NextResponse.json(
      { success: false, error: 'Title required (≤ 200 chars)' },
      { status: 400 },
    );
  }
  if (!description || description.length > 500) {
    return NextResponse.json(
      { success: false, error: 'Description required (≤ 500 chars)' },
      { status: 400 },
    );
  }
  if (!VALID_CATEGORIES.includes(category as IssueCategory)) {
    return NextResponse.json(
      { success: false, error: 'Invalid category' },
      { status: 400 },
    );
  }

  // ── Resolve actor (optional) ────────────────────────────────────────
  const auth = getAuthContext(request);
  const createdBy = auth?.actorId || null;
  const actorType = auth?.actorType
    ? auth.actorType === 'system'
      ? 'anonymous'
      : auth.actorType
    : 'anonymous';

  // ── Safe metadata pass-through ──────────────────────────────────────
  const clientMetadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};
  const metadata = {
    ...clientMetadata,
    submittedFrom: 'web',
    ip_hint: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
  };

  // ── Upload screenshot (optional) ────────────────────────────────────
  const screenshotDataUrl =
    typeof body.screenshot === 'string' && body.screenshot.startsWith('data:image/')
      ? body.screenshot
      : null;
  const screenshotUrl = screenshotDataUrl
    ? await uploadIssueScreenshot(screenshotDataUrl)
    : null;

  // ── Upload attachments (optional, ≤ MAX_ATTACHMENTS) ────────────────
  const rawAttachments = Array.isArray(body.attachments) ? body.attachments : [];
  if (rawAttachments.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { success: false, error: `Too many attachments (max ${MAX_ATTACHMENTS})` },
      { status: 400 },
    );
  }
  const attachments: IssueAttachment[] = [];
  for (const item of rawAttachments) {
    if (!item || typeof item !== 'object') continue;
    const dataUrl = typeof (item as { dataUrl?: unknown }).dataUrl === 'string'
      ? (item as { dataUrl: string }).dataUrl
      : '';
    const name = typeof (item as { name?: unknown }).name === 'string'
      ? (item as { name: string }).name
      : 'attachment';
    if (!dataUrl) continue;
    const uploaded = await uploadIssueAttachment(dataUrl, name);
    if (uploaded) attachments.push(uploaded);
  }

  // ── Insert ─────────────────────────────────────────────────────────
  try {
    const row = await createIssue({
      title: title.slice(0, 200),
      description: description.slice(0, 500),
      category: category as IssueCategory,
      screenshotUrl,
      attachments,
      createdBy,
      actorType,
      metadata,
      source: 'manual',
    });
    return NextResponse.json({
      success: true,
      data: {
        id: row.id,
        status: row.status,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    console.error('[issues/create] insert failed', err);
    return NextResponse.json(
      { success: false, error: 'Failed to record issue' },
      { status: 500 },
    );
  }
}
