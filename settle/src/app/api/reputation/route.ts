/**
 * Reputation API
 *
 * GET /api/reputation?entityId=X&entityType=user|merchant
 * - Get reputation score and breakdown
 *
 * GET /api/reputation?action=leaderboard&entityType=user|merchant&limit=100
 * - Get reputation leaderboard
 *
 * POST /api/reputation
 * - Recalculate reputation for an entity
 *
 * PUT /api/reputation
 * - Initialize reputation tables
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getReputationScore,
  getReputationWithBreakdown,
  updateReputationScore,
  getReputationLeaderboard,
  getEntityRank,
  getReputationHistory,
  getReputationEvents,
  initializeReputationTables,
  recalculateAllScores,
  EntityType,
} from '@/lib/reputation';
import { getProgressToNextTier, TIER_INFO, BADGE_INFO } from '@/lib/reputation/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const entityId = searchParams.get('entityId');
    const entityType = searchParams.get('entityType') as EntityType | null;

    // Leaderboard action
    if (action === 'leaderboard') {
      if (!entityType || !['user', 'merchant'].includes(entityType)) {
        return NextResponse.json(
          { success: false, error: 'entityType is required (user or merchant)' },
          { status: 400 }
        );
      }

      const limit = parseInt(searchParams.get('limit') || '100');
      const leaderboard = await getReputationLeaderboard(entityType, limit);

      return NextResponse.json({
        success: true,
        data: {
          leaderboard: leaderboard.map((entry) => ({
            ...entry,
            tierInfo: TIER_INFO[entry.tier],
            badgeInfo: entry.badges.map((b) => BADGE_INFO[b as keyof typeof BADGE_INFO]),
          })),
        },
      });
    }

    // History action
    if (action === 'history') {
      if (!entityId || !entityType) {
        return NextResponse.json(
          { success: false, error: 'entityId and entityType are required' },
          { status: 400 }
        );
      }

      const days = parseInt(searchParams.get('days') || '30');
      const history = await getReputationHistory(entityId, entityType, days);

      return NextResponse.json({
        success: true,
        data: { history },
      });
    }

    // Events action
    if (action === 'events') {
      if (!entityId || !entityType) {
        return NextResponse.json(
          { success: false, error: 'entityId and entityType are required' },
          { status: 400 }
        );
      }

      const limit = parseInt(searchParams.get('limit') || '20');
      const events = await getReputationEvents(entityId, entityType, limit);

      return NextResponse.json({
        success: true,
        data: { events },
      });
    }

    // Default: Get reputation score
    if (!entityId || !entityType) {
      return NextResponse.json(
        { success: false, error: 'entityId and entityType are required' },
        { status: 400 }
      );
    }

    if (!['user', 'merchant'].includes(entityType)) {
      return NextResponse.json(
        { success: false, error: 'entityType must be "user" or "merchant"' },
        { status: 400 }
      );
    }

    // Get full breakdown
    const result = await getReputationWithBreakdown(entityId, entityType);

    if (!result) {
      // Try to calculate fresh
      const score = await updateReputationScore(entityId, entityType);
      if (!score) {
        return NextResponse.json(
          { success: false, error: 'Entity not found' },
          { status: 404 }
        );
      }

      const freshResult = await getReputationWithBreakdown(entityId, entityType);
      if (!freshResult) {
        return NextResponse.json({
          success: true,
          data: {
            score,
            breakdown: null,
            progress: getProgressToNextTier(score.total_score),
            tierInfo: TIER_INFO[score.tier],
            badgeInfo: score.badges.map((b) => BADGE_INFO[b as keyof typeof BADGE_INFO]),
          },
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          ...freshResult,
          progress: getProgressToNextTier(freshResult.score.total_score),
          tierInfo: TIER_INFO[freshResult.score.tier],
          badgeInfo: freshResult.score.badges.map((b) => BADGE_INFO[b as keyof typeof BADGE_INFO]),
          rank: await getEntityRank(entityId, entityType),
        },
      });
    }

    // Get rank
    const rank = await getEntityRank(entityId, entityType);

    return NextResponse.json({
      success: true,
      data: {
        ...result,
        progress: getProgressToNextTier(result.score.total_score),
        tierInfo: TIER_INFO[result.score.tier],
        badgeInfo: result.score.badges.map((b) => BADGE_INFO[b as keyof typeof BADGE_INFO]),
        rank,
      },
    });
  } catch (error) {
    console.error('Reputation GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch reputation' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { entityId, entityType, action } = body;

    // Recalculate all scores
    if (action === 'recalculate_all') {
      const result = await recalculateAllScores();
      return NextResponse.json({
        success: true,
        data: {
          message: 'Recalculated all reputation scores',
          users: result.users,
          merchants: result.merchants,
        },
      });
    }

    // Recalculate single entity
    if (!entityId || !entityType) {
      return NextResponse.json(
        { success: false, error: 'entityId and entityType are required' },
        { status: 400 }
      );
    }

    if (!['user', 'merchant'].includes(entityType)) {
      return NextResponse.json(
        { success: false, error: 'entityType must be "user" or "merchant"' },
        { status: 400 }
      );
    }

    const score = await updateReputationScore(entityId, entityType);

    if (!score) {
      return NextResponse.json(
        { success: false, error: 'Entity not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        score,
        progress: getProgressToNextTier(score.total_score),
        tierInfo: TIER_INFO[score.tier],
        badgeInfo: score.badges.map((b) => BADGE_INFO[b as keyof typeof BADGE_INFO]),
      },
    });
  } catch (error) {
    console.error('Reputation POST error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update reputation' },
      { status: 500 }
    );
  }
}

export async function PUT() {
  try {
    await initializeReputationTables();
    return NextResponse.json({
      success: true,
      data: { message: 'Reputation tables initialized' },
    });
  } catch (error) {
    console.error('Reputation PUT error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initialize reputation tables' },
      { status: 500 }
    );
  }
}
