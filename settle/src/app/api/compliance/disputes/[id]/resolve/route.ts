import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, transaction } from '@/lib/db';
import { requireAuth } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { auditLog } from '@/lib/auditLog';
import { logger } from '@/lib/logger';

async function hasComplianceAccess(auth: { actorType: string; merchantId?: string }): Promise<boolean> {
  if (auth.actorType === 'compliance' || auth.actorType === 'system') return true;
  if (auth.actorType === 'merchant' && auth.merchantId) {
    const m = await queryOne<{ has_compliance_access: boolean }>(
      `SELECT has_compliance_access FROM merchants WHERE id = $1 AND status = 'active'`,
      [auth.merchantId]
    );
    return !!m?.has_compliance_access;
  }
  return false;
}

// Propose a resolution (requires 2 confirmations from user and merchant)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit dispute resolutions
  const rl = await checkRateLimit(request, 'dispute:resolve', STRICT_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  if (!(await hasComplianceAccess(auth))) {
    return NextResponse.json(
      { success: false, error: 'Compliance authentication required' },
      { status: 403 }
    );
  }

  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const {
      resolution, // 'user' | 'merchant' | 'split'
      notes,
      complianceId,
      splitPercentage, // Optional: { user: 50, merchant: 50 }
    } = body;

    if (!resolution || !complianceId) {
      return NextResponse.json(
        { success: false, error: 'Resolution and complianceId are required' },
        { status: 400 }
      );
    }

    if (!['user', 'merchant', 'split'].includes(resolution)) {
      return NextResponse.json(
        { success: false, error: 'Invalid resolution type' },
        { status: 400 }
      );
    }

    // Get the dispute. The `[id]` route param is historically the order id,
    // but some callers pass the dispute id (rows from GET /api/compliance/disputes
    // expose both `id` (order id) AND `dispute.id`). Match either to avoid 404s.
    const disputeResult = await query(
      `SELECT d.*, o.id AS order_id, o.crypto_amount, o.user_id, o.merchant_id
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       WHERE d.order_id = $1 OR d.id = $1`,
      [orderId]
    );

    if (disputeResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dispute not found' },
        { status: 404 }
      );
    }

    const dispute = disputeResult[0] as {
      status: string;
      user_id: string;
      merchant_id: string;
      order_id: string;
    };
    // Normalize: from here on, always use the real order id from the row
    // (not whatever was in the URL).
    const realOrderId = dispute.order_id;

    if (dispute.status === 'resolved') {
      return NextResponse.json(
        { success: false, error: 'Dispute already resolved' },
        { status: 400 }
      );
    }

    // Prevent overwriting an existing proposed resolution (idempotency guard)
    if (dispute.status === 'investigating') {
      return NextResponse.json(
        { success: false, error: 'Resolution already proposed — awaiting confirmation from parties' },
        { status: 409 }
      );
    }

    // Atomic propose: dispute UPDATE + chat INSERT must commit or roll back
    // together. Without the wrapping transaction(), a failure between the two
    // (pool error, statement timeout) would leave a "proposed" dispute row
    // with no chat message — or the catch-fallback could double-write.
    //
    // The enum-cast fallback (some envs lack the dispute_status value) is
    // preserved via SAVEPOINT: if the cast attempt fails, we ROLLBACK only
    // the savepoint and re-issue without the cast — the chat INSERT below
    // still runs in the same outer transaction.
    await transaction(async (client) => {
      const updateParams = [
        resolution,
        complianceId,
        notes || '',
        splitPercentage ? JSON.stringify(splitPercentage) : null,
        realOrderId,
      ];

      await client.query('SAVEPOINT propose_status_cast');
      try {
        await client.query(
          `UPDATE disputes
             SET status = 'investigating'::dispute_status,
                 proposed_resolution = $1,
                 proposed_by = $2,
                 proposed_at = NOW(),
                 resolution_notes = $3,
                 split_percentage = $4,
                 user_confirmed = false,
                 merchant_confirmed = false
           WHERE order_id = $5`,
          updateParams
        );
        await client.query('RELEASE SAVEPOINT propose_status_cast');
      } catch (updateErr) {
        logger.warn('[Dispute] propose: enum cast UPDATE failed, retrying without cast', {
          orderId: realOrderId,
          error: (updateErr as Error)?.message,
        });
        await client.query('ROLLBACK TO SAVEPOINT propose_status_cast');
        await client.query('RELEASE SAVEPOINT propose_status_cast');
        await client.query(
          `UPDATE disputes
             SET proposed_resolution = $1,
                 proposed_by = $2,
                 proposed_at = NOW(),
                 resolution_notes = $3,
                 split_percentage = $4,
                 user_confirmed = false,
                 merchant_confirmed = false
           WHERE order_id = $5`,
          updateParams
        );
      }

      await client.query(
        `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, created_at)
         VALUES ($1, 'system'::actor_type, $2, $3, 'system'::message_type, NOW())`,
        [
          realOrderId,
          complianceId,
          JSON.stringify({
            resolution,
            notes,
            splitPercentage,
            type: 'resolution_proposed',
          }),
        ]
      );
    });

    auditLog('compliance.dispute_resolved', complianceId, auth.actorType, realOrderId, {
      resolution,
      notes,
      splitPercentage,
    });

    return NextResponse.json({
      success: true,
      data: {
        orderId: realOrderId,
        proposedResolution: resolution,
        status: 'pending_confirmation',
        message: 'Resolution proposed. Waiting for both parties to confirm.',
      },
    });
  } catch (error) {
    console.error('Failed to propose resolution:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to propose resolution' },
      { status: 500 }
    );
  }
}

