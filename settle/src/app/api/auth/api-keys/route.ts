import { NextRequest } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { query, queryOne } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';

export const dynamic = 'force-dynamic';

const VALID_PERMISSIONS = ['orders:read', 'orders:write', 'wallet:read', 'notifications'] as const;
const DEFAULT_PERMISSIONS = [...VALID_PERMISSIONS];
const MAX_KEYS_PER_MERCHANT = 10;

/**
 * POST /api/auth/api-keys
 * Create a new API key for the authenticated merchant.
 * Returns the full key ONCE — it is never stored and cannot be retrieved again.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('status' in auth) return auth;

  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Only merchant accounts can create API keys');
  }

  // API keys cannot themselves create more API keys (no escalation)
  if (auth.apiKeyId) {
    return forbiddenResponse('API keys cannot create other API keys — use a session token');
  }

  let body: { name?: unknown; permissions?: unknown };
  try {
    body = await request.json();
  } catch {
    return validationErrorResponse(['Request body must be valid JSON']);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length < 1 || name.length > 100) {
    return validationErrorResponse(['name is required (1–100 characters)']);
  }

  // Validate optional permission subset
  let permissions: string[] = DEFAULT_PERMISSIONS;
  if (Array.isArray(body.permissions)) {
    const invalid = (body.permissions as unknown[]).filter(
      p => typeof p !== 'string' || !VALID_PERMISSIONS.includes(p as typeof VALID_PERMISSIONS[number]),
    );
    if (invalid.length > 0) {
      return validationErrorResponse([
        `Invalid permissions: ${JSON.stringify(invalid)}. Allowed: ${VALID_PERMISSIONS.join(', ')}`,
      ]);
    }
    permissions = body.permissions as string[];
    if (permissions.length === 0) {
      return validationErrorResponse(['permissions array must not be empty']);
    }
  }

  // Cap keys per merchant
  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM api_keys WHERE merchant_id = $1 AND revoked_at IS NULL`,
    [auth.merchantId],
  );
  if (parseInt(countRow?.count ?? '0', 10) >= MAX_KEYS_PER_MERCHANT) {
    return errorResponse(
      `Merchant already has ${MAX_KEYS_PER_MERCHANT} active API keys. Revoke one before creating another.`,
      400,
    );
  }

  // Generate key — sk_live_<64 random hex chars>
  const rawKey = `sk_live_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 15); // "sk_live_" + 7 chars

  const row = await queryOne<{ id: string; created_at: string }>(
    `INSERT INTO api_keys (merchant_id, name, key_prefix, key_hash, permissions)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [auth.merchantId, name, keyPrefix, keyHash, JSON.stringify(permissions)],
  );

  return successResponse(
    {
      id: row!.id,
      name,
      key: rawKey, // Shown ONCE — never retrievable again
      key_prefix: keyPrefix,
      permissions,
      created_at: row!.created_at,
      warning: 'Save this key now — it will not be shown again.',
    },
    201,
  );
}

/**
 * GET /api/auth/api-keys
 * List all API keys for the authenticated merchant (no full key shown).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if ('status' in auth) return auth;

  if (auth.actorType !== 'merchant') {
    return forbiddenResponse('Only merchant accounts can list API keys');
  }

  const rows = await query<{
    id: string;
    name: string;
    key_prefix: string;
    permissions: string[];
    last_used_at: string | null;
    created_at: string;
    revoked_at: string | null;
  }>(
    `SELECT id, name, key_prefix, permissions, last_used_at, created_at, revoked_at
     FROM api_keys
     WHERE merchant_id = $1
     ORDER BY created_at DESC`,
    [auth.merchantId],
  );

  return successResponse(rows);
}
