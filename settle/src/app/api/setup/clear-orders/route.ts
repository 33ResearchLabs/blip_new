import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Clear all orders from the database (development only)
export async function POST() {
  // Block in production - this is a destructive endpoint
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'This endpoint is disabled in production' },
      { status: 403 }
    );
  }

  try {
    // Delete related records first (foreign key constraints)
    await query(`DELETE FROM chat_messages`);
    await query(`DELETE FROM order_events`);
    await query(`DELETE FROM disputes`);
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
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

// Also support GET for easy browser access
export async function GET() {
  return POST();
}
