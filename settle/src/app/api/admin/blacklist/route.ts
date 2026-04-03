/**
 * Blacklist Admin API
 *
 * GET    /api/admin/blacklist          — List active blacklist entries
 * POST   /api/admin/blacklist          — Add entity to blacklist
 * DELETE /api/admin/blacklist          — Remove entity from blacklist
 *
 * Requires admin auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import {
  getActiveBlacklist,
  addToBlacklist,
  removeFromBlacklist,
  type BlacklistEntityType,
} from '@/lib/db/repositories/risk';

const VALID_ENTITY_TYPES: BlacklistEntityType[] = ['user', 'merchant', 'device', 'ip', 'wallet'];

export async function GET(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const entityType = request.nextUrl.searchParams.get('type') as BlacklistEntityType | null;
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '100');

    if (entityType && !VALID_ENTITY_TYPES.includes(entityType)) {
      return NextResponse.json(
        { success: false, error: `Invalid type. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const entries = await getActiveBlacklist(entityType || undefined, limit);

    return NextResponse.json({
      success: true,
      data: entries,
    });
  } catch (error) {
    console.error('[API] GET /api/admin/blacklist error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch blacklist' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { entity_id, entity_type, reason, severity, expires_at } = body;

    if (!entity_id || !entity_type || !reason) {
      return NextResponse.json(
        { success: false, error: 'entity_id, entity_type, and reason are required' },
        { status: 400 }
      );
    }

    if (!VALID_ENTITY_TYPES.includes(entity_type)) {
      return NextResponse.json(
        { success: false, error: `Invalid entity_type. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const entry = await addToBlacklist(
      entity_id,
      entity_type,
      reason,
      severity || 'hard',
      'admin',
      expires_at ? new Date(expires_at) : undefined
    );

    console.log('[BLACKLIST] Entity added to blacklist', {
      entity_id,
      entity_type,
      reason,
      severity: severity || 'hard',
    });

    return NextResponse.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    console.error('[API] POST /api/admin/blacklist error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to add to blacklist' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { entity_id, entity_type } = body;

    if (!entity_id || !entity_type) {
      return NextResponse.json(
        { success: false, error: 'entity_id and entity_type are required' },
        { status: 400 }
      );
    }

    const removed = await removeFromBlacklist(entity_id, entity_type);

    console.log('[BLACKLIST] Entity removed from blacklist', {
      entity_id,
      entity_type,
      removed,
    });

    return NextResponse.json({
      success: true,
      data: { removed },
    });
  } catch (error) {
    console.error('[API] DELETE /api/admin/blacklist error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to remove from blacklist' },
      { status: 500 }
    );
  }
}
