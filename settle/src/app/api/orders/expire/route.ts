import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST() {
  try {
    // Call the auto_expire_orders function
    await query('SELECT auto_expire_orders()');

    return NextResponse.json({
      success: true,
      message: 'Orders expiration check completed',
    });
  } catch (error) {
    console.error('Error expiring orders:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to expire orders',
      },
      { status: 500 }
    );
  }
}

// Also allow GET for cron jobs
export async function GET() {
  return POST();
}
