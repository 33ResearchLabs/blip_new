const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'settle',
  user: 'zeus',
  password: '',
});

async function runMigration() {
  try {
    // Check if table already exists
    const check = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'merchant_transactions')"
    );

    if (check.rows[0].exists) {
      console.log('✅ merchant_transactions table already exists');
      await pool.end();
      return;
    }

    // Read and run migration
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'settle', 'migrations', 'add_merchant_transactions.sql'),
      'utf8'
    );

    await pool.query(sql);
    console.log('✅ Migration applied: merchant_transactions table created');
  } catch (error) {
    console.error('❌ Migration error:', error.message);
  } finally {
    await pool.end();
  }
}

runMigration();
