import { NextRequest, NextResponse } from 'next/server';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { requireAdminAuth } from '@/lib/middleware/auth';

export async function POST(request: NextRequest) {
  // Require admin auth for expiring orders — always enforced
  const authError = requireAdminAuth(request);
  if (authError) return authError;

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
export async function GET(request: NextRequest) {
  return POST(request);
}
