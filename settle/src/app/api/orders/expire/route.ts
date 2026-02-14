import { NextResponse } from 'next/server';
import { proxyCoreApi } from '@/lib/proxy/coreApi';

export async function POST() {
  try {
    return proxyCoreApi('/v1/orders/expire', { method: 'POST' });
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
