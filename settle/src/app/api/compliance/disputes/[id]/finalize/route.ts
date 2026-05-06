import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { notifyOrderStatusUpdated } from '@/lib/pusher/server';
import { logger } from '@/lib/logger';
import { requireAuth } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { atomicFinalizeDispute, DisputeResolution } from '@/lib/orders/atomicFinalizeDispute';

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

/**
 * Finalize a dispute resolution
 *
 * This endpoint allows compliance to forcibly resolve a dispute and
 * update the order status accordingly. The actual on-chain escrow
 * release/refund must be done by the compliance team using a backend
 * wallet or a multi-sig process.
 *
 * Resolution options:
 * - 'user': Release escrow to user (order completed)
 * - 'merchant': Refund escrow to merchant (order cancelled)
 * - 'split': Partial release (requires off-chain coordination)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit dispute finalization
  const rl = await checkRateLimit(request, 'dispute:finalize', STRICT_LIMIT);
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
      complianceId,
      notes,
      release_tx_hash, // Optional: If compliance already released on-chain
      refund_tx_hash,  // Optional: If compliance already refunded on-chain
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

    // Resolve the actor for audit-log attribution.
    //
    // The hasComplianceAccess() gate above already proved the caller has
    // compliance authority — they are EITHER a compliance_team member OR
    // a merchant with has_compliance_access=true. The complianceId in the
    // body identifies which one and is what gets recorded in the audit
    // trail (resolved_by / "FINALIZED by …").
    //
    // The original implementation only looked up compliance_team and 403'd
    // when the id wasn't there, so merchants with compliance access (e.g.
    // gorav_researchl) couldn't finalize disputes even though they passed
    // the auth gate. Fall back to the merchants table for those callers.
    let complianceMember: { id: string; name: string; role: string } | null = null;

    const teamResult = await query(
      `SELECT id, name, role FROM compliance_team WHERE id = $1 AND is_active = true`,
      [complianceId]
    );
    if (teamResult.length > 0) {
      complianceMember = teamResult[0] as { id: string; name: string; role: string };
    } else {
      // Fallback: merchant acting in a compliance capacity.
      const merchantResult = await query(
        `SELECT id, display_name FROM merchants
         WHERE id = $1 AND status = 'active' AND has_compliance_access = true`,
        [complianceId]
      );
      if (merchantResult.length > 0) {
        const m = merchantResult[0] as { id: string; display_name: string };
        complianceMember = {
          id: m.id,
          name: m.display_name,
          role: 'merchant_compliance', // Distinguishes them from compliance_team in the audit log
        };
      }
    }

    if (!complianceMember) {
      return NextResponse.json(
        { success: false, error: 'Invalid compliance member' },
        { status: 403 }
      );
    }

    // Existence + escrow-detail lookup. The status check has moved INSIDE
    // the helper's transaction (re-checked under FOR UPDATE) — this read is
    // only for 404 fast-fail and to surface escrow detail in the response.
    const disputeResult = await query(
      `SELECT d.id as dispute_id, o.id as order_id, o.status as order_status,
              o.crypto_amount, o.user_id, o.merchant_id,
              o.escrow_tx_hash, o.escrow_trade_id, o.escrow_trade_pda,
              o.escrow_pda, o.escrow_creator_wallet,
              u.wallet_address as user_wallet,
              m.wallet_address as merchant_wallet
         FROM disputes d
         JOIN orders o ON d.order_id = o.id
         LEFT JOIN users u ON o.user_id = u.id
         LEFT JOIN merchants m ON o.merchant_id = m.id
        WHERE d.order_id = $1`,
      [orderId]
    );

    if (disputeResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Dispute not found' },
        { status: 404 }
      );
    }

    const dispute = disputeResult[0] as {
      order_id: string;
      order_status: string;
      crypto_amount: string;
      user_id: string;
      merchant_id: string;
      escrow_tx_hash: string | null;
      escrow_trade_id: number | null;
      escrow_trade_pda: string | null;
      escrow_pda: string | null;
      escrow_creator_wallet: string | null;
      user_wallet: string | null;
      merchant_wallet: string | null;
    };

    // ── Atomic finalization ───────────────────────────────────────────
    // Single transaction: lock order row → conditional refund to
    // escrow_debited_entity_id → status flip → dispute UPDATE →
    // order_events + notification_outbox + chat_messages. Any failure
    // ROLLBACKs the whole thing.
    const result = await atomicFinalizeDispute({
      orderId,
      resolution: resolution as DisputeResolution,
      complianceMember,
      notes,
      releaseTxHash: release_tx_hash,
      refundTxHash: refund_tx_hash,
    });

    if (!result.success || !result.order) {
      // Map error categories:
      //   400 — caller error (already-finalized dispute, retry of terminal state)
      //   404 — order itself does not exist
      //   409 — concurrent writer changed status mid-flight
      //   422 — refund target unresolvable or fails consistency check
      //         (data corruption, legacy-edge case, etc.) — needs manual review
      //   500 — anything else
      const status =
        result.error?.startsWith('Cannot finalize dispute') ? 400 :
        result.error === 'Order not found' ? 404 :
        result.error?.includes('Order status changed') ? 409 :
        (result.error?.startsWith('Cannot determine refund target')
          || result.error?.startsWith('Refund target validation failed')
          || result.error?.startsWith('Escrow-debited entity not found')) ? 422 :
        500;
      return NextResponse.json(
        { success: false, error: result.error ?? 'Failed to finalize dispute' },
        { status }
      );
    }

    // Best-effort real-time push. The notification_outbox row was already
    // written inside the transaction, so the worker republishes if this
    // call fails or the connection drops mid-flight.
    notifyOrderStatusUpdated({
      orderId,
      userId: dispute.user_id,
      merchantId: dispute.merchant_id,
      status: result.newStatus!,
      previousStatus: 'disputed',
      updatedAt: new Date().toISOString(),
      data: {
        ...result.order,
        dispute_resolution: resolution,
        resolved_by: complianceMember.name,
      },
    });

    logger.info('Dispute finalized', {
      orderId,
      resolution,
      escrowAction: result.escrowAction,
      newOrderStatus: result.newStatus,
      complianceId,
      complianceName: complianceMember.name,
      refundedTo: result.refundedTo ?? null,
    });

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        resolution,
        newStatus: result.newStatus,
        escrowAction: result.escrowAction,
        refundedTo: result.refundedTo ?? null,
        message: `Dispute finalized. Order status: ${result.newStatus}. Escrow action: ${result.escrowAction}.`,
        escrowDetails: dispute.escrow_tx_hash ? {
          escrow_tx_hash: dispute.escrow_tx_hash,
          escrow_trade_id: dispute.escrow_trade_id,
          escrow_trade_pda: dispute.escrow_trade_pda,
          escrow_pda: dispute.escrow_pda,
          escrow_creator_wallet: dispute.escrow_creator_wallet,
          user_wallet: dispute.user_wallet,
          merchant_wallet: dispute.merchant_wallet,
          crypto_amount: dispute.crypto_amount,
        } : null,
      },
    });
  } catch (error) {
    console.error('Failed to finalize dispute:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to finalize dispute' },
      { status: 500 }
    );
  }
}
