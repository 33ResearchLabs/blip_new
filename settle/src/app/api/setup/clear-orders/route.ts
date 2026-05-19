import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';

// Clear all orders from the database (development only)
export async function POST(request: NextRequest) {
  // Block in production - this is a destructive endpoint
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'This endpoint is disabled in production' },
      { status: 403 }
    );
  }

  // Admin auth is REQUIRED unconditionally. The previous "only if
  // ADMIN_SECRET is set" gate was a misconfig footgun: forgetting the env
  // var on a preview/staging deploy turned this endpoint into an open
  // data-wipe. requireAdminAuth fails closed if ADMIN_SECRET is missing.
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  try {
    // Delete related records first (foreign key constraints)
    await query(`DELETE FROM chat_messages`);
    await query(`DELETE FROM order_events`);
    await query(`DELETE FROM disputes`);
    await query(`DELETE FROM ratings`);
    await query(`DELETE FROM reviews`);
    await query(`DELETE FROM orders`);

    return NextResponse.json({
      success: true,
      message: 'All orders cleared from database',
    });
  } catch (error) {
    console.error('Clear orders failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to clear orders',
      
    }, { status: 500 });
  }
}

// Intentionally no GET handler. Destructive operations on a GET endpoint
// are triggerable by an attacker-supplied <img src> or link click while a
// privileged session cookie is active (CSRF). Force callers to use POST,
// which is gated by the CSRF origin/referer check in middleware.
