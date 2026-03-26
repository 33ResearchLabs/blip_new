import { Pool, PoolClient } from 'pg';
declare const pool: Pool;
export declare function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]>;
export declare function queryOne<T = unknown>(text: string, params?: unknown[]): Promise<T | null>;
export declare function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
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
export declare function transactionWithRetry<T>(callback: (client: PoolClient) => Promise<T>, opts?: TransactionRetryOptions): Promise<T>;
export declare function closePool(): Promise<void>;
export { pool };
declare const _default: {
    query: typeof query;
    queryOne: typeof queryOne;
    transaction: typeof transaction;
    transactionWithRetry: typeof transactionWithRetry;
    pool: Pool;
    closePool: typeof closePool;
};
export default _default;
//# sourceMappingURL=client.d.ts.map