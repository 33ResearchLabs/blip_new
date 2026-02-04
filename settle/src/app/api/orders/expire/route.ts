import { NextResponse } from 'next/server';
import { expireOldOrders } from '@/lib/db/repositories/orders';

export async function POST() {
  try {
    // Use repository function for global 15-minute timeout
    const expiredCount = await expireOldOrders();

    return NextResponse.json({
      success: true,
      message: `Orders expiration check completed. Expired ${expiredCount} orders.`,
      expiredCount,
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
