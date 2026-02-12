const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5432, database: 'settle', user: 'zeus' });

const TAP = '8db14564-bde1-4474-86ba-48d7f67142fb';
const ZORO = '47951c48-197d-428e-b887-4299413d7bb4';
const name = (id) => id === TAP ? 'Tap' : id === ZORO ? 'Zoro' : (id || 'none');

async function run() {
  await client.connect();

  const orders = await client.query(`
    SELECT id, order_number, type, status, crypto_amount, fiat_amount, rate,
           merchant_id, buyer_merchant_id, user_id,
           escrow_tx_hash, release_tx_hash,
           created_at, completed_at, cancelled_at, escrowed_at
    FROM orders
    WHERE merchant_id IN ($1, $2)
       OR buyer_merchant_id IN ($1, $2)
    ORDER BY created_at ASC
  `, [TAP, ZORO]);

  console.log('=== ALL ORDERS (' + orders.rows.length + ') ===');

  let tapBalance = 10000;
  let zoroBalance = 10000;

  for (const o of orders.rows) {
    const seller = name(o.merchant_id);
    const buyer = name(o.buyer_merchant_id);
    const amt = parseFloat(o.crypto_amount);
    const hasEscrow = !!o.escrow_tx_hash;
    const hasRelease = !!o.release_tx_hash;

    console.log(`\n[${o.order_number}] type=${o.type} status=${o.status} amount=${amt} USDC`);
    console.log(`  seller(merchant_id)=${seller} buyer(buyer_merchant_id)=${buyer}`);
    console.log(`  escrow_tx=${hasEscrow ? 'YES' : 'NO'} release_tx=${hasRelease ? 'YES' : 'NO'}`);
    console.log(`  created=${o.created_at}`);

    if (o.status === 'completed') {
      if (hasEscrow && hasRelease) {
        // Normal flow: escrow locked then released
        // Lock: deducts from seller (merchant_id)
        // Release: credits buyer (buyer_merchant_id)
        if (seller === 'Tap') tapBalance -= amt;
        if (seller === 'Zoro') zoroBalance -= amt;
        if (buyer === 'Tap') tapBalance += amt;
        if (buyer === 'Zoro') zoroBalance += amt;
        console.log(`  BALANCE: ${seller} -${amt}, ${buyer} +${amt}`);
      } else if (hasEscrow && !hasRelease) {
        // Escrow locked but no release - completed via PATCH status?
        // If completed via PATCH, the completion handler may credit buyer
        console.log(`  WARNING: Completed with escrow but NO release tx`);
        // The PATCH handler credits buyer when completing
        if (seller === 'Tap') tapBalance -= amt;
        if (seller === 'Zoro') zoroBalance -= amt;
        if (buyer === 'Tap') tapBalance += amt;
        if (buyer === 'Zoro') zoroBalance += amt;
        console.log(`  BALANCE (assumed): ${seller} -${amt}, ${buyer} +${amt}`);
      } else if (!hasEscrow && !hasRelease) {
        // No escrow at all - completed without any fund movement?
        console.log(`  CRITICAL: Completed WITHOUT any escrow or release`);
        // Check if the PATCH completion handler still credits
        // Need to check if balance was actually changed
      } else {
        console.log(`  UNUSUAL: release without escrow`);
      }
    } else if (['cancelled', 'expired', 'pending'].includes(o.status)) {
      // No balance change for these statuses
      // BUT if escrow was locked and then cancelled, was it refunded?
      if (hasEscrow) {
        console.log(`  NOTE: Has escrow but status=${o.status} - check if refunded`);
      } else {
        console.log(`  NO BALANCE CHANGE`);
      }
    } else {
      // In-progress statuses
      if (hasEscrow) {
        // Funds are locked (deducted from available, added to locked)
        console.log(`  IN-PROGRESS: escrow locked, funds in limbo (status=${o.status})`);
      } else {
        console.log(`  IN-PROGRESS: no escrow yet (status=${o.status})`);
      }
    }

    console.log(`  Running: Tap=${tapBalance.toFixed(2)} Zoro=${zoroBalance.toFixed(2)}`);
  }

  // Current actual balances
  const balances = await client.query(`
    SELECT m.id, m.business_name, mb.available_balance, mb.locked_balance, mb.total_balance
    FROM merchants m
    JOIN merchant_balances mb ON mb.merchant_id = m.id
    WHERE m.id IN ($1, $2)
  `, [TAP, ZORO]);

  console.log('\n\n========== SUMMARY ==========');
  console.log(`Expected (starting from 10000 each):`);
  console.log(`  Tap: ${tapBalance.toFixed(2)}`);
  console.log(`  Zoro: ${zoroBalance.toFixed(2)}`);
  console.log(`\nActual in DB:`);
  for (const b of balances.rows) {
    console.log(`  ${name(b.id)}: available=${b.available_balance} locked=${b.locked_balance} total=${b.total_balance}`);
  }

  // Also check what the escrow API actually does
  // Let's look at all orders that have escrow_tx_hash to understand the pattern
  console.log('\n\n=== ESCROW DETAILS ===');
  const escrowOrders = await client.query(`
    SELECT order_number, type, status, crypto_amount, merchant_id, buyer_merchant_id,
           escrow_tx_hash, release_tx_hash, refund_tx_hash
    FROM orders
    WHERE (merchant_id IN ($1, $2) OR buyer_merchant_id IN ($1, $2))
      AND escrow_tx_hash IS NOT NULL
    ORDER BY created_at ASC
  `, [TAP, ZORO]);

  console.log('Orders with escrow:', escrowOrders.rows.length);
  for (const o of escrowOrders.rows) {
    console.log(`  ${o.order_number}: type=${o.type} status=${o.status} amount=${o.crypto_amount}`);
    console.log(`    seller=${name(o.merchant_id)} buyer=${name(o.buyer_merchant_id)}`);
    console.log(`    escrow=${o.escrow_tx_hash}`);
    console.log(`    release=${o.release_tx_hash || 'NONE'}`);
    console.log(`    refund=${o.refund_tx_hash || 'NONE'}`);
  }

  // Check merchant_transactions
  const txCount = await client.query('SELECT COUNT(*) as cnt FROM merchant_transactions');
  console.log(`\nmerchant_transactions count: ${txCount.rows[0].cnt}`);

  if (parseInt(txCount.rows[0].cnt) > 0) {
    const txs = await client.query(`
      SELECT * FROM merchant_transactions
      WHERE merchant_id IN ($1, $2)
      ORDER BY created_at ASC
      LIMIT 20
    `, [TAP, ZORO]);
    for (const t of txs.rows) {
      console.log(`  tx: ${t.type} ${t.amount} for ${name(t.merchant_id)} order=${t.order_id}`);
    }
  }

  await client.end();
}
run().catch(e => { console.error(e); process.exit(1); });
