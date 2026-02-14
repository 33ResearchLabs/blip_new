// Quick cleanup script to delete test telegram merchants
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'settle',
  user: 'zeus',
  password: '',
});

async function cleanup() {
  try {
    const result = await pool.query(
      "DELETE FROM merchants WHERE email LIKE 'telegram_%@blip.money' RETURNING email"
    );
    console.log(`✅ Deleted ${result.rowCount} telegram merchant(s)`);
    if (result.rows.length > 0) {
      console.log('Deleted emails:', result.rows.map(r => r.email));
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

cleanup();
