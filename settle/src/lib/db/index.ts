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
const defaultPoolMax = isProduction ? '100' : '20';
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
let _recordLatency: (ms: number) => void;
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

// ── Error-tracking hooks ─────────────────────────────────────────────────
// Fire-and-forget logger that writes DB errors / slow queries to the
// error_logs table. Lazy-imported so the logger module is not loaded at
// app boot — avoids any circular dependency with the tracking system
// (which itself uses query() to insert).
//
// Threshold tuning:
//   500ms — too aggressive for Railway-hosted envs. The PG proxy alone
//           adds 200-1000ms per query, so 500ms catches mostly network
//           noise, not code issues.
//   2000ms — catches actually slow queries (plan issues, missing indexes,
//            row explosion) while filtering Railway proxy latency.
// Override via DB_SLOW_QUERY_THRESHOLD_MS env var if you want the old
// chatty behavior back for debugging.
const SLOW_QUERY_THRESHOLD_MS = parseInt(
  process.env.DB_SLOW_QUERY_THRESHOLD_MS || '2000',
  10,
);

function truncateSql(sql: string): string {
  const clean = sql.replace(/\s+/g, ' ').trim();
  return clean.length > 500 ? clean.slice(0, 500) + '…' : clean;
}

function firstParams(params: unknown[] | undefined, max = 4): unknown[] | undefined {
  if (!params) return undefined;
  // Redact anything that looks secret
  return params.slice(0, max).map((p) => {
    if (typeof p === 'string' && p.length > 64) return p.slice(0, 32) + '…';
    if (typeof p === 'string' && /token|password|secret|hash|key/i.test(p)) return '[redacted]';
    return p;
  });
}

async function logDbError(sql: string, params: unknown[] | undefined, err: unknown, duration: number): Promise<void> {
  try {
    const { safeLog } = await import('../errorTracking/logger');
    // Don't recursively log errors that came from error_logs itself —
    // would turn a failed insert into an infinite loop.
    if (sql.toLowerCase().includes('error_logs')) return;

    const pgErr = err as { code?: string; detail?: string; constraint?: string; severity?: string; message?: string };
    safeLog({
      type: `db.error${pgErr.code ? '.' + pgErr.code : ''}`,
      severity: pgErr.code && pgErr.code.startsWith('23') ? 'WARN' : 'ERROR', // 23* = constraint violations
      message: `DB error: ${pgErr.message || String(err)}`,
      source: 'backend',
      metadata: {
        sql: truncateSql(sql),
        params: firstParams(params),
        pgCode: pgErr.code,
        pgDetail: pgErr.detail,
        pgConstraint: pgErr.constraint,
        pgSeverity: pgErr.severity,
        duration_ms: duration,
      },
    });
  } catch { /* swallow — logging must never cascade */ }
}

async function logSlowQuery(sql: string, params: unknown[] | undefined, duration: number, rows: number): Promise<void> {
  try {
    const { safeLog } = await import('../errorTracking/logger');
    // Don't log slow queries ON the error_logs table — creates noise when the
    // admin dashboard is paginating through many entries.
    if (sql.toLowerCase().includes('error_logs')) return;

    safeLog({
      type: 'db.slow_query',
      severity: duration > 2000 ? 'WARN' : 'INFO',
      message: `Slow query (${duration} ms, ${rows} rows): ${truncateSql(sql).slice(0, 120)}`,
      source: 'backend',
      metadata: {
        sql: truncateSql(sql),
        params: firstParams(params),
        duration_ms: duration,
        rows,
      },
    });
  } catch { /* swallow */ }
}

// Query helper with automatic client release
export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const start = Date.now();
  let result;
  try {
    result = await pool.query(text, params);
  } catch (err) {
    const duration = Date.now() - start;
    // Fire-and-forget — don't await
    void logDbError(text, params, err, duration);
    throw err;
  }
  const duration = Date.now() - start;

  // Record latency for metrics
  getLatencyRecorder()(duration);

  // Log slow queries in all environments (>200ms for console, >500ms for error_logs)
  if (duration > 200) {
    console.warn('[SLOW QUERY]', { sql: text.substring(0, 120), duration_ms: duration, rows: result.rowCount });
  } else if (process.env.NODE_ENV === 'development') {
    console.log('Executed query', { text: text.substring(0, 50), duration, rows: result.rowCount });
  }
  if (duration > SLOW_QUERY_THRESHOLD_MS) {
    void logSlowQuery(text, params, duration, result.rowCount ?? 0);
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
  const start = Date.now();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    const duration = Date.now() - start;
    if (duration > SLOW_QUERY_THRESHOLD_MS * 2) {
      // Transactions legitimately take longer than single queries; use a 2x
      // threshold to avoid flooding the dashboard with every multi-step op.
      void (async () => {
        try {
          const { safeLog } = await import('../errorTracking/logger');
          safeLog({
            type: 'db.slow_transaction',
            severity: duration > 5000 ? 'WARN' : 'INFO',
            message: `Slow transaction (${duration} ms)`,
            source: 'backend',
            metadata: { duration_ms: duration },
          });
        } catch { /* swallow */ }
      })();
    }
    return result;
  } catch (e) {
    const duration = Date.now() - start;
    try { await client.query('ROLLBACK'); } catch { /* swallow rollback error */ }
    // Log the outer transaction failure. The inner failing query was already
    // logged by query() above, so we only add context that ties them together.
    void (async () => {
      try {
        const { safeLog } = await import('../errorTracking/logger');
        const err = e as { code?: string; message?: string };
        safeLog({
          type: `db.transaction_failed${err?.code ? '.' + err.code : ''}`,
          severity: 'ERROR',
          message: `Transaction rolled back: ${err?.message || String(e)}`,
          source: 'backend',
          metadata: { duration_ms: duration, pgCode: err?.code },
        });
      } catch { /* swallow */ }
    })();
    throw e;
  } finally {
    client.release();
  }
}

// Export pool for direct access if needed
export { pool };
export default { query, queryOne, transaction, pool };
