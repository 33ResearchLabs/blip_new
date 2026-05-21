// Repository for waitlist_tasks. One row per (actor_type, actor_id, task_type)
// enforced by a UNIQUE index, so getOrCreate is the safe API for both
// 'start task' and 'submit proof' actions.

import { query, queryOne } from '../index';
import type { WaitlistTask, WaitlistActorType, WaitlistTaskType, WaitlistTaskStatus } from '../../types/database';
import { creditPoints } from '@/lib/waitlist/credit';
import { getTaskPoints } from '@/lib/waitlist/blipPoints';

export async function listTasksForActor(
  actorId: string,
  actorType: WaitlistActorType,
): Promise<WaitlistTask[]> {
  return query<WaitlistTask>(
    `SELECT * FROM waitlist_tasks WHERE actor_type = $1 AND actor_id = $2 ORDER BY created_at`,
    [actorType, actorId],
  );
}

export async function getTaskByType(
  actorId: string,
  actorType: WaitlistActorType,
  taskType: WaitlistTaskType,
): Promise<WaitlistTask | null> {
  return queryOne<WaitlistTask>(
    `SELECT * FROM waitlist_tasks
      WHERE actor_type = $1 AND actor_id = $2 AND task_type = $3`,
    [actorType, actorId, taskType],
  );
}

/** Create the task row in PENDING if missing; return the existing/new row. */
export async function getOrCreateTask(
  actorId: string,
  actorType: WaitlistActorType,
  taskType: WaitlistTaskType,
  proof: Record<string, unknown> = {},
): Promise<WaitlistTask> {
  const existing = await getTaskByType(actorId, actorType, taskType);
  if (existing) return existing;

  const row = await queryOne<WaitlistTask>(
    `INSERT INTO waitlist_tasks (actor_id, actor_type, task_type, status, proof_data)
     VALUES ($1, $2, $3, 'PENDING', $4)
     ON CONFLICT (actor_type, actor_id, task_type) DO UPDATE
       SET updated_at = NOW()
     RETURNING *`,
    [actorId, actorType, taskType, proof],
  );
  if (!row) throw new Error('getOrCreateTask: insert returned no row');
  return row;
}

export async function setTaskStatus(
  taskId: string,
  status: WaitlistTaskStatus,
  proofData?: Record<string, unknown>,
): Promise<WaitlistTask | null> {
  if (proofData) {
    return queryOne<WaitlistTask>(
      `UPDATE waitlist_tasks SET status = $1, proof_data = $2, updated_at = NOW()
        WHERE id = $3 RETURNING *`,
      [status, proofData, taskId],
    );
  }
  return queryOne<WaitlistTask>(
    `UPDATE waitlist_tasks SET status = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [status, taskId],
  );
}

/**
 * Mark a task verified and credit its points. Idempotent: re-running for an
 * already-VERIFIED task is a no-op (points are not re-credited).
 */
export async function verifyAndCreditTask(taskId: string): Promise<{
  task: WaitlistTask | null;
  pointsCredited: number;
  alreadyVerified: boolean;
}> {
  const task = await queryOne<WaitlistTask>(
    `SELECT * FROM waitlist_tasks WHERE id = $1`,
    [taskId],
  );
  if (!task) return { task: null, pointsCredited: 0, alreadyVerified: false };
  if (task.status === 'VERIFIED') return { task, pointsCredited: 0, alreadyVerified: true };

  const points = getTaskPoints(task.actor_type, task.task_type);

  await creditPoints({
    actorId: task.actor_id,
    actorType: task.actor_type,
    event: 'TASK_VERIFIED',
    points,
    metadata: { task_id: task.id, task_type: task.task_type },
  });

  const updated = await queryOne<WaitlistTask>(
    `UPDATE waitlist_tasks
        SET status = 'VERIFIED', points_awarded = $1, completed_at = NOW(), updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [points, taskId],
  );

  return { task: updated, pointsCredited: points, alreadyVerified: false };
}
