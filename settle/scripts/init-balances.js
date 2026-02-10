#!/usr/bin/env node

/**
 * Initialize balances for all users and merchants in mock mode
 * Sets balance to 10000 for any user/merchant with 0 or null balance
 */

const { Pool } = require('pg');

const DEFAULT_BALANCE = 10000;

async function initBalances() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('❌ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? undefined : { rejectUnauthorized: false },
  });

  try {
    console.log('🔄 Initializing balances...\n');

    // Update users with 0 or null balance
    const usersResult = await pool.query(
      'UPDATE users SET balance = $1 WHERE balance IS NULL OR balance = 0 RETURNING id, display_name, balance',
      [DEFAULT_BALANCE]
    );

    console.log(`✅ Updated ${usersResult.rowCount} users with balance ${DEFAULT_BALANCE}`);
    if (usersResult.rows.length > 0 && usersResult.rows.length <= 5) {
      usersResult.rows.forEach(row => {
        console.log(`   - ${row.display_name || row.id}: ${row.balance} USDT`);
      });
    }

    // Update merchants with 0 or null balance
    const merchantsResult = await pool.query(
      'UPDATE merchants SET balance = $1 WHERE balance IS NULL OR balance = 0 RETURNING id, display_name, balance',
      [DEFAULT_BALANCE]
    );

    console.log(`✅ Updated ${merchantsResult.rowCount} merchants with balance ${DEFAULT_BALANCE}`);
    if (merchantsResult.rows.length > 0 && merchantsResult.rows.length <= 5) {
      merchantsResult.rows.forEach(row => {
        console.log(`   - ${row.display_name || row.id}: ${row.balance} USDT`);
      });
    }

    console.log('\n✨ Balance initialization complete!');

    // Show current balances summary
    const userCount = await pool.query('SELECT COUNT(*) as count, SUM(balance) as total FROM users');
    const merchantCount = await pool.query('SELECT COUNT(*) as count, SUM(balance) as total FROM merchants');

    console.log('\n📊 Current balances:');
    console.log(`   Users: ${userCount.rows[0].count} accounts, ${parseFloat(userCount.rows[0].total || 0).toFixed(2)} USDT total`);
    console.log(`   Merchants: ${merchantCount.rows[0].count} accounts, ${parseFloat(merchantCount.rows[0].total || 0).toFixed(2)} USDT total`);

  } catch (error) {
    console.error('❌ Error initializing balances:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initBalances();
