/**
 * Migration runner with tracking.
 * Ensures migrations are applied exactly once and in order.
 *
 * Handles existing databases where migrations were applied manually
 * before tracking existed — if a migration fails because its objects
 * already exist, it's marked as applied and we move on.
 */

import { query, queryOne, pool } from 'settlement-core';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename_ = fileURLToPath(import.meta.url);
const __dirname_ = dirname(__filename_);

const CANDIDATES = [
  join(__dirname_, '../../../settle/database/migrations'),
  join(__dirname_, '../../../../settle/database/migrations'),
];
const MIGRATIONS_DIR = CANDIDATES.find((p) => existsSync(p)) ?? CANDIDATES[0];

async function ensureMigrationsTable(): Promise<void> {
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id         SERIAL PRIMARY KEY,
       filename   TEXT UNIQUE NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    []
  );
}

/** PostgreSQL error codes that mean "this migration was already applied" */
const ALREADY_EXISTS_CODES = new Set([
  '42P07', // duplicate_table / relation already exists
  '42701', // duplicate_column
  '42710', // duplicate_object (constraint, index, etc.)
  '23505', // unique_violation (seed data already inserted)
]);

/**
 * Runs all pending migrations in order.
 */
export async function runPendingMigrations(): Promise<void> {
  await ensureMigrationsTable();

  let files: string[];
  try {
    files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    console.warn(`[migration-runner] Migrations directory not found (${MIGRATIONS_DIR}), skipping.`);
    return;
  }

  if (files.length === 0) return;

  let applied = 0;
  let skipped = 0;

  for (const filename of files) {
    const existing = await queryOne<{ id: number }>(
      'SELECT id FROM schema_migrations WHERE filename = $1',
      [filename]
    );
    if (existing) {
      skipped++;
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
      console.log(`[migration-runner] Applied: ${filename}`);
      applied++;
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const pgCode = typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code: string }).code
        : '';

      if (ALREADY_EXISTS_CODES.has(pgCode)) {
        // Migration's objects already exist — mark as applied
        console.warn(`[migration-runner] ${filename}: already applied (${pgCode}), recording in tracking table.`);
        await query(
          `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
          [filename]
        );
        skipped++;
      } else {
        throw err;
      }
    } finally {
      client.release();
    }
  }

  console.log(`[migration-runner] Done. Applied: ${applied}, already up-to-date: ${skipped}.`);
}
