import { Pool } from 'pg';

/**
 * Shared database connection pool singleton
 *
 * This prevents connection pool exhaustion in Next.js by reusing a single
 * pool instance across all API routes, rather than creating a new pool
 * for each route module.
 *
 * For Supabase Session mode, connections are limited to pool_size.
 */

// Extend globalThis to include our pool reference
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

// Create a singleton pool
function createPool(): Pool {
  const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        max: 5, // Limit max connections for Supabase Session mode
        idleTimeoutMillis: 30000, // Close idle connections after 30s
        connectionTimeoutMillis: 10000, // Connection timeout 10s
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'blipscan',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      };

  return new Pool(poolConfig);
}

// In development, use a global variable to preserve the pool across hot reloads
// In production, create a new pool (module caching handles singleton pattern)
export const pool: Pool = globalThis._pgPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  globalThis._pgPool = pool;
}

// Helper to execute a query with automatic error handling
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
  } finally {
    client.release();
  }
}

export default pool;
