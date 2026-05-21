// GET  /api/waitlist/tasks                  — list current actor's tasks
// POST /api/waitlist/tasks                  — start a task in PENDING (idempotent)
//   body: { task_type: 'TWITTER'|'TELEGRAM'|'DISCORD'|'QUIZ'|'WHITEPAPER'|'CUSTOM', proof_data? }

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, forbiddenResponse, errorResponse } from '@/lib/middleware/auth';
import { listTasksForActor, getOrCreateTask } from '@/lib/db/repositories/waitlistTasks';
import { checkRateLimit, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import type { WaitlistActorType, WaitlistTaskType } from '@/lib/types/database';

const VALID_TASK_TYPES: WaitlistTaskType[] = ['TWITTER', 'TELEGRAM', 'DISCORD', 'QUIZ', 'WHITEPAPER', 'CUSTOM'];

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Waitlist tasks are only for users and merchants');
  }
  const tasks = await listTasksForActor(auth.actorId, auth.actorType as WaitlistActorType);
  return NextResponse.json({ success: true, data: { tasks } });
}

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'waitlist:tasks', STANDARD_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (auth.actorType !== 'user' && auth.actorType !== 'merchant') {
    return forbiddenResponse('Waitlist tasks are only for users and merchants');
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }
  const taskType = body.task_type as WaitlistTaskType;
  if (!VALID_TASK_TYPES.includes(taskType)) {
    return errorResponse('Invalid task_type', 400);
  }
  const proof = (body.proof_data && typeof body.proof_data === 'object') ? body.proof_data as Record<string, unknown> : {};

  const task = await getOrCreateTask(auth.actorId, auth.actorType as WaitlistActorType, taskType, proof);
  return NextResponse.json({ success: true, data: { task } });
}
