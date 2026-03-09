import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { proxyCoreApi } from '@/lib/proxy/coreApi';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = request.headers.get('x-request-id') || randomUUID();
  return proxyCoreApi(`/v1/ops/orders/${id}/debug`, {
    method: 'GET',
    requestId,
  });
}
