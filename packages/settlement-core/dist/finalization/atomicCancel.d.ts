/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ATOMIC ESCROW REFUND - LOCKED FINALIZATION PATH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CRITICAL: This function MUST remain atomic. Do NOT refactor to split apart:
 * - status update to 'cancelled'
 * - balance refund (if MOCK_MODE and escrow exists)
 * - timestamp updates (cancelled_at)
 * - order_events record creation
 * - notification_outbox record creation
 * - order_version increment
 *
 * All of the above MUST happen in a SINGLE database transaction.
 * Any attempt to split this logic will introduce race conditions.
 *
 * Post-commit invariant validation ensures this contract is maintained.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Order, ActorType } from '../types/index';
export interface AtomicCancelResult {
    success: boolean;
    order?: Order;
    error?: string;
}
/**
 * Atomically cancel an order with escrow refund
 *
 * This function ensures that when an order with locked escrow is cancelled:
 * 1. The escrow amount is refunded to the seller
 * 2. The order status is set to 'cancelled'
 * 3. An order_events record is created
 * 4. A notification_outbox record is created
 * 5. The order_version is incremented
 *
 * All in a SINGLE database transaction to prevent money printer bugs.
 */
export declare function atomicCancelWithRefund(orderId: string, currentStatus: string, actorType: ActorType, actorId: string, reason?: string, orderData?: {
    type: 'buy' | 'sell';
    crypto_amount: number;
    merchant_id: string;
    user_id: string;
    buyer_merchant_id: string | null;
    order_number: number;
    crypto_currency: string;
    fiat_amount: number;
    fiat_currency: string;
}): Promise<AtomicCancelResult>;
//# sourceMappingURL=atomicCancel.d.ts.map