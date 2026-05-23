// POST /api/waitlist/onboard-form-webhook
//
// Receives one POST per Google Form submission, sent by an Apps Script
// trigger on the form's responses sheet. Looks up the matching waitlist
// actor by email and credits +500 BLIP via the same getOrCreateTask +
// verifyAndCreditTask path the in-app quest tiles use.
//
// Auth model:
//   • Shared secret in `Authorization: Bearer <ONBOARD_FORM_WEBHOOK_SECRET>`.
//   • The secret must be configured server-side only — Apps Script holds
//     the matching value inside the script's Script Properties (which never
//     leak to clients). The variable is resolved lazily so a missing env at
//     import-time doesn't break the Next.js build.
//
// Idempotency:
//   • One waitlist_tasks row per (actor_type, actor_id, 'ONBOARD_FORM')
//     enforced by the existing unique index from migration 131.
//   • A second webhook fire for the same actor finds the existing VERIFIED
//     row and short-circuits inside verifyAndCreditTask (alreadyVerified=
//     true, pointsCredited=0).
//   • Migration 136 also adds a partial unique index on
//     blip_point_log (actor_type, actor_id, event='MERCHANT_ONBOARD_FORM')
//     as a belt-and-braces guard against any future code path that tries
//     to credit directly without going through verifyAndCreditTask.
//
// Email matching:
//   • Case-insensitive lookup against the merchants table first, then
//     users — the form is targeted at merchant onboarding, so prefer the
//     merchant account when an email exists in both tables.
//   • If no actor matches, return 200 with matched=false so Apps Script
//     does NOT retry — typos / stale submissions are logged and dropped
//     rather than queued forever. Operators can re-credit manually if a
//     mismatch is reported.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { checkRateLimit, WEBHOOK_LIMIT } from '@/lib/middleware/rateLimit';
import { getOrCreateTask, verifyAndCreditTask } from '@/lib/db/repositories/waitlistTasks';
import type { WaitlistActorType } from '@/lib/types/database';

// Lazy secret resolver. NEVER read at module top-level — Next.js page-data
// collection at build time would otherwise crash if the var is unset.
function getWebhookSecret(): string | null {
  const v = process.env.ONBOARD_FORM_WEBHOOK_SECRET;
  return v && v.trim().length > 0 ? v : null;
}

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  form_response_id: z.string().trim().min(1).max(128).optional(),
  submitted_at: z.string().trim().max(64).optional(),
  metadata: z.record(z.unknown()).optional(),
});

interface ActorRow {
  id: string;
  email: string | null;
}

export async function POST(request: NextRequest) {
  // Rate limit: 200/min — same as other webhook surfaces. Apps Script
  // sends 1 request per form submission so this is purely DoS protection.
  const rl = await checkRateLimit(request, 'waitlist:onboard-form-webhook', WEBHOOK_LIMIT);
  if (rl) return rl;

  // Auth: Bearer secret must match server env. Reject anything else.
  const secret = getWebhookSecret();
  if (!secret) {
    console.error('[onboard-form-webhook] ONBOARD_FORM_WEBHOOK_SECRET not configured');
    return NextResponse.json(
      { success: false, error: 'Webhook not configured' },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get('authorization') ?? '';
  const presented = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!presented || presented !== secret) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  // Parse + validate body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid payload', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { email, form_response_id, submitted_at, metadata } = parsed.data;

  try {
    // Email lookup: merchants first (this is a merchant onboarding flow),
    // fall back to users. Case-insensitive via LOWER() to be tolerant of
    // capitalization differences between form input and signup.
    let actorType: WaitlistActorType | null = null;
    let actor = await queryOne<ActorRow>(
      `SELECT id, email FROM merchants WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    if (actor) {
      actorType = 'merchant';
    } else {
      actor = await queryOne<ActorRow>(
        `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email],
      );
      if (actor) actorType = 'user';
    }

    if (!actor || !actorType) {
      // No matching actor — log and return 200 so Apps Script doesn't
      // retry forever. Operators can manually credit later if needed.
      console.warn('[onboard-form-webhook] no actor match for email', {
        email_hash: hashForLog(email),
        form_response_id: form_response_id ?? null,
      });
      return NextResponse.json({
        success: true,
        matched: false,
        reason: 'no_actor_found',
      });
    }

    // Get-or-create the ONBOARD_FORM task row, stamping the form_response
    // metadata into proof_data so we have an audit trail on the actor row.
    const task = await getOrCreateTask(actor.id, actorType, 'ONBOARD_FORM', {
      form_response_id: form_response_id ?? null,
      submitted_at: submitted_at ?? null,
      // Spread any extra fields the Apps Script chose to send (e.g. country,
      // business name) — keeps the payload extensible without code changes.
      ...(metadata ?? {}),
    });

    // verifyAndCreditTask is idempotent — second fire is a no-op.
    const result = await verifyAndCreditTask(task.id);

    return NextResponse.json({
      success: true,
      matched: true,
      actor_id: actor.id,
      actor_type: actorType,
      task_id: task.id,
      points_credited: result.pointsCredited,
      already_verified: result.alreadyVerified,
    });
  } catch (err) {
    console.error('[onboard-form-webhook] failed', err);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}

// Light-weight email hash for log lines — avoids splattering raw emails
// into log aggregators. Stable across the process lifetime.
function hashForLog(email: string): string {
  let h = 5381;
  for (let i = 0; i < email.length; i++) h = ((h << 5) + h + email.charCodeAt(i)) | 0;
  return `e${(h >>> 0).toString(36)}`;
}
