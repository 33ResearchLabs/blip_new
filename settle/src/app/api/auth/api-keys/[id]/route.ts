import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
  notFoundResponse,
} from '@/lib/middleware/auth';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/auth/api-keys/:id
 * Revoke an API key. Idempotent — revoking an already-revoked key returns 200.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requireAuth(request);
  if ('status' in auth) return auth;

  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Only merchant accounts can revoke API keys');
  }

  // API keys cannot revoke other API keys
  if (auth.apiKeyId) {
    return forbiddenResponse('API keys cannot revoke other API keys — use a session token');
  }

  const row = await queryOne<{ id: string; merchant_id: string; revoked_at: string | null }>(
    `SELECT id, merchant_id, revoked_at FROM api_keys WHERE id = $1`,
    [id],
  );

  if (!row) return notFoundResponse('API key');

  if (row.merchant_id !== auth.merchantId) {
    return forbiddenResponse('You can only revoke your own API keys');
  }

  if (row.revoked_at) {
    return successResponse({ id, revoked: true, already_revoked: true });
  }

  await queryOne(
    `UPDATE api_keys SET revoked_at = NOW(), revoked_by = $1 WHERE id = $2`,
    [auth.actorId, id],
  );

  return successResponse({ id, revoked: true });
}

/**
 * GET /api/auth/api-keys/:id
 * Get metadata for a single API key (no full key shown).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requireAuth(request);
  if ('status' in auth) return auth;

  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Only merchant accounts can view API keys');
  }

  const row = await queryOne<{
    id: string;
    merchant_id: string;
    name: string;
    key_prefix: string;
    permissions: string[];
    last_used_at: string | null;
    created_at: string;
    revoked_at: string | null;
  }>(
    `SELECT id, merchant_id, name, key_prefix, permissions, last_used_at, created_at, revoked_at
     FROM api_keys WHERE id = $1`,
    [id],
  );

  if (!row) return notFoundResponse('API key');
  if (row.merchant_id !== auth.merchantId) return forbiddenResponse('You can only view your own API keys');

  const { merchant_id: _, ...safe } = row;
  return successResponse(safe);
}

/**
 * PATCH /api/auth/api-keys/:id
 * Rename an API key.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const auth = await requireAuth(request);
  if ('status' in auth) return auth;

  if (auth.actorType !== 'merchant') return forbiddenResponse('Merchant only');
  if (auth.apiKeyId) return forbiddenResponse('API keys cannot rename other API keys');

  let body: { name?: unknown };
  try { body = await request.json(); } catch { return errorResponse('Invalid JSON', 400); }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) return errorResponse('name is required (1–100 characters)', 400);

  // Check ownership BEFORE writing — avoids IDOR where write commits then 403 fires
  const existing = await queryOne<{ merchant_id: string }>(
    `SELECT merchant_id FROM api_keys WHERE id = $1`,
    [id],
  );
  if (!existing) return notFoundResponse('API key');
  if (existing.merchant_id !== auth.merchantId) return forbiddenResponse('Not your key');

  await queryOne(`UPDATE api_keys SET name = $1 WHERE id = $2`, [name, id]);

  return successResponse({ id, name });
}
