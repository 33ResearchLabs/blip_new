import { Pool, PoolClient } from 'pg';
declare const pool: Pool;
export declare function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]>;
export declare function queryOne<T = unknown>(text: string, params?: unknown[]): Promise<T | null>;
export declare function transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
export { pool };
declare const _default: {
    query: typeof query;
    queryOne: typeof queryOne;
    transaction: typeof transaction;
    pool: Pool;
};
export default _default;
//# sourceMappingURL=client.d.ts.map