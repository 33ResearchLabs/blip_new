/**
 * GET /api/health/metrics
 *
 * Returns production metrics snapshot.
 * Use for Prometheus scraping, Grafana dashboards, or manual debugging.
 */

import { NextResponse } from 'next/server';
import { getMetricsSnapshot } from '@/lib/monitoring';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const metrics = await getMetricsSnapshot();
    return NextResponse.json(metrics);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to collect metrics' },
      { status: 500 }
    );
  }
}
