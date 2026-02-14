import { NextRequest, NextResponse } from 'next/server';
import { proxyCoreApi } from '@/lib/proxy/coreApi';

// Confirm or reject a proposed dispute resolution
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const { party, action, partyId } = body;

    if (!party || !action || !partyId) {
      return NextResponse.json(
        { success: false, error: 'Party, action, and partyId are required' },
        { status: 400 }
      );
    }

    if (!['user', 'merchant'].includes(party)) {
      return NextResponse.json(
        { success: false, error: 'Invalid party type' },
        { status: 400 }
      );
    }

    if (!['accept', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Action must be accept or reject' },
        { status: 400 }
      );
    }

    return proxyCoreApi(`/v1/orders/${orderId}/dispute/confirm`, {
      method: 'POST',
      body: { party, action, partyId },
    });
  } catch (error) {
    console.error('Failed to confirm resolution:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to confirm resolution', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
