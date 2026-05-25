// POST /api/waitlist/tasks/:id/verify
//
// Verify a submitted task and credit points. For the launch MVP this is a
// self-service endpoint — the user clicks "I followed", we trust them and
// credit. Adminstrative override / audit-review path can layer on later via
// /api/admin/waitlist/tasks/:id/verify (not built yet).
//
// Strictly idempotent: a second call on an already-VERIFIED task does not
// double-credit (verifyAndCreditTask returns alreadyVerified=true).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse, errorResponse } from '@/lib/middleware/auth';
import { verifyAndCreditTask } from '@/lib/db/repositories/waitlistTasks';
import { queryOne } from '@/lib/db';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import { triggerRecompute } from '@/lib/threat/recompute';
import type { WaitlistTask } from '@/lib/types/database';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const rl = await checkRateLimit(request, 'waitlist:task-verify', STANDARD_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Waitlist tasks are only for users and merchants');
  }

  const { id } = await context.params;
  const task = await queryOne<WaitlistTask>(`SELECT * FROM waitlist_tasks WHERE id = $1`, [id]);
  if (!task) return errorResponse('Task not found', 404);
  if (task.actor_id !== auth.actorId || task.actor_type !== auth.actorType) {
    return forbiddenResponse('Not your task');
  }

  const result = await verifyAndCreditTask(id);

  // Fire-and-forget threat-score recompute. New verified tasks affect both
  // positive credits (engagement) and the RAPID_TASK_COMPLETION behavior
  // signal. Non-blocking — failure can never break this response.
  if (!result.alreadyVerified) {
    triggerRecompute(auth.actorType, auth.actorId);
  }

  return NextResponse.json({
    success: true,
    data: {
      task: result.task,
      points_credited: result.pointsCredited,
      already_verified: result.alreadyVerified,
    },
  });
}
