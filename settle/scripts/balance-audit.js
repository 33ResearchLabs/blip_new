const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5432, database: 'settle', user: 'zeus' });

const TAP = '8db14564-bde1-4474-86ba-48d7f67142fb';
const ZORO = '47951c48-197d-428e-b887-4299413d7bb4';
const RED = '8c514ecd-b5c5-4abe-841d-3c2301f2957e';
const TEST_MERCHANT = '4a6e73b0-14bb-460b-88f3-abcbd86e83e1';

const NAMES = {
  [TAP]: 'Tap',
  [ZORO]: 'Zoro',
  [RED]: 'Red',
  [TEST_MERCHANT]: 'TestMerch',
};

const name = (id) => NAMES[id] || (id ? id.substring(0, 8) : 'null');

async function run() {
  await client.connect();

  // Get ALL orders that have escrow (balance-affecting)
  const orders = await client.query(`
    SELECT id, order_number, type, status, crypto_amount, fiat_amount,
           merchant_id, buyer_merchant_id, user_id,
           escrow_tx_hash, release_tx_hash, refund_tx_hash,
           escrow_creator_wallet, escrow_address,
           created_at, escrowed_at, completed_at, cancelled_at
    FROM orders
    ORDER BY created_at ASC
  `);

  console.log('=== FULL BALANCE AUDIT ===');
  console.log('Total orders:', orders.rows.length);

  // Track balance changes for ALL merchants
  const balanceChanges = {};
  const initBalance = (id) => {
    if (balanceChanges[id] === undefined) balanceChanges[id] = { start: 10000, changes: [], current: 10000 };
  };

  const addChange = (id, amount, reason) => {
    initBalance(id);
    balanceChanges[id].changes.push({ amount, reason });
    balanceChanges[id].current += amount;
  };

  for (const o of orders.rows) {
    const amt = parseFloat(o.crypto_amount);
    const hasEscrow = o.escrow_tx_hash !== null && o.escrow_tx_hash !== undefined;
    const hasRelease = o.release_tx_hash !== null && o.release_tx_hash !== undefined;
    const isBuyOrder = o.type === 'buy';

    // Determine seller and buyer
    // merchant_id = seller (after acceptance)
    // buyer_merchant_id = buyer (if M2M)
    const sellerId = o.merchant_id;
    const buyerId = o.buyer_merchant_id;

    // Only trace orders that affected Tap or Zoro
    const involvesTapZoro = [TAP, ZORO].includes(sellerId) || [TAP, ZORO].includes(buyerId);
    if (involvesTapZoro) {
      console.log(`\n[${o.order_number}] type=${o.type} status=${o.status} amount=${amt}`);
      console.log(`  merchant_id(seller)=${name(sellerId)} buyer_merchant_id(buyer)=${name(buyerId)} user_id=${o.user_id ? o.user_id.substring(0, 8) : 'null'}`);
      console.log(`  escrow=${hasEscrow ? o.escrow_tx_hash.substring(0, 20) : 'NO'} release=${hasRelease ? 'YES' : 'NO'}`);
      console.log(`  escrow_creator_wallet=${o.escrow_creator_wallet || 'null'}`);
    }

    if (o.status === 'completed' && hasEscrow && hasRelease) {
      // Normal completed order with escrow
      // Escrow lock: deducted from seller (merchant_id)
      // Release: credited to buyer (determined by release logic)

      // The release logic:
      // For BUY orders: recipient = buyer_merchant_id || user_id
      // For SELL orders: recipient = buyer_merchant_id || merchant_id
      let releaseRecipient;
      if (isBuyOrder) {
        releaseRecipient = buyerId || o.user_id;
      } else {
        releaseRecipient = buyerId || sellerId;
      }

      addChange(sellerId, -amt, `ESCROW_LOCK ${o.order_number}`);
      addChange(releaseRecipient, +amt, `ESCROW_RELEASE ${o.order_number}`);

      if (involvesTapZoro) {
        console.log(`  BALANCE: ${name(sellerId)} -${amt} (lock), ${name(releaseRecipient)} +${amt} (release)`);
      }
    } else if (o.status === 'completed' && hasEscrow && !hasRelease) {
      // Completed via PATCH status (not via /escrow release endpoint)
      // PATCH completion handler: if hadEscrow && !release_tx_hash → credit buyer
      let patchRecipient;
      if (isBuyOrder) {
        patchRecipient = buyerId || o.user_id;
      } else {
        patchRecipient = buyerId || sellerId;
      }

      addChange(sellerId, -amt, `ESCROW_LOCK ${o.order_number}`);
      addChange(patchRecipient, +amt, `PATCH_COMPLETE_CREDIT ${o.order_number}`);

      if (involvesTapZoro) {
        console.log(`  WARNING: Completed via PATCH (no release_tx)`);
        console.log(`  BALANCE: ${name(sellerId)} -${amt} (lock), ${name(patchRecipient)} +${amt} (PATCH credit)`);
      }
    } else if (o.status === 'completed' && !hasEscrow) {
      // Completed without escrow - NO balance change
      // UNLESS the PATCH handler has a bug
      if (involvesTapZoro) {
        console.log(`  CRITICAL: Completed WITHOUT escrow. No balance change expected.`);
        // But let's check if self-trade might have caused issues
        if (sellerId === buyerId) {
          console.log(`  SELF-TRADE: ${name(sellerId)} to self. Should be no-op.`);
        }
      }
    } else if (['cancelled', 'expired'].includes(o.status) && hasEscrow) {
      // Cancelled/expired with escrow - should refund seller
      // Check the refund logic
      // PATCH cancel: refundId = isBuyOrder ? merchant_id : user_id
      // DELETE cancel: same
      // expireOldOrders: same

      // BUG CHECK: for sell orders, refund goes to user_id, not merchant_id (seller)
      let refundRecipient;
      if (isBuyOrder) {
        refundRecipient = sellerId; // merchant_id (correct for buy orders)
      } else {
        refundRecipient = o.user_id; // BUG! Should be merchant_id for M2M
      }

      // Escrow was locked (deducted from seller) but then refunded
      addChange(sellerId, -amt, `ESCROW_LOCK ${o.order_number}`);
      addChange(refundRecipient, +amt, `REFUND ${o.order_number}`);

      if (involvesTapZoro) {
        console.log(`  BALANCE: ${name(sellerId)} -${amt} (lock), ${name(refundRecipient)} +${amt} (refund)`);
        if (!isBuyOrder && refundRecipient !== sellerId) {
          console.log(`  BUG: Refund went to user ${refundRecipient.substring(0, 8)} instead of seller ${name(sellerId)}`);
        }
      }
    } else if (hasEscrow && !['completed', 'cancelled', 'expired'].includes(o.status)) {
      // In-progress with escrow locked - balance deducted but not credited/refunded
      addChange(sellerId, -amt, `ESCROW_LOCK_IN_PROGRESS ${o.order_number} (${o.status})`);

      if (involvesTapZoro) {
        console.log(`  IN-PROGRESS: ${name(sellerId)} -${amt} locked (status=${o.status})`);
      }
    } else {
      // No escrow, no balance change
      if (involvesTapZoro) {
        console.log(`  NO BALANCE CHANGE (status=${o.status}, no escrow)`);
      }
    }
  }

  // Get actual balances
  const merchants = await client.query('SELECT id, business_name, balance FROM merchants ORDER BY created_at');

  console.log('\n\n========== BALANCE COMPARISON ==========');
  console.log('Merchant'.padEnd(20), 'Expected'.padEnd(12), 'Actual'.padEnd(12), 'Diff'.padEnd(10), 'Changes');

  for (const m of merchants.rows) {
    const expected = balanceChanges[m.id] ? balanceChanges[m.id].current : 10000;
    const actual = parseFloat(m.balance);
    const diff = actual - expected;
    const changes = balanceChanges[m.id] ? balanceChanges[m.id].changes.length : 0;

    if (diff !== 0 || changes > 0) {
      console.log(
        `${m.business_name}`.padEnd(20),
        `${expected.toFixed(0)}`.padEnd(12),
        `${actual.toFixed(0)}`.padEnd(12),
        `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}`.padEnd(10),
        `${changes} ops`
      );
    }
  }

  // Detailed change log for Tap and Zoro
  console.log('\n\n========== TAP CHANGE LOG ==========');
  if (balanceChanges[TAP]) {
    let running = 10000;
    for (const c of balanceChanges[TAP].changes) {
      running += c.amount;
      console.log(`  ${c.amount >= 0 ? '+' : ''}${c.amount.toFixed(0)} → ${running.toFixed(0)}  (${c.reason})`);
    }
  }

  console.log('\n========== ZORO CHANGE LOG ==========');
  if (balanceChanges[ZORO]) {
    let running = 10000;
    for (const c of balanceChanges[ZORO].changes) {
      running += c.amount;
      console.log(`  ${c.amount >= 0 ? '+' : ''}${c.amount.toFixed(0)} → ${running.toFixed(0)}  (${c.reason})`);
    }
  }

  // Check the cancellation refund bug for M2M sell orders
  console.log('\n\n========== BUG CHECK: Wrong Refund Recipient ==========');
  const cancelledWithEscrow = orders.rows.filter(o =>
    ['cancelled', 'expired'].includes(o.status) && o.escrow_tx_hash && o.type === 'sell'
  );
  for (const o of cancelledWithEscrow) {
    console.log(`  ${o.order_number}: type=sell, seller=${name(o.merchant_id)}, would refund to user ${o.user_id.substring(0, 8)} instead of seller`);
    if (o.buyer_merchant_id) {
      console.log(`    This is M2M! buyer=${name(o.buyer_merchant_id)}. Seller=${name(o.merchant_id)} should get refund.`);
    }
  }

  // Double-check: sum of all balances
  let totalActual = 0;
  let totalExpected = 0;
  for (const m of merchants.rows) {
    totalActual += parseFloat(m.balance);
    totalExpected += balanceChanges[m.id] ? balanceChanges[m.id].current : 10000;
  }
  console.log(`\nTotal merchants: ${merchants.rows.length}`);
  console.log(`Total expected balance: ${totalExpected.toFixed(0)}`);
  console.log(`Total actual balance: ${totalActual.toFixed(0)}`);
  console.log(`Total starting (${merchants.rows.length} * 10000): ${merchants.rows.length * 10000}`);
  console.log(`Total leaked/missing: ${(merchants.rows.length * 10000 - totalActual).toFixed(0)}`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
