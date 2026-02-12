#!/usr/bin/env node
/**
 * Apply Railway Database Migration via Node.js
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node settle/scripts/apply-migration-to-railway.js
 *
 * Or set DATABASE_URL in .env and run:
 *   node settle/scripts/apply-migration-to-railway.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load .env if present
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found!');
  console.error('');
  console.error('Set it as an environment variable:');
  console.error('  DATABASE_URL="postgresql://..." node settle/scripts/apply-migration-to-railway.js');
  console.error('');
  console.error('Or add it to settle/.env.local');
  process.exit(1);
}

const MIGRATION_FILE = path.join(__dirname, '..', 'database', 'railway-migration.sql');

if (!fs.existsSync(MIGRATION_FILE)) {
  console.error(`❌ Migration file not found: ${MIGRATION_FILE}`);
  process.exit(1);
}

console.log('==================================================');
console.log('  Railway Database Migration (Node.js)');
console.log('==================================================');
console.log('');
console.log('✅ DATABASE_URL found');
console.log('✅ Migration file found');
console.log('');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('📡 Connecting to Railway PostgreSQL...');

    // Read migration SQL
    const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');

    console.log('🚀 Applying migration...');
    console.log('');

    // Execute migration
    await client.query(migrationSQL);

    console.log('');
    console.log('==================================================');
    console.log('✅ Migration applied successfully!');
    console.log('==================================================');
    console.log('');

    // Verify spread_preference column exists
    console.log('🔍 Verifying columns...');
    const verifyResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'orders'
        AND column_name IN ('spread_preference', 'protocol_fee_percentage', 'protocol_fee_amount', 'escrow_trade_id')
      ORDER BY column_name
    `);

    console.log('');
    console.log('Found columns:');
    verifyResult.rows.forEach(row => {
      console.log(`  ✓ ${row.column_name} (${row.data_type})`);
    });

    if (verifyResult.rows.length === 4) {
      console.log('');
      console.log('✅ All required columns exist!');
    } else {
      console.log('');
      console.log('⚠️  Some columns may be missing. Check the output above.');
    }

  } catch (error) {
    console.error('');
    console.error('❌ Migration failed!');
    console.error('');
    console.error('Error:', error.message);
    console.error('');

    if (error.message.includes('already exists')) {
      console.error('This might be okay - columns may already exist.');
      console.error('Check the error details above.');
    }

    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
