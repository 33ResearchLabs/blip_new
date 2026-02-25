import { NextRequest, NextResponse } from 'next/server';
import { addManualArbiter, getArbitrationPanelMembers } from '@/lib/arbiters/repository';
import { query } from '@/lib/db';

// GET - List current panel members for a dispute's arbitration
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: disputeId } = await params;

    // Find arbitration by dispute or order ID
    const arb = await query(
      `SELECT id FROM dispute_arbitrations WHERE dispute_id = $1 OR order_id = $1 LIMIT 1`,
      [disputeId]
    );

    if (arb.length === 0) {
      return NextResponse.json({ success: false, error: 'No arbitration found' }, { status: 404 });
    }

    const arbitrationId = (arb[0] as { id: string }).id;
    const members = await getArbitrationPanelMembers(arbitrationId);

    return NextResponse.json({ success: true, data: { arbitrationId, members } });
  } catch (error) {
    console.error('[API] GET arbitration members error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Manually add a wallet to the dispute panel
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: disputeId } = await params;
    const body = await request.json();
    const { wallet_address } = body;

    if (!wallet_address || typeof wallet_address !== 'string' || wallet_address.length < 10) {
      return NextResponse.json(
        { success: false, error: 'Valid wallet_address is required' },
        { status: 400 }
      );
    }

    // Find arbitration
    const arb = await query(
      `SELECT id FROM dispute_arbitrations WHERE dispute_id = $1 OR order_id = $1 LIMIT 1`,
      [disputeId]
    );

    if (arb.length === 0) {
      return NextResponse.json({ success: false, error: 'No arbitration found' }, { status: 404 });
    }

    const arbitrationId = (arb[0] as { id: string }).id;
    const result = await addManualArbiter(arbitrationId, wallet_address.trim());

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    // Return updated panel
    const members = await getArbitrationPanelMembers(arbitrationId);
    return NextResponse.json({ success: true, data: { arbitrationId, members } });
  } catch (error) {
    console.error('[API] POST arbitration members error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
