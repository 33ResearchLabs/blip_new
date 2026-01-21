import { NextRequest, NextResponse } from 'next/server';
import {
  getArbiterPendingVotes,
  submitArbiterVote,
} from '@/lib/arbiters/repository';
import { query } from '@/lib/db';

// GET - Get arbiter's pending votes
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: arbiterId } = await params;

    // Get pending votes
    const pendingVotes = await getArbiterPendingVotes(arbiterId);

    // Get vote history
    const voteHistory = await query(
      `SELECT av.*, da.order_id, da.final_decision, da.status as arbitration_status
       FROM arbiter_votes av
       JOIN dispute_arbitrations da ON av.arbitration_id = da.id
       WHERE av.arbiter_id = $1
       ORDER BY av.assigned_at DESC
       LIMIT 50`,
      [arbiterId]
    );

    return NextResponse.json({
      success: true,
      data: {
        pending: pendingVotes,
        history: voteHistory,
      },
    });
  } catch (error) {
    console.error('Get arbiter votes error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch votes' },
      { status: 500 }
    );
  }
}

// POST - Submit a vote
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: arbiterId } = await params;
    const body = await request.json();
    const { arbitration_id, vote, reasoning } = body;

    if (!arbitration_id || !vote || !reasoning) {
      return NextResponse.json(
        { success: false, error: 'arbitration_id, vote, and reasoning are required' },
        { status: 400 }
      );
    }

    if (!['user', 'merchant', 'split'].includes(vote)) {
      return NextResponse.json(
        { success: false, error: 'vote must be user, merchant, or split' },
        { status: 400 }
      );
    }

    const result = await submitArbiterVote(arbitration_id, arbiterId, vote, reasoning);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Vote submitted successfully',
    });
  } catch (error) {
    console.error('Submit vote error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to submit vote' },
      { status: 500 }
    );
  }
}
