import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { proxyCoreApi } from '@/lib/proxy/coreApi';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const { id } = await params;
  const body = await request.json();
  const { action, reason } = body;

  if (!action || !['cancel'].includes(action)) {
    return NextResponse.json({ success: false, error: 'Invalid action. Supported: cancel' }, { status: 400 });
  }

  const requestId = request.headers.get('x-request-id') || randomUUID();
  const idempotencyKey = `ops-${action}-${id}-${Date.now()}`;

  return proxyCoreApi(`/v1/orders/${id}/events`, {
    method: 'POST',
    body: {
      event_type: 'ORDER_CANCELLED',
      actor_type: 'system',
      actor_id: 'ops_console',
      reason: reason || 'Admin cancellation via Ops Console',
    },
    actorType: 'system',
    actorId: 'ops_console',
    requestId,
    idempotencyKey,
  });
}
