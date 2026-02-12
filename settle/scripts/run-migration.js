const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'settle',
    user: 'zeus',
    password: '',
  });

  try {
    const migrationPath = path.join(__dirname, '../database/migrations/017_spread_preference_system.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration: 017_spread_preference_system.sql');
    await pool.query(sql);
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration().catch(console.error);
