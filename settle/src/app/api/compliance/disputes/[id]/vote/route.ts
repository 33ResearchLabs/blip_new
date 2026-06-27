/**
 * POST /api/compliance/disputes/[id]/vote   { outcome, complianceId }
 * GET  /api/compliance/disputes/[id]/vote   -> current tally
 *
 * A compliance officer votes on a dispute outcome ('user' | 'merchant' | 'split').
 * When a strict majority (>50%) of active officers vote the same outcome within
 * the 4h window, the resolution can be finalized. (A single officer can instead
 * "force" it via the finalize endpoint with force=true.)
 */
import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requireAuth } from '@/lib/middleware/auth';
import { castVote, getVoteTally, DisputeOutcome } from '@/lib/compliance/voting';

async function hasComplianceAccess(auth: { actorType: string; merchantId?: string }): Promise<boolean> {
  if (auth.actorType === 'compliance' || auth.actorType === 'system') return true;
  if (auth.actorType === 'merchant' && auth.merchantId) {
    const m = await queryOne<{ has_compliance_access: boolean }>(
      `SELECT has_compliance_access FROM merchants WHERE id = $1 AND status = 'active'`,
      [auth.merchantId],
    );
    return !!m?.has_compliance_access;
  }
  return false;
}

async function tallyFor(orderId: string) {
  const o = await queryOne<{ disputed_at: Date | null }>(
    `SELECT disputed_at FROM orders WHERE id = $1`,
    [orderId],
  );
  return getVoteTally(orderId, o?.disputed_at ?? null);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!(await hasComplianceAccess(auth))) {
    return NextResponse.json({ success: false, error: 'Compliance authentication required' }, { status: 403 });
  }
  const { id: orderId } = await params;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 }); }
  const { outcome, complianceId } = body ?? {};
  if (!['user', 'merchant', 'split'].includes(outcome)) {
    return NextResponse.json({ success: false, error: "outcome must be 'user' | 'merchant' | 'split'" }, { status: 400 });
  }
  if (!complianceId) {
    return NextResponse.json({ success: false, error: 'complianceId is required' }, { status: 400 });
  }
  await castVote(orderId, complianceId, outcome as DisputeOutcome);
  return NextResponse.json({ success: true, data: await tallyFor(orderId) });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!(await hasComplianceAccess(auth))) {
    return NextResponse.json({ success: false, error: 'Compliance authentication required' }, { status: 403 });
  }
  const { id: orderId } = await params;
  return NextResponse.json({ success: true, data: await tallyFor(orderId) });
}
