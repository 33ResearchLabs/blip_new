import { NextRequest, NextResponse } from 'next/server';
import { getReceiptsByParticipantIds, countReceiptsByParticipantIds } from '@/lib/db/repositories/receipts';
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
    const status = searchParams.get('status') || undefined;

    // Cursor-based pagination (preferred) or offset fallback
    const cursorCreatedAt = searchParams.get('cursor_created_at');
    const cursorId = searchParams.get('cursor_id');
    const cursor = cursorCreatedAt && cursorId
      ? { created_at: cursorCreatedAt, id: cursorId }
      : undefined;
    const offset = cursor ? 0 : parseInt(searchParams.get('offset') || '0', 10);

    // Fetch receipts for the authenticated actor
    // If user has both user and merchant identities, query both
    const participantIds: string[] = [auth.actorId];
    if (auth.merchantId && auth.merchantId !== auth.actorId) participantIds.push(auth.merchantId);
    if (auth.userId && auth.userId !== auth.actorId) participantIds.push(auth.userId);

    const [receipts, total] = await Promise.all([
      getReceiptsByParticipantIds(participantIds, { limit, offset, status, cursor }),
      countReceiptsByParticipantIds(participantIds, status),
    ]);

    // Build next_cursor from the last returned row
    const lastReceipt = receipts[receipts.length - 1];
    const nextCursor = lastReceipt && receipts.length === limit
      ? { created_at: lastReceipt.created_at, id: lastReceipt.id }
      : null;

    logger.api.request('GET', '/api/receipts', auth.actorId);
    return successResponse({
      receipts,
      total,
      limit,
      next_cursor: nextCursor,
      // Legacy fields for backward compat
      offset,
      count: receipts.length,
    });
  } catch (error) {
    logger.api.error('GET', '/api/receipts', error as Error);
    return errorResponse('Internal server error');
  }
}
