// POST /api/admin/waitlist/:actorType/:id/activate
// Flip a waitlisted account to 'active' so the user/merchant can use the full app.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { queryOne } from '@/lib/db';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ actorType: string; id: string }> },
) {
  const adminAuth = await requireAdminAuth(request);
  if (adminAuth) return adminAuth;

  const { actorType, id } = await context.params;
  if (actorType !== 'user' && actorType !== 'merchant') {
    return NextResponse.json({ success: false, error: 'Invalid actor type' }, { status: 400 });
  }
  const table = actorType === 'merchant' ? 'merchants' : 'users';

  const updated = await queryOne<{ id: string; waitlist_status: string }>(
    `UPDATE ${table}
        SET waitlist_status = 'active', updated_at = NOW()
      WHERE id = $1
      RETURNING id, waitlist_status`,
    [id],
  );
  if (!updated) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: updated });
}
