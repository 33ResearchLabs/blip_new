/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ATOMIC DISPUTE FINALIZATION — Issue C2 + C3
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Compliance dispute finalization MUST be atomic and refund to the correct
 * entity. Before this helper, the route fired four separate top-level
 * statements (UPDATE disputes, UPDATE orders timestamps, updateOrderStatus —
 * which itself opened a transaction — and INSERT chat_messages). A failure
 * between any pair could leave the dispute marked resolved while the order
 * remained 'disputed', or vice versa.
 *
 * This function wraps the entire finalization in a single transaction:
 *
 *   1. SELECT … FOR UPDATE on the order row (and on the refund-target
 *      balance row, when a refund is being applied)
 *   2. For 'merchant' resolution (seller wins): credit
 *      escrow_debited_entity_id (NEVER merchant_id-by-default — the entity
 *      that actually paid is recorded in escrow_debited_entity_id at lock
 *      time and that's the only safe source of truth) and write a ledger
 *      entry. ON CONFLICT keeps it idempotent on retry.
 *   3. UPDATE orders (status guarded by order_version + status)
 *   4. UPDATE disputes (status='resolved', resolved_by, notes)
 *   5. INSERT order_events, notification_outbox, chat_messages
 *
 * If any step throws, the surrounding transaction() helper at
 * src/lib/db/index.ts ROLLBACKs everything and logs the failure to the
 * db.transaction_failed error_logs channel.
 *
 * The 'user' resolution (buyer wins → release) intentionally does NOT
 * mutate balances — release is performed on-chain by compliance using the
 * release_tx_hash provided in the request. We only flip status atomically.
 *
 * Companion to atomicCancelWithRefund (used by payment-deadline-worker for
 * the 24h auto-resolve path). Both helpers share the same locking and
 * post-invariant patterns; do not let them drift.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { transaction } from '@/lib/db';
import { Order } from '@/lib/types/database';
import { logger } from '@/lib/logger';
import { validateTransition } from './stateMachineMinimal';
import {
  resolveRefundTarget,
  validateRefundTarget,
  logLegacyRefundDerivation,
  logRefundTargetMismatch,
} from './escrowRefundTarget';

export type DisputeResolution = 'user' | 'merchant' | 'split';

export interface ComplianceMemberRef {
  id: string;
  name: string;
  role: string;
}

export interface AtomicFinalizeDisputeInput {
  orderId: string;
  resolution: DisputeResolution;
  complianceMember: ComplianceMemberRef;
  notes?: string;
  /** Optional on-chain hashes if compliance already settled outside the system. */
  releaseTxHash?: string;
  refundTxHash?: string;
}

export interface AtomicFinalizeDisputeResult {
  success: boolean;
  order?: Order;
  newStatus?: 'completed' | 'cancelled';
  escrowAction?: 'release' | 'refund';
  refundedTo?: { entityId: string; entityType: 'user' | 'merchant'; amount: number };
  error?: string;
}

/**
 * Resolution → terminal order status mapping.
 *   'user'     buyer wins  → completed (escrow released to buyer, on-chain)
 *   'merchant' seller wins → cancelled (escrow refunded to seller, in-system)
 *   'split'    partial     → completed (off-chain coordination by compliance)
 */
function statusForResolution(resolution: DisputeResolution): 'completed' | 'cancelled' {
  return resolution === 'merchant' ? 'cancelled' : 'completed';
}

function escrowActionForResolution(resolution: DisputeResolution): 'release' | 'refund' {
  return resolution === 'merchant' ? 'refund' : 'release';
}

export async function atomicFinalizeDispute(
  input: AtomicFinalizeDisputeInput
): Promise<AtomicFinalizeDisputeResult> {
  const { orderId, resolution, complianceMember, notes, releaseTxHash, refundTxHash } = input;
  const newStatus = statusForResolution(resolution);
  const escrowAction = escrowActionForResolution(resolution);

  try {
    const result = await transaction(async (client) => {
      // ── 1. Lock the order row and re-validate ─────────────────────────
      const lockRes = await client.query(
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      if (lockRes.rows.length === 0) {
        throw new Error('ORDER_NOT_FOUND');
      }
      const order = lockRes.rows[0];

      if (order.status !== 'disputed') {
        // Idempotency-friendly error — the same finalize hitting a
        // terminal order is a no-op-with-error rather than a partial mess.
        throw new Error(`ORDER_NOT_DISPUTED:${order.status}`);
      }

      const transitionCheck = validateTransition(order.status, newStatus, 'system');
      if (!transitionCheck.valid) {
        throw new Error('STATUS_TRANSITION_INVALID');
      }

      // ── 2. Refund branch: credit escrow_debited_entity_id ────────────
      // Resolution + validation is a pure-function pre-flight (no DB writes
      // until everything is verified). Both run BEFORE any balance UPDATE
      // so a corrupted target cannot accidentally credit the wrong entity.
      let refundedTo: AtomicFinalizeDisputeResult['refundedTo'] | undefined;

      if (resolution === 'merchant') {
        const resolved = resolveRefundTarget(order);

        if (resolved.kind === 'no_escrow') {
          // Disputed order that never locked escrow — nothing to refund in
          // system. Status flip still proceeds inside this transaction.
          logger.warn('[Atomic] Dispute finalize:refund — order has no escrow to refund', {
            orderId,
          });
        } else if (resolved.kind === 'indeterminate') {
          // Refusing the refund is the safer failure: a misdirected refund
          // is unrecoverable, while a 422 to compliance is a 5-minute
          // manual review.
          logger.error('[security] Dispute finalize:refund — target indeterminate; REFUSING refund', {
            orderId,
            reason: resolved.reason,
            order_type: order.type,
            escrow_debited_entity_id: order.escrow_debited_entity_id,
          });
          throw new Error(`REFUND_TARGET_INDETERMINATE:${resolved.reason}`);
        } else {
          // 'recorded' or 'legacy_derived' — both go through the same
          // validation gate before touching balance.
          const validation = validateRefundTarget(order, {
            entityId: resolved.entityId,
            entityType: resolved.entityType,
          });
          if (!validation.ok) {
            logRefundTargetMismatch(orderId, resolved, order, validation.reason ?? 'unspecified');
            throw new Error(`REFUND_TARGET_MISMATCH:${validation.reason ?? 'unspecified'}`);
          }

          if (resolved.kind === 'legacy_derived') {
            logLegacyRefundDerivation(orderId, resolved);
          }

          const refundTable = resolved.entityType === 'merchant' ? 'merchants' : 'users';

          const balRes = await client.query(
            `SELECT balance FROM ${refundTable} WHERE id = $1 FOR UPDATE`,
            [resolved.entityId]
          );
          if (balRes.rows.length === 0) {
            throw new Error('REFUND_TARGET_NOT_FOUND');
          }
          const balanceBefore = parseFloat(String(balRes.rows[0].balance));

          await client.query(
            `UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`,
            [resolved.amount, resolved.entityId]
          );

          // Post-invariant: balance moved by exactly the refund amount.
          // Any drift (concurrent writer slipped past FOR UPDATE, missing
          // index, trigger side-effect) throws and triggers ROLLBACK.
          const verifyRes = await client.query(
            `SELECT balance FROM ${refundTable} WHERE id = $1`,
            [resolved.entityId]
          );
          const balanceAfter = parseFloat(String(verifyRes.rows[0].balance));
          const expected = balanceBefore + resolved.amount;
          if (Math.abs(balanceAfter - expected) > 0.00000001) {
            throw new Error(
              `BALANCE_MISMATCH: ${balanceAfter} != ${expected} (refund=${resolved.amount})`
            );
          }

          // Idempotent ledger entry — duplicate finalization (e.g. retry
          // after a network blip on the response) won't double-credit.
          await client.query(
            `INSERT INTO ledger_entries
               (account_type, account_id, entry_type, amount, asset,
                related_order_id, description, metadata,
                balance_before, balance_after)
             VALUES ($1, $2, 'ESCROW_REFUND', $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (related_order_id, entry_type, account_id)
               WHERE related_order_id IS NOT NULL
                 AND entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND', 'FEE')
             DO NOTHING`,
            [
              resolved.entityType,
              resolved.entityId,
              resolved.amount,
              order.crypto_currency || 'USDT',
              orderId,
              `Escrow refunded by compliance for dispute on order #${order.order_number}`,
              JSON.stringify({
                reason: 'dispute_finalized:merchant',
                resolved_by: complianceMember.id,
                resolved_by_name: complianceMember.name,
                target_source: resolved.kind,
                target_rationale: resolved.rationale,
                original_lock_at: order.escrow_debited_at,
              }),
              balanceBefore,
              balanceAfter,
            ]
          );

          refundedTo = {
            entityId: resolved.entityId,
            entityType: resolved.entityType,
            amount: resolved.amount,
          };

          // Post-invariant 2: system-level ledger conservation.
          // For this order, SUM(ESCROW_LOCK) MUST equal
          // SUM(ESCROW_RELEASE) + SUM(ESCROW_REFUND). If our REFUND
          // collapsed via ON CONFLICT (silent no-op) or some other
          // path moved escrow without us seeing it, this catches it.
          // Legacy orders (predate ledger) have lock_total = 0 — log
          // and skip rather than block finalization on historical data.
          const ledgerSumRes = await client.query(
            `SELECT entry_type, COALESCE(SUM(amount), 0)::numeric AS total
               FROM ledger_entries
              WHERE related_order_id = $1
                AND entry_type IN ('ESCROW_LOCK', 'ESCROW_RELEASE', 'ESCROW_REFUND')
              GROUP BY entry_type`,
            [orderId]
          );
          const sums: Record<string, number> = {};
          for (const r of ledgerSumRes.rows as Array<{ entry_type: string; total: string }>) {
            sums[r.entry_type] = parseFloat(String(r.total));
          }
          const lockTotal = sums['ESCROW_LOCK'] ?? 0;
          const releaseTotal = sums['ESCROW_RELEASE'] ?? 0;
          const refundTotal = sums['ESCROW_REFUND'] ?? 0;

          if (lockTotal === 0) {
            logger.warn('[Atomic] Dispute finalize: ledger invariant skipped (no LOCK row, legacy)', {
              orderId, refundTotal, releaseTotal,
            });
          } else if (Math.abs(lockTotal - releaseTotal - refundTotal) > 0.00000001) {
            throw new Error(
              `LEDGER_INVARIANT_VIOLATION: lock=${lockTotal} release=${releaseTotal} refund=${refundTotal}`
            );
          }

          logger.info('[Atomic] Dispute escrow refunded', {
            orderId,
            refundedTo: resolved.entityId,
            refundedType: resolved.entityType,
            amount: resolved.amount,
            source: resolved.kind,
            balanceBefore,
            balanceAfter,
            ledgerLockTotal: lockTotal,
            ledgerReleaseTotal: releaseTotal,
            ledgerRefundTotal: refundTotal,
          });
        }
      }

      // ── 3. Status update — guarded by order_version + previous status ─
      const orderUpdateFields: string[] = [
        `status = $1::order_status`,
        `order_version = order_version + 1`,
      ];
      const orderUpdateValues: (string | number | null)[] = [newStatus];
      let p = 2;

      if (newStatus === 'completed') {
        orderUpdateFields.push(`completed_at = NOW()`);
      } else {
        orderUpdateFields.push(
          `cancelled_at = NOW()`,
          `cancelled_by = 'system'::actor_type`,
          `cancellation_reason = $${p}`
        );
        orderUpdateValues.push(`Dispute finalized in seller's favor by ${complianceMember.name}`);
        p++;
      }

      if (releaseTxHash) {
        orderUpdateFields.push(`release_tx_hash = $${p}`);
        orderUpdateValues.push(releaseTxHash);
        p++;
      }
      if (refundTxHash) {
        orderUpdateFields.push(`refund_tx_hash = $${p}`);
        orderUpdateValues.push(refundTxHash);
        p++;
      }

      orderUpdateValues.push(orderId, order.order_version, order.status);
      const idIdx = p, versionIdx = p + 1, statusIdx = p + 2;

      const orderUpdate = await client.query(
        `UPDATE orders
            SET ${orderUpdateFields.join(', ')}
          WHERE id = $${idIdx}
            AND order_version = $${versionIdx}
            AND status = $${statusIdx}::order_status
            AND status NOT IN ('completed', 'cancelled', 'expired')
          RETURNING *`,
        orderUpdateValues
      );

      if (orderUpdate.rows.length === 0) {
        // Concurrent writer changed the order — refund (if any) gets
        // rolled back along with the dispute UPDATE below.
        throw new Error('STATUS_CHANGED_CONCURRENT');
      }
      const updatedOrder = orderUpdate.rows[0] as Order;

      // ── 4. Dispute row → resolved ─────────────────────────────────────
      await client.query(
        `UPDATE disputes
            SET status = 'resolved'::dispute_status,
                resolved_by = $1,
                resolved_at = NOW(),
                proposed_resolution = $2,
                resolution_notes = COALESCE(resolution_notes || E'\n', '') || $3
          WHERE order_id = $4`,
        [
          complianceMember.id,
          resolution,
          `[${new Date().toISOString()}] FINALIZED by ${complianceMember.name} (${complianceMember.role}): ${notes || 'No notes'}`,
          orderId,
        ]
      );

      // ── 5. Audit + outbox + chat — all on the same client ────────────
      await client.query(
        `INSERT INTO order_events
           (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, $2, 'system'::actor_type, NULL, 'disputed', $3::order_status, $4)`,
        [
          orderId,
          newStatus === 'cancelled' ? 'dispute_finalized_refund' : 'dispute_finalized_release',
          newStatus,
          JSON.stringify({
            resolution,
            escrowAction,
            resolved_by: complianceMember.id,
            resolved_by_name: complianceMember.name,
            resolved_by_role: complianceMember.role,
            refunded_to: refundedTo ?? null,
            release_tx_hash: releaseTxHash ?? null,
            refund_tx_hash: refundTxHash ?? null,
            notes: notes ?? null,
            atomic_finalize: true,
          }),
        ]
      );

      await client.query(
        `INSERT INTO notification_outbox (event_type, order_id, payload)
         VALUES ($1, $2, $3)`,
        [
          'DISPUTE_FINALIZED',
          orderId,
          JSON.stringify({
            orderId,
            userId: updatedOrder.user_id,
            merchantId: updatedOrder.merchant_id,
            buyerMerchantId: updatedOrder.buyer_merchant_id,
            status: newStatus,
            previousStatus: 'disputed',
            orderVersion: updatedOrder.order_version,
            order_version: updatedOrder.order_version,
            resolution,
            escrowAction,
            resolvedBy: complianceMember.name,
            updatedAt: new Date().toISOString(),
          }),
        ]
      );

      await client.query(
        `INSERT INTO chat_messages
           (order_id, sender_type, sender_id, content, message_type, created_at)
         VALUES ($1, 'system'::actor_type, $2, $3, 'system'::message_type, NOW())`,
        [
          orderId,
          complianceMember.id,
          JSON.stringify({
            type: 'dispute_finalized',
            resolution,
            resolvedBy: complianceMember.name,
            escrowAction,
            notes: notes ?? null,
          }),
        ]
      );

      return { order: updatedOrder, refundedTo };
    });

    return {
      success: true,
      order: result.order,
      newStatus,
      escrowAction,
      refundedTo: result.refundedTo,
    };
  } catch (error) {
    const errMsg = (error as Error).message ?? 'unknown';

    // Map known sentinels to clean 4xx responses; everything else is 5xx.
    if (errMsg === 'ORDER_NOT_FOUND') {
      return { success: false, error: 'Order not found' };
    }
    if (errMsg.startsWith('ORDER_NOT_DISPUTED:')) {
      const cur = errMsg.split(':')[1] ?? 'unknown';
      return { success: false, error: `Cannot finalize dispute for order in '${cur}' status` };
    }
    if (errMsg === 'STATUS_TRANSITION_INVALID' || errMsg === 'STATUS_CHANGED_CONCURRENT') {
      return { success: false, error: 'Order status changed — finalization no longer valid. Refresh and retry.' };
    }
    if (errMsg === 'REFUND_TARGET_NOT_FOUND') {
      return { success: false, error: 'Escrow-debited entity not found — cannot refund. Investigate manually.' };
    }
    if (errMsg.startsWith('REFUND_TARGET_INDETERMINATE')) {
      logger.error('[security] Dispute finalize aborted — refund target indeterminate', {
        orderId, error: errMsg,
      });
      return {
        success: false,
        error: 'Cannot determine refund target for this order — manual review required.',
      };
    }
    if (errMsg.startsWith('REFUND_TARGET_MISMATCH')) {
      logger.error('[security] Dispute finalize aborted — refund target mismatch', {
        orderId, error: errMsg,
      });
      return {
        success: false,
        error: 'Refund target validation failed — manual review required.',
      };
    }
    if (errMsg.startsWith('BALANCE_MISMATCH')) {
      logger.error('[Atomic] Dispute finalize balance mismatch — transaction rolled back', {
        orderId,
        error: errMsg,
      });
      return { success: false, error: 'Balance invariant violated — refund aborted. On-call paged.' };
    }
    if (errMsg.startsWith('LEDGER_INVARIANT_VIOLATION')) {
      logger.error('[Atomic] Dispute finalize ledger invariant violated — transaction rolled back', {
        orderId,
        error: errMsg,
      });
      return { success: false, error: 'Ledger invariant violated — refund aborted. On-call paged.' };
    }

    logger.error('[Atomic] Dispute finalize failed', { orderId, error: errMsg });
    return { success: false, error: `Failed to finalize dispute: ${errMsg}` };
  }
}
