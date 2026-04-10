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

  // Require admin auth even in dev (unless ADMIN_SECRET not set)
  if (process.env.ADMIN_SECRET) {
    const authError = requireAdminAuth(request);
    if (authError) return authError;
  }

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

// Also support GET for easy browser access
export async function GET(request: NextRequest) {
  return POST(request);
}
