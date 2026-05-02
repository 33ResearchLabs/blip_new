#!/usr/bin/env tsx
/**
 * One-shot orphan refund — fires `refund_escrow` on-chain via the backend
 * signer for an order that was already backfilled by recover-orphan-escrow.ts
 * but whose payment-deadline-worker (Job 4) isn't currently running.
 *
 * Usage:
 *   tsx scripts/refund-orphan-now.ts --order-id <uuid>
 */

import { config as dotenv } from 'dotenv';
import { resolve } from 'path';
dotenv({ path: resolve(__dirname, '..', '.env.local') });

async function main() {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--order-id');
  const orderId = idx >= 0 ? argv[idx + 1] : undefined;
  if (!orderId) {
    console.error('missing --order-id <uuid>');
    process.exit(1);
  }

  const { query } = await import('../src/lib/db');
  const rows = await query<{
    id: string;
    status: string;
    crypto_amount: string;
    escrow_creator_wallet: string | null;
    escrow_trade_id: string | null;
    release_tx_hash: string | null;
  }>(
    `SELECT id, status, crypto_amount, escrow_creator_wallet, escrow_trade_id, release_tx_hash
       FROM orders WHERE id = $1`,
    [orderId],
  );
  if (rows.length === 0) {
    console.error(`order ${orderId} not found`);
    process.exit(1);
  }
  const order = rows[0];
  if (order.release_tx_hash) {
    console.log(`already refunded — release_tx_hash=${order.release_tx_hash}`);
    process.exit(0);
  }
  if (!order.escrow_creator_wallet || !order.escrow_trade_id) {
    console.error(
      `order missing escrow_creator_wallet or escrow_trade_id; run recover-orphan-escrow.ts first`,
    );
    process.exit(1);
  }

  console.log(`→ refunding ${order.crypto_amount} USDT for order ${order.id}`);
  console.log(`  status=${order.status}`);
  console.log(`  creator=${order.escrow_creator_wallet}`);
  console.log(`  trade_id=${order.escrow_trade_id}`);

  const { refundEscrowFromBackend } = await import('../src/lib/solana/backendRefund');
  const result = await refundEscrowFromBackend(
    order.escrow_creator_wallet,
    Number(order.escrow_trade_id),
  );

  if (!result.success) {
    console.error('✗ on-chain refund failed:', result.error);
    process.exit(1);
  }

  console.log(`✓ on-chain refund OK: ${result.txHash}`);

  // Mirror what Job 4 does in DB so the order stops being a candidate.
  const SENTINELS = new Set(['escrow-already-closed', 'already-refunded']);
  if (SENTINELS.has(result.txHash || '')) {
    await query(
      `UPDATE orders
          SET refund_retry_after = TIMESTAMP '9999-12-31 00:00:00+00',
              refund_last_error = $1
        WHERE id = $2`,
      [`resolved:${result.txHash}`, order.id],
    );
    console.log('(sentinel hash — order parked, no real refund tx — escrow was already closed)');
  } else {
    await query(
      `UPDATE orders
          SET release_tx_hash = $1,
              refund_retry_after = NULL,
              refund_last_error = NULL,
              order_version = order_version + 1
        WHERE id = $2`,
      [result.txHash, order.id],
    );
    console.log(`✓ release_tx_hash recorded on order ${order.id}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('✗ error:', (err as Error).message);
  process.exit(1);
});
