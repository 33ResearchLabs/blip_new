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
 *     screenshot?: dataUrl,    LEGACY: optional base64 JPEG/PNG, ≤ 400KB
 *     screenshots?: [          v2: optional ordered list, ≤ 5 items
 *       { dataUrl, type?: 'screenshot'|'upload', mime?, size_bytes? }
 *     ],
 *     attachments?: [          optional, ≤ 5 files, each ≤ 25MB
 *       { name, dataUrl }
 *     ],
 *     metadata?: object        optional auto-collected context
 *   }
 *
 * Back-compat: when a v1 client sends `screenshot` (single dataUrl) we
 * upload it and treat it as a one-element `screenshots` list. v2 clients
 * sending `screenshots[]` get full multi-shot ingest.
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
import {
  createIssue,
  IssueAttachment,
  IssueCategory,
  IssueScreenshot,
} from '@/lib/issueReporter/repository';
import {
  uploadIssueScreenshot,
  uploadIssueAttachment,
} from '@/lib/issueReporter/upload';

// 30MB hard cap — screenshots + attachments combined. Individual field
// caps (400KB per screenshot, 25MB per attachment) are enforced inside
// the upload helpers; this is a perimeter guard against abuse.
const MAX_BODY_BYTES = 30 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
// Multi-screenshot v2 cap. Matches the spec's "min 1, max 5" and the
// frontend's MAX_SCREENSHOTS so a misconfigured client can't bypass.
const MAX_SCREENSHOTS = 5;

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

  // ── Upload screenshots ──────────────────────────────────────────────
  // Two intake paths:
  //   1) v2: body.screenshots = [{ dataUrl, type, mime?, size_bytes? }, ...]
  //   2) v1 legacy: body.screenshot = '<dataUrl>' (single shot)
  // We normalize both into a v2-shaped IssueScreenshot[] before insert.
  const rawScreenshots: unknown =
    Array.isArray((body as { screenshots?: unknown }).screenshots)
      ? (body as { screenshots: unknown[] }).screenshots
      : [];
  const screenshotsList: { dataUrl: string; type: 'screenshot' | 'upload'; mime?: string; size_bytes?: number }[] = [];
  for (const item of rawScreenshots as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as {
      dataUrl?: unknown;
      type?: unknown;
      mime?: unknown;
      size_bytes?: unknown;
    };
    const dataUrl = typeof obj.dataUrl === 'string' ? obj.dataUrl : '';
    if (!dataUrl.startsWith('data:image/')) continue;
    const type = obj.type === 'upload' ? 'upload' : 'screenshot';
    screenshotsList.push({
      dataUrl,
      type,
      mime: typeof obj.mime === 'string' ? obj.mime : undefined,
      size_bytes: typeof obj.size_bytes === 'number' ? obj.size_bytes : undefined,
    });
  }
  // v1 legacy: collapse into the v2 list if no v2 field was provided.
  if (
    screenshotsList.length === 0 &&
    typeof body.screenshot === 'string' &&
    body.screenshot.startsWith('data:image/')
  ) {
    screenshotsList.push({ dataUrl: body.screenshot, type: 'screenshot' });
  }
  if (screenshotsList.length > MAX_SCREENSHOTS) {
    return NextResponse.json(
      { success: false, error: `Too many screenshots (max ${MAX_SCREENSHOTS})` },
      { status: 400 },
    );
  }

  // Upload each, dropping any that fail Cloudinary so the rest still
  // make it to DB. The order of the input list is preserved.
  const uploadedScreenshots: IssueScreenshot[] = [];
  for (const s of screenshotsList) {
    const url = await uploadIssueScreenshot(s.dataUrl);
    if (!url) continue;
    uploadedScreenshots.push({
      id: `s_${Date.now().toString(36)}_${uploadedScreenshots.length}`,
      url,
      type: s.type,
      mime: s.mime,
      size_bytes: s.size_bytes,
      created_at: new Date().toISOString(),
    });
  }
  // Legacy column: keep the first uploaded screenshot's URL so any
  // pre-Phase-1 admin/list code that reads `screenshot_url` keeps
  // showing something.
  const screenshotUrl = uploadedScreenshots[0]?.url ?? null;

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
      screenshots: uploadedScreenshots,
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
