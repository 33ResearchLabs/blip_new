import { NextRequest, NextResponse } from 'next/server';
import {
  getMerchantByIdSafe,
  serializeMerchant,
  updateMerchant,
} from '@/lib/db/repositories/merchants';
import { updateMerchantSchema, uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  forbiddenResponse,
  verifyAdminToken,
} from '@/lib/middleware/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid merchant ID format' },
        { status: 400 }
      );
    }

    // ── L1+L2: AuthN + AuthZ ──────────────────────────────────────────
    // Allow callers in two scopes only:
    //   1. admin    — valid admin HMAC token (Authorization: Bearer <admin>)
    //   2. self     — merchant token whose actorId matches the URL id
    // Anything else → 403 (logged). No anonymous reads.
    const authHeader = request.headers.get('authorization');
    const bearer =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : null;

    let scope: 'admin' | 'self' | null = null;

    if (bearer && verifyAdminToken(bearer).valid) {
      scope = 'admin';
    } else {
      const auth = await requireAuth(request);
      if (auth instanceof NextResponse) return auth;

      if (auth.actorType === 'merchant' && auth.actorId === id) {
        scope = 'self';
      } else {
        console.warn('[SECURITY] GET /api/merchant/[id] forbidden cross-actor read', {
          targetMerchantId: id,
          actorType: auth.actorType,
          actorId: auth.actorId,
          route: request.nextUrl.pathname,
        });
        return forbiddenResponse('You can only view your own merchant profile');
      }
    }

    // ── L3: explicit projection — secrets never enter the response path ──
    const merchant = await getMerchantByIdSafe(id);

    if (!merchant) {
      return NextResponse.json(
        { success: false, error: 'Merchant not found' },
        { status: 404 }
      );
    }

    console.info('[API] GET /api/merchant/[id] ok', {
      merchantId: id,
      scope,
    });

    // ── L4: DTO allowlist serializer (already used across auth/merchant) ──
    return NextResponse.json({ success: true, data: serializeMerchant(merchant) });
  } catch (error) {
    console.error('[API] GET /api/merchant/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid merchant ID format' },
        { status: 400 }
      );
    }

    // Require authentication for profile modification
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Verify the authenticated merchant matches the profile being modified
    if (auth.actorType === 'merchant' && auth.actorId !== id) {
      return forbiddenResponse('You can only modify your own profile');
    }

    const body = await request.json();

    const parseResult = updateMerchantSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return NextResponse.json(
        { success: false, error: errors.join(', ') },
        { status: 400 }
      );
    }

    const merchant = await updateMerchant(id, parseResult.data);

    if (!merchant) {
      return NextResponse.json(
        { success: false, error: 'Merchant not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: merchant });
  } catch (error) {
    console.error('[API] PATCH /api/merchant/[id] error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
