/**
 * Safe column query wrapper.
 * Catches PostgreSQL error 42703 (undefined_column) and falls back
 * gracefully instead of returning a 500 to the client.
 */

import { queryOne, query } from 'settlement-core';

/**
 * Wraps a query that references potentially-missing columns.
 * If the column doesn't exist (error code 42703), logs a warning
 * and returns the fallback value instead of throwing.
 */
export async function safeColumnQueryOne<T>(
  sql: string,
  params: unknown[],
  fallbackSql: string,
  fallbackParams: unknown[],
  columnDescription: string
): Promise<T | null> {
  try {
    return await queryOne<T>(sql, params);
  } catch (err: unknown) {
    if (isUndefinedColumnError(err)) {
      console.warn(
        `[safe-column-query] Column missing (${columnDescription}). Using fallback query. Run pending migrations to fix.`
      );
      return await queryOne<T>(fallbackSql, fallbackParams);
    }
    throw err;
  }
}

export async function safeColumnQuery<T>(
  sql: string,
  params: unknown[],
  fallbackSql: string,
  fallbackParams: unknown[],
  columnDescription: string
): Promise<T[]> {
  try {
    return await query<T>(sql, params);
  } catch (err: unknown) {
    if (isUndefinedColumnError(err)) {
      console.warn(
        `[safe-column-query] Column missing (${columnDescription}). Using fallback query. Run pending migrations to fix.`
      );
      return await query<T>(fallbackSql, fallbackParams);
    }
    throw err;
  }
}

function isUndefinedColumnError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '42703'
  );
}
