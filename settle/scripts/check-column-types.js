const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkColumns() {
  try {
    console.log('Checking orders table escrow column types...\n');

    const result = await pool.query(`
      SELECT column_name, data_type, numeric_precision
      FROM information_schema.columns
      WHERE table_name = 'orders'
        AND column_name IN ('escrow_trade_id', 'escrow_tx_hash', 'escrow_pda', 'escrow_trade_pda', 'escrow_creator_wallet')
      ORDER BY ordinal_position
    `);

    console.log('Column Types:');
    result.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}${row.numeric_precision ? ` (precision: ${row.numeric_precision})` : ''}`);
    });

    // Check if escrow_trade_id is integer or bigint
    const tradeIdColumn = result.rows.find(r => r.column_name === 'escrow_trade_id');
    if (tradeIdColumn) {
      if (tradeIdColumn.data_type === 'integer') {
        console.log('\n❌ PROBLEM FOUND: escrow_trade_id is INTEGER (max ~2.1 billion)');
        console.log('   Should be: BIGINT (max ~9 quintillion)');
        console.log('   Timestamp value 1770740284866 exceeds INTEGER range');
      } else if (tradeIdColumn.data_type === 'bigint') {
        console.log('\n✅ escrow_trade_id is correctly BIGINT');
      }
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkColumns();
