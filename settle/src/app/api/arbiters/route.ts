import { NextRequest, NextResponse } from 'next/server';
import {
  initializeArbiterTables,
  getOrCreateArbiter,
  getArbiterLeaderboard,
  getEligibleArbiters,
} from '@/lib/arbiters/repository';
import { checkArbiterEligibility, ARBITER_REQUIREMENTS } from '@/lib/arbiters/types';
import { query } from '@/lib/db';

// GET - Get arbiter info or leaderboard
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const userId = searchParams.get('user_id');

    // Initialize tables if needed
    await initializeArbiterTables();

    if (action === 'leaderboard') {
      const limit = parseInt(searchParams.get('limit') || '20');
      const leaderboard = await getArbiterLeaderboard(limit);

      return NextResponse.json({
        success: true,
        data: leaderboard,
      });
    }

    if (action === 'eligible') {
      const eligible = await getEligibleArbiters([], 50);

      return NextResponse.json({
        success: true,
        data: {
          count: eligible.length,
          arbiters: eligible,
        },
      });
    }

    if (action === 'check_eligibility' && userId) {
      // Check if user is eligible to become arbiter
      const userStats = await query(
        `SELECT id, total_trades, rating, created_at, reputation_score
         FROM users WHERE id = $1`,
        [userId]
      );

      if (userStats.length === 0) {
        return NextResponse.json(
          { success: false, error: 'User not found' },
          { status: 404 }
        );
      }

      const user = userStats[0] as {
        total_trades: number;
        rating: number;
        created_at: Date;
        reputation_score: number;
      };

      const eligibility = checkArbiterEligibility(user);

      return NextResponse.json({
        success: true,
        data: {
          ...eligibility,
          requirements: ARBITER_REQUIREMENTS,
          currentStats: {
            trades: user.total_trades,
            rating: user.rating,
            accountAge: Math.floor(
              (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24)
            ),
            reputation: user.reputation_score || 0,
          },
        },
      });
    }

    if (userId) {
      // Get specific arbiter
      const arbiter = await query(
        `SELECT * FROM arbiters WHERE user_id = $1`,
        [userId]
      );

      if (arbiter.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Arbiter not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: arbiter[0],
      });
    }

    // Return requirements info
    return NextResponse.json({
      success: true,
      data: {
        requirements: ARBITER_REQUIREMENTS,
        message: 'Use ?action=leaderboard, ?action=eligible, or ?user_id=xxx',
      },
    });
  } catch (error) {
    console.error('Arbiter GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch arbiter data' },
      { status: 500 }
    );
  }
}

// POST - Register as arbiter
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, wallet_address } = body;

    if (!user_id || !wallet_address) {
      return NextResponse.json(
        { success: false, error: 'user_id and wallet_address are required' },
        { status: 400 }
      );
    }

    // Initialize tables
    await initializeArbiterTables();

    // Check eligibility first
    const userStats = await query(
      `SELECT id, total_trades, rating, created_at, reputation_score
       FROM users WHERE id = $1`,
      [user_id]
    );

    if (userStats.length === 0) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const user = userStats[0] as {
      total_trades: number;
      rating: number;
      created_at: Date;
      reputation_score: number;
    };

    const eligibility = checkArbiterEligibility(user);

    if (!eligibility.eligible) {
      return NextResponse.json({
        success: false,
        error: 'Not eligible to become arbiter',
        reasons: eligibility.reasons,
        requirements: ARBITER_REQUIREMENTS,
      }, { status: 400 });
    }

    // Create or get arbiter
    const arbiter = await getOrCreateArbiter(user_id, wallet_address);

    if (!arbiter) {
      return NextResponse.json(
        { success: false, error: 'Failed to create arbiter profile' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: arbiter,
      message: 'Successfully registered as arbiter',
    });
  } catch (error) {
    console.error('Arbiter POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to register as arbiter' },
      { status: 500 }
    );
  }
}

// PUT - Initialize arbiter system (admin)
export async function PUT() {
  try {
    await initializeArbiterTables();

    return NextResponse.json({
      success: true,
      message: 'Arbiter tables initialized',
    });
  } catch (error) {
    console.error('Arbiter system init error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initialize arbiter system' },
      { status: 500 }
    );
  }
}
