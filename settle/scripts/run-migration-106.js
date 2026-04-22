/**
 * One-off runner for migration 106_issues.sql
 *
 * Core-api's migrationRunner auto-applies new migrations on boot, but if
 * core-api is already running when a new file is added, the migration
 * won't be picked up until restart. This script lets you apply it to
 * the local DB without restarting the worker process.
 *
 * Idempotent: the migration itself uses CREATE TABLE IF NOT EXISTS +
 * CREATE INDEX IF NOT EXISTS, and we also update the schema_migrations
 * audit table so core-api won't attempt to re-run it on next boot.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'settle',
    user: process.env.DB_USER || 'zeus',
    password: process.env.DB_PASSWORD || '',
  });

  const file = '106_issues.sql';
  const migrationPath = path.join(__dirname, '..', 'database', 'migrations', file);

  try {
    // Ensure the audit table exists — mirrors what core-api's
    // migrationRunner.ts creates on first run.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Skip if already recorded as applied.
    const existing = await pool.query(
      'SELECT id FROM schema_migrations WHERE filename = $1',
      [file],
    );
    if (existing.rows.length > 0) {
      console.log(`✓ ${file} already applied (per schema_migrations)`);
      // Still verify table exists — the migration might have been
      // recorded without actually creating the table (shouldn't
      // happen but let's check).
      const tbl = await pool.query(
        `SELECT EXISTS (
           SELECT FROM information_schema.tables
           WHERE table_name = 'issues'
         ) AS exists`,
      );
      console.log(`  issues table exists: ${tbl.rows[0].exists}`);
      return;
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');
    console.log(`Applying ${file}…`);
    await pool.query(sql);
    await pool.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [file],
    );
    console.log(`✅ ${file} applied and recorded.`);

    // Verify
    const tbl = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM information_schema.columns
           WHERE table_name = 'issues') AS column_count,
         (SELECT COUNT(*)::int FROM pg_indexes
           WHERE tablename = 'issues') AS index_count`,
    );
    console.log(
      `  issues table: ${tbl.rows[0].column_count} columns, ${tbl.rows[0].index_count} indexes`,
    );
  } catch (err) {
    console.error(`❌ Migration failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
