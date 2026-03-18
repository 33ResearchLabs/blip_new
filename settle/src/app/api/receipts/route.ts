import { NextRequest, NextResponse } from 'next/server';
import { getReceiptsByParticipantIds } from '@/lib/db/repositories/receipts';
import {
  requireAuth,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Authorization check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Parse query params
    const searchParams = request.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const status = searchParams.get('status') || undefined;

    // Fetch receipts for the authenticated actor
    // If user has both user and merchant identities, query both
    const participantIds: string[] = [auth.actorId];
    if (auth.merchantId && auth.merchantId !== auth.actorId) participantIds.push(auth.merchantId);
    if (auth.userId && auth.userId !== auth.actorId) participantIds.push(auth.userId);
    const receipts = await getReceiptsByParticipantIds(participantIds, { limit, offset, status });

    logger.api.request('GET', '/api/receipts', auth.actorId);
    return successResponse({ receipts, limit, offset, count: receipts.length });
  } catch (error) {
    logger.api.error('GET', '/api/receipts', error as Error);
    return errorResponse('Internal server error');
  }
}
