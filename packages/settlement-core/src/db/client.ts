// Database client for PostgreSQL
// Uses pg library for localhost development

import { Pool, PoolClient } from 'pg';

// Support both DATABASE_URL (Railway) and individual env vars (local dev)
const isProduction = process.env.NODE_ENV === 'production';
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'settle',
      user: process.env.DB_USER || 'zeus',
      password: process.env.DB_PASSWORD || '',
      max: parseInt(process.env.DB_POOL_MAX || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000,
    };

const pool = new Pool(poolConfig);

// Test connection on startup
pool.on('connect', () => {
  console.log('Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Query helper with automatic client release
export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (duration > 200) {
    console.warn('[SLOW QUERY]', { sql: text.substring(0, 120), duration_ms: duration, rows: result.rowCount });
  } else if (process.env.DB_DEBUG === '1') {
    console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
  }

  return result.rows as T[];
}

// Single row query
export async function queryOne<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

// Transaction helper
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * PostgreSQL error codes that indicate transient contention — safe to retry.
 * 40P01 = deadlock_detected, 40001 = serialization_failure
 */
const RETRYABLE_PG_CODES = new Set(['40P01', '40001']);

interface TransactionRetryOptions {
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms — doubles each attempt (default: 50) */
  baseDelayMs?: number;
  /** Context label for structured logs */
  label?: string;
}

/**
 * Transaction wrapper with automatic retry on deadlock / serialization failure.
 * Uses exponential backoff: 50ms → 100ms → 200ms (configurable).
 *
 * Business-logic errors (e.g. insufficient liquidity) are NOT retried —
 * only transient Postgres contention errors trigger a retry.
 */
export async function transactionWithRetry<T>(
  callback: (client: PoolClient) => Promise<T>,
  opts: TransactionRetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 50, label = 'tx' } = opts;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      await client.query('ROLLBACK');

      const pgCode = err?.code as string | undefined;
      const isRetryable = pgCode && RETRYABLE_PG_CODES.has(pgCode);
      const hasRetriesLeft = attempt <= maxRetries;

      if (isRetryable && hasRetriesLeft) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[${label}] Retryable PG error ${pgCode} on attempt ${attempt}/${maxRetries + 1}, retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      throw err;
    } finally {
      client.release();
    }
  }

  // Unreachable — the loop always returns or throws
  throw new Error(`[${label}] Transaction retry loop exited unexpectedly`);
}

// Graceful shutdown — close all pool connections
export async function closePool(): Promise<void> {
  await pool.end();
}

// Export pool for direct access if needed
export { pool };
export default { query, queryOne, transaction, transactionWithRetry, pool, closePool };
