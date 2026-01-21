import { NextRequest, NextResponse } from 'next/server';
import {
  selectArbitersForDispute,
  getArbitrationDetails,
  checkAndConcludeArbitration,
  initializeArbiterTables,
} from '@/lib/arbiters/repository';
import { VOTING_CONFIG } from '@/lib/arbiters/types';
import { query } from '@/lib/db';

// GET - Get arbitration details for a dispute
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;

    // Get arbitration by order ID
    const arbitration = await query(
      `SELECT * FROM dispute_arbitrations WHERE order_id = $1`,
      [orderId]
    );

    if (arbitration.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          hasArbitration: false,
          message: 'No arbitration started for this dispute',
        },
      });
    }

    const arbRecord = arbitration[0] as { id: string };
    const details = await getArbitrationDetails(arbRecord.id);

    if (!details) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch arbitration details' },
        { status: 500 }
      );
    }

    // Don't expose individual votes until concluded (for fairness)
    const votes = details.arbitration.status === 'concluded'
      ? details.votes
      : details.votes.map(v => ({
          ...v,
          vote: v.voted_at ? 'submitted' : null,
          reasoning: v.voted_at ? '[Hidden until concluded]' : null,
        }));

    return NextResponse.json({
      success: true,
      data: {
        hasArbitration: true,
        arbitration: details.arbitration,
        votes,
        config: VOTING_CONFIG,
      },
    });
  } catch (error) {
    console.error('Get arbitration error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch arbitration' },
      { status: 500 }
    );
  }
}

// POST - Start arbitration for a dispute
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;

    // Initialize tables
    await initializeArbiterTables();

    // Check if dispute exists and is in correct status
    const dispute = await query(
      `SELECT d.*, o.user_id, o.merchant_id
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       WHERE d.order_id = $1`,
      [orderId]
    );

    if (dispute.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dispute not found' },
        { status: 404 }
      );
    }

    const disputeData = dispute[0] as {
      status: string;
      user_id: string;
      merchant_id: string;
    };

    // Check if arbitration already exists
    const existing = await query(
      `SELECT id FROM dispute_arbitrations WHERE order_id = $1`,
      [orderId]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Arbitration already started for this dispute' },
        { status: 400 }
      );
    }

    // Get dispute ID
    const disputeRecord = await query(
      `SELECT id FROM disputes WHERE order_id = $1`,
      [orderId]
    );

    if (disputeRecord.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dispute record not found' },
        { status: 404 }
      );
    }

    const dispRecord = disputeRecord[0] as { id: string };

    // Select arbiters (exclude the parties involved)
    const excludeUserIds = [disputeData.user_id, disputeData.merchant_id];

    try {
      const { arbitration, selectedArbiters } = await selectArbitersForDispute(
        dispRecord.id,
        orderId,
        excludeUserIds
      );

      return NextResponse.json({
        success: true,
        data: {
          arbitration,
          arbitersAssigned: selectedArbiters.length,
          votingDeadline: arbitration.voting_deadline,
          config: VOTING_CONFIG,
        },
        message: `Arbitration started with ${selectedArbiters.length} arbiters`,
      });
    } catch (selectionError) {
      return NextResponse.json(
        {
          success: false,
          error: selectionError instanceof Error ? selectionError.message : 'Failed to select arbiters',
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Start arbitration error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to start arbitration' },
      { status: 500 }
    );
  }
}

// PATCH - Check and conclude arbitration (can be called to force check)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params;

    const arbitration = await query(
      `SELECT id, status FROM dispute_arbitrations WHERE order_id = $1`,
      [orderId]
    );

    if (arbitration.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Arbitration not found' },
        { status: 404 }
      );
    }

    const arbData = arbitration[0] as { id: string; status: string };

    if (arbData.status !== 'voting') {
      return NextResponse.json({
        success: true,
        data: {
          status: arbData.status,
          message: 'Arbitration is not in voting phase',
        },
      });
    }

    await checkAndConcludeArbitration(arbData.id);

    // Get updated status
    const updated = await query(
      `SELECT * FROM dispute_arbitrations WHERE id = $1`,
      [arbData.id]
    );

    return NextResponse.json({
      success: true,
      data: updated[0],
    });
  } catch (error) {
    console.error('Check arbitration error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check arbitration' },
      { status: 500 }
    );
  }
}
