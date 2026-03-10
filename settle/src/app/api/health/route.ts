import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export async function GET() {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const dbLatencyMs = Date.now() - start;

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: { connected: true, latencyMs: dbLatencyMs },
    });
  } catch {
    return NextResponse.json(
      {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        db: { connected: false },
      },
      { status: 503 }
    );
  }
}
