// Quick script to check merchant hhh's orders and balance
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/settle_dev'
  });

  await client.connect();

  // Get merchant hhh
  const merchantResult = await client.query(`
    SELECT id, username, balance, sinr_balance, created_at
    FROM merchants
    WHERE username = 'hhh'
  `);

  if (merchantResult.rows.length === 0) {
    console.log('Merchant "hhh" not found');
    await client.end();
    return;
  }

  const merchant = merchantResult.rows[0];
  console.log('\n=== Merchant Info ===');
  console.log('ID:', merchant.id);
  console.log('Username:', merchant.username);
  console.log('Balance:', parseFloat(merchant.balance), 'USDT');
  console.log('sINR Balance:', merchant.sinr_balance ? (merchant.sinr_balance / 100).toFixed(2) : '0', 'AED');
  console.log('Created:', merchant.created_at);

  // Get recent orders
  const ordersResult = await client.query(`
    SELECT
      id,
      order_number,
      type,
      status,
      crypto_amount,
      fiat_amount,
      merchant_id,
      buyer_merchant_id,
      user_id,
      escrow_tx_hash,
      release_tx_hash,
      completed_at,
      created_at
    FROM orders
    WHERE merchant_id = $1 OR buyer_merchant_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [merchant.id]);

  console.log('\n=== Recent Orders ===');
  ordersResult.rows.forEach((order, idx) => {
    console.log(`\n[${idx + 1}] Order #${order.order_number}`);
    console.log('  ID:', order.id);
    console.log('  Type:', order.type);
    console.log('  Status:', order.status);
    console.log('  Amount:', parseFloat(order.crypto_amount), 'USDT');
    console.log('  Fiat:', parseFloat(order.fiat_amount), 'AED');
    console.log('  Merchant ID:', order.merchant_id);
    console.log('  Buyer Merchant ID:', order.buyer_merchant_id);
    console.log('  User ID:', order.user_id);
    console.log('  Has Escrow:', !!order.escrow_tx_hash);
    console.log('  Has Release:', !!order.release_tx_hash);
    console.log('  Completed:', order.completed_at || 'N/A');
    console.log('  Created:', order.created_at);
  });

  // Get merchant transactions
  const txResult = await client.query(`
    SELECT
      id,
      type,
      amount,
      balance_before,
      balance_after,
      description,
      created_at
    FROM merchant_transactions
    WHERE merchant_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [merchant.id]);

  console.log('\n=== Recent Transactions ===');
  txResult.rows.forEach((tx, idx) => {
    console.log(`\n[${idx + 1}] ${tx.type}`);
    console.log('  Amount:', parseFloat(tx.amount), 'USDT');
    console.log('  Balance Before:', parseFloat(tx.balance_before), 'USDT');
    console.log('  Balance After:', parseFloat(tx.balance_after), 'USDT');
    console.log('  Description:', tx.description);
    console.log('  Created:', tx.created_at);
  });

  await client.end();
}

main().catch(console.error);
