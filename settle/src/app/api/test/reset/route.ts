/**
 * Test Reset Endpoint
 *
 * Truncates all data from the database while preserving schema.
 * Only available in development mode for safety.
 *
 * Usage:
 *   POST /api/test/reset
 *   Body: { "confirm": true }
 */

import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
  // Guard: Only allow in non-production environments (or test harness)
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_ENDPOINTS !== '1') {
    return NextResponse.json(
      {
        success: false,
        error: 'Reset endpoint is disabled in production for safety',
      },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();

    // Require explicit confirmation to prevent accidental resets
    if (!body.confirm) {
      return NextResponse.json(
        {
          success: false,
          error: 'Must set confirm:true to reset database',
        },
        { status: 400 }
      );
    }

    // Read and execute the existing truncate_all.sql script
    const sqlPath = path.join(process.cwd(), 'database', 'truncate_all.sql');

    if (!fs.existsSync(sqlPath)) {
      return NextResponse.json(
        {
          success: false,
          error: `SQL file not found: ${sqlPath}`,
        },
        { status: 500 }
      );
    }

    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Execute the SQL (handles all cascades and dependencies)
    await query(sql);

    return NextResponse.json({
      success: true,
      message: 'Database reset complete',
      tables_cleared: [
        'reviews',
        'chat_messages',
        'order_events',
        'user_bank_accounts',
        'disputes',
        'orders',
        'merchant_offers',
        'merchant_contacts',
        'direct_messages',
        'merchants',
        'users',
        'compliance_team',
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Database reset failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Only allow POST method
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'Use POST method with { confirm: true } to reset database',
    },
    { status: 405 }
  );
}
