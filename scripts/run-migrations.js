#!/usr/bin/env node
/**
 * Database Migration Runner
 *
 * Applies all SQL migrations in order from settle/database/migrations/
 * Tracks applied migrations in a _migrations table to avoid re-running.
 *
 * Usage:
 *   node scripts/run-migrations.js              # apply pending migrations
 *   node scripts/run-migrations.js --mark-all   # mark all as applied (existing DB)
 *   DATABASE_URL="postgresql://..." node scripts/run-migrations.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load .env.local for local dev
try { require('dotenv').config({ path: path.join(__dirname, '..', 'settle', '.env.local') }); } catch {}

const DATABASE_URL = process.env.DATABASE_URL;
const dbConfig = DATABASE_URL
  ? { connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'settle',
      user: process.env.DB_USER || 'zeus',
      password: process.env.DB_PASSWORD || '',
    };

const markAll = process.argv.includes('--mark-all');
const pool = new Pool(dbConfig);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'settle', 'database', 'migrations');

async function run() {
  const client = await pool.connect();
  try {
    // Create tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get already applied
    const { rows: applied } = await client.query('SELECT name FROM _migrations ORDER BY name');
    const appliedSet = new Set(applied.map(r => r.name));

    // Get all migration files sorted
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // --mark-all: register all migrations as applied without running them
    // Use this on an existing DB where migrations were already applied manually
    if (markAll) {
      let marked = 0;
      for (const file of files) {
        if (appliedSet.has(file)) continue;
        await client.query('INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        console.log(`Marked: ${file}`);
        marked++;
      }
      console.log(`\nDone. ${marked} migration(s) marked as applied.`);
      return;
    }

    let count = 0;
    for (const file of files) {
      if (appliedSet.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Applying: ${file}`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        count++;
        console.log(`  OK`);
      } catch (err) {
        await client.query('ROLLBACK');
        if (err.message.includes('already exists') || err.message.includes('duplicate key') || err.message.includes('contains null values')) {
          console.log(`  Skipped (already applied): ${err.message.split('\n')[0]}`);
          await client.query('INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        } else {
          console.error(`  FAILED: ${err.message}`);
          throw err;
        }
      }
    }

    console.log(`\nDone. ${count} new migration(s) applied, ${appliedSet.size} already applied.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
