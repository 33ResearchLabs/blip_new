// Database client for PostgreSQL
// Uses pg library for localhost development
// Singleton pool — survives HMR in dev mode
//
// Pool sizing guide (DB_POOL_MAX):
//   Development:  10-20
//   Production:   50-100 (tune per Postgres max_connections / num_instances)
//   Rule of thumb: max_connections / num_app_instances, leaving ~20% for admin/monitoring

import { Pool, PoolClient } from 'pg';

// Support both DATABASE_URL (Railway) and individual env vars (local dev)
const isProduction = process.env.NODE_ENV === 'production';
const defaultPoolMax = isProduction ? '50' : '20';
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
      max: parseInt(process.env.DB_POOL_MAX || defaultPoolMax),
      idleTimeoutMillis: isProduction ? 10000 : 30000, // Return idle connections faster in prod
      connectionTimeoutMillis: 5000, // Fail fast if pool exhausted
      statement_timeout: 30000,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'settle',
      user: process.env.DB_USER || 'zeus',
      password: process.env.DB_PASSWORD || '',
      max: parseInt(process.env.DB_POOL_MAX || defaultPoolMax),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: 30000,
    };

// Prevent pool duplication on HMR reloads in dev
const globalForDb = globalThis as unknown as { __dbPool?: Pool };
const pool = globalForDb.__dbPool ?? new Pool(poolConfig);
if (!isProduction) globalForDb.__dbPool = pool;

// Only attach listeners once (avoid accumulation on HMR)
if (!globalForDb.__dbPool || globalForDb.__dbPool === pool) {
  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });
}

// ── Schema safety net ────────────────────────────────────────────────────
// Ensures critical columns exist before the app starts serving requests.
// This covers the gap between settle starting and core-api's migration runner
// reaching the relevant migration. All statements are idempotent (IF NOT EXISTS).
const globalForSchema = globalThis as unknown as { __schemaEnsured?: boolean };
if (!globalForSchema.__schemaEnsured) {
  globalForSchema.__schemaEnsured = true;
  pool.query(`
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS has_ops_access BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE compliance_team ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(64);
  `).then(() => {
    console.log('[DB] Schema safety net applied');
  }).catch((err) => {
    // Non-fatal — core-api migration runner will handle it
    console.warn('[DB] Schema safety net skipped:', err.message);
  });
}

// Lazy import to avoid circular dependency (monitoring imports from db)
let _recordLatency: ((ms: number) => void) | undefined;
function getLatencyRecorder(): (ms: number) => void {
  if (_recordLatency) return _recordLatency;
  try {
    const mod = require('../monitoring');
    if (typeof mod?.recordQueryLatency === 'function') {
      _recordLatency = mod.recordQueryLatency;
    } else {
      _recordLatency = () => {};
    }
  } catch {
    _recordLatency = () => {};
  }
  return _recordLatency;
}

// Query helper with automatic client release
export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  // Record latency for metrics
  getLatencyRecorder()(duration);

  // Log slow queries in all environments (>200ms)
  if (duration > 200) {
    console.warn('[SLOW QUERY]', { sql: text.substring(0, 120), duration_ms: duration, rows: result.rowCount });
  } else if (process.env.NODE_ENV === 'development') {
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

// Export pool for direct access if needed
export { pool };
export default { query, queryOne, transaction, pool };
