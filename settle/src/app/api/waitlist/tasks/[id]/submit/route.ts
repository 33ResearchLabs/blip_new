// POST /api/waitlist/tasks/:id/submit
//
// Mark a task SUBMITTED (proof provided, awaiting verification). Idempotent —
// submitting an already-VERIFIED task is a no-op. This endpoint does NOT
// auto-credit points; that happens via /verify (admin or auto-verifier).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse, errorResponse } from '@/lib/middleware/auth';
import { setTaskStatus } from '@/lib/db/repositories/waitlistTasks';
import { queryOne } from '@/lib/db';
import type { WaitlistTask } from '@/lib/types/database';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const rl = await checkRateLimit(request, 'waitlist:task-submit', STANDARD_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Waitlist tasks are only for users and merchants');
  }

  const { id } = await context.params;
  const task = await queryOne<WaitlistTask>(
    `SELECT * FROM waitlist_tasks WHERE id = $1`,
    [id],
  );
  if (!task) return errorResponse('Task not found', 404);
  if (task.actor_id !== auth.actorId || task.actor_type !== auth.actorType) {
    return forbiddenResponse('Not your task');
  }
  if (task.status === 'VERIFIED') {
    return NextResponse.json({ success: true, data: { task, message: 'Already verified' } });
  }

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* allow empty body */ }
  const proof = (body.proof_data && typeof body.proof_data === 'object')
    ? { ...task.proof_data, ...(body.proof_data as Record<string, unknown>) }
    : task.proof_data;

  const updated = await setTaskStatus(id, 'SUBMITTED', proof);
  return NextResponse.json({ success: true, data: { task: updated } });
}