// Update dispute status (e.g., start investigating)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const patchAuth = await requireAuth(request);
  if (patchAuth instanceof NextResponse) return patchAuth;
  if (!(await hasComplianceAccess(patchAuth))) {
    return NextResponse.json(
      { success: false, error: 'Compliance authentication required' },
      { status: 403 }
    );
  }

  try {
    const { id: orderId } = await params;
    const body = await request.json();
    const { status, complianceId, notes } = body;

    if (!status || !complianceId) {
      return NextResponse.json(
        { success: false, error: 'Status and complianceId are required' },
        { status: 400 }
      );
    }

    if (!['investigating', 'pending_evidence', 'escalated'].includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid status' },
        { status: 400 }
      );
    }

    // Resolve assigned_to: the FK references compliance_team(id).
    // For merchants with compliance access, find their compliance_team entry.
    // If none exists, skip assigned_to (nullable) rather than failing.
    const complianceRow = await queryOne<{ id: string }>(
      `SELECT id FROM compliance_team
       WHERE id = $1
          OR wallet_address = (SELECT wallet_address FROM merchants WHERE id = $1 LIMIT 1)
       LIMIT 1`,
      [complianceId]
    );

    // The compliance dashboard surfaces orders that are status='disputed'
    // even when no `disputes` row exists yet (the GET uses LEFT JOIN). The URL
    // param can therefore be an order id OR a dispute id, AND the dispute row
    // may need to be created on the fly when an officer hits "Investigate".
    //
    // 1) Resolve to a real order id from whichever shape we got.
    const orderRow = await queryOne<{ id: string }>(
      `SELECT o.id
         FROM orders o
         LEFT JOIN disputes d ON d.order_id = o.id
        WHERE o.id = $1 OR d.id = $1
        LIMIT 1`,
      [orderId]
    );

    if (!orderRow) {
      return NextResponse.json(
        { success: false, error: 'Order not found' },
        { status: 404 }
      );
    }
    const realOrderId = orderRow.id;

    // 2) Try to update an existing dispute row; if none exists yet, create one.
    let result = await query(
      `UPDATE disputes
       SET status = 'investigating'::dispute_status,
           assigned_to = $1,
           resolution_notes = COALESCE(resolution_notes || E'\n', '') || $2
       WHERE order_id = $3
       RETURNING *`,
      [complianceRow?.id || null, notes ? `[${new Date().toISOString()}] ${notes}` : '', realOrderId]
    );

    if (result.length === 0) {
      // No dispute row yet — create it in the investigating state. Mirrors
      // the columns used by the existing INSERT sites in the orders repo.
      result = await query(
        `INSERT INTO disputes (order_id, raised_by, raiser_id, reason, description, status, assigned_to, resolution_notes, created_at)
         VALUES ($1, 'compliance'::actor_type, $2, 'other'::dispute_reason, 'Auto-created on investigation start', 'investigating'::dispute_status, $3, $4, NOW())
         RETURNING *`,
        [
          realOrderId,
          complianceId,
          complianceRow?.id || null,
          notes ? `[${new Date().toISOString()}] ${notes}` : '',
        ]
      );
    }

    auditLog('compliance.dispute_status_changed', complianceId, patchAuth.actorType, realOrderId, {
      newStatus: status,
      notes,
    });

    return NextResponse.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    console.error('Failed to update dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update dispute' },
      { status: 500 }
    );
  }
}
