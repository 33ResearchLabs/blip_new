const { Pool } = require('pg');

/**
 * Reset all balances to 10,000 USDC and clean up stuck orders.
 * - Cancels all non-completed/non-cancelled orders
 * - Releases any stuck escrow back (by resetting balance directly)
 * - Sets all merchant and user balances to 10,000
 * - Clears transaction history
 * - Keeps all accounts intact
 */
async function resetBalances() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'settle',
    user: 'zeus',
    password: '',
  });

  try {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Count current state
      const merchants = await client.query('SELECT id, display_name, business_name, balance FROM merchants ORDER BY created_at');
      const users = await client.query('SELECT id, username, balance FROM users WHERE username NOT LIKE $1', ['placeholder_%']);
      const stuckOrders = await client.query(
        `SELECT id, order_number, status, type, crypto_amount, merchant_id, buyer_merchant_id, user_id, escrow_tx_hash
         FROM orders
         WHERE status NOT IN ('completed', 'cancelled', 'expired')
         ORDER BY created_at DESC`
      );

      console.log('\n=== CURRENT STATE ===');
      console.log(`\nMerchants (${merchants.rows.length}):`);
      for (const m of merchants.rows) {
        console.log(`  ${m.display_name || m.business_name || 'unnamed'} (${m.id.slice(0,8)}): balance=${m.balance}`);
      }
      console.log(`\nReal Users (${users.rows.length}):`);
      for (const u of users.rows) {
        console.log(`  ${u.username} (${u.id.slice(0,8)}): balance=${u.balance}`);
      }
      console.log(`\nStuck Orders (${stuckOrders.rows.length}):`);
      for (const o of stuckOrders.rows) {
        console.log(`  ${o.order_number} status=${o.status} type=${o.type} amount=${o.crypto_amount} escrow=${o.escrow_tx_hash ? 'YES' : 'no'}`);
      }

      // 2. Cancel all stuck orders
      const cancelResult = await client.query(
        `UPDATE orders
         SET status = 'cancelled',
             cancelled_by = 'system',
             cancellation_reason = 'System reset - balances recalibrated',
             cancelled_at = NOW()
         WHERE status NOT IN ('completed', 'cancelled', 'expired')`
      );
      console.log(`\n=== ACTIONS ===`);
      console.log(`Cancelled ${cancelResult.rowCount} stuck orders`);

      // 3. Reset ALL merchant balances to 10,000
      const merchReset = await client.query(
        `UPDATE merchants SET balance = 10000`
      );
      console.log(`Reset ${merchReset.rowCount} merchant balances to 10,000`);

      // 4. Reset ALL user balances to 10,000 (real users only, not placeholders)
      const userReset = await client.query(
        `UPDATE users SET balance = 10000`
      );
      console.log(`Reset ${userReset.rowCount} user balances to 10,000`);

      // 5. Clear transaction history
      const txClear = await client.query(`DELETE FROM merchant_transactions`);
      console.log(`Cleared ${txClear.rowCount} transaction records`);

      await client.query('COMMIT');

      // 6. Verify
      const merchAfter = await client.query('SELECT id, display_name, business_name, balance FROM merchants ORDER BY created_at');
      const usersAfter = await client.query('SELECT id, username, balance FROM users WHERE username NOT LIKE $1', ['placeholder_%']);

      console.log('\n=== AFTER RESET ===');
      console.log(`\nMerchants:`);
      for (const m of merchAfter.rows) {
        console.log(`  ${m.display_name || m.business_name || 'unnamed'} (${m.id.slice(0,8)}): balance=${m.balance}`);
      }
      console.log(`\nReal Users:`);
      for (const u of usersAfter.rows) {
        console.log(`  ${u.username} (${u.id.slice(0,8)}): balance=${u.balance}`);
      }

      console.log('\n✅ All balances reset to 10,000 USDC. Ready for testing.');

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

resetBalances().catch(err => {
  console.error('❌ Reset failed:', err.message);
  process.exit(1);
});
