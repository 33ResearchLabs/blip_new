/**
 * DEV-ONLY Order Debug Panel - Search & List View
 *
 * This page allows developers to search and filter orders for debugging.
 * IMPORTANT: This page is ONLY accessible in non-production environments.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { isDevEnvironment, getDebugKey } from '@/lib/debugAuth';
import { query } from '@/lib/db';
import { Order, OrderStatus, MinimalOrderStatus } from '@/lib/types/database';
import { normalizeStatus } from '@/lib/orders/statusNormalizer';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

interface SearchParams {
  orderId?: string;
  corridor?: string;
  minimal_status?: MinimalOrderStatus;
  raw_status?: OrderStatus;
  merchant_id?: string;
  user_id?: string;
  buyer_merchant_id?: string;
}

async function searchOrders(params: SearchParams): Promise<Order[]> {
  let sql = `
    SELECT
      o.id,
      o.order_number,
      o.status,
      o.user_id,
      o.merchant_id,
      o.buyer_merchant_id,
      o.type,
      o.fiat_currency,
      o.crypto_currency,
      o.fiat_amount,
      o.crypto_amount,
      o.created_at,
      o.accepted_at,
      o.completed_at,
      o.cancelled_at,
      o.expires_at
    FROM orders o
    WHERE 1=1
  `;

  const queryParams: unknown[] = [];
  let paramIndex = 1;

  if (params.orderId) {
    sql += ` AND o.id::text ILIKE $${paramIndex}`;
    queryParams.push(`%${params.orderId}%`);
    paramIndex++;
  }

  if (params.corridor) {
    sql += ` AND o.fiat_currency = $${paramIndex}`;
    queryParams.push(params.corridor.toUpperCase());
    paramIndex++;
  }

  if (params.raw_status) {
    sql += ` AND o.status = $${paramIndex}`;
    queryParams.push(params.raw_status);
    paramIndex++;
  }

  if (params.merchant_id) {
    sql += ` AND o.merchant_id::text ILIKE $${paramIndex}`;
    queryParams.push(`%${params.merchant_id}%`);
    paramIndex++;
  }

  if (params.user_id) {
    sql += ` AND o.user_id::text ILIKE $${paramIndex}`;
    queryParams.push(`%${params.user_id}%`);
    paramIndex++;
  }

  if (params.buyer_merchant_id) {
    sql += ` AND o.buyer_merchant_id::text ILIKE $${paramIndex}`;
    queryParams.push(`%${params.buyer_merchant_id}%`);
    paramIndex++;
  }

  sql += ' ORDER BY o.created_at DESC LIMIT 50';

  const results = await query<Order>(sql, queryParams);
  return results;
}

async function OrdersList({ searchParams }: { searchParams: SearchParams }) {
  const orders = await searchOrders(searchParams);
  const debugKey = getDebugKey();

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-700">
        <thead className="bg-gray-800">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
              Order ID
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
              Order #
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
              Raw Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
              Minimal Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
              Type/Corridor
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
              Amount
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
              Created
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
              Participants
            </th>
          </tr>
        </thead>
        <tbody className="bg-gray-900 divide-y divide-gray-700">
          {orders.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                No orders found. Try adjusting your filters.
              </td>
            </tr>
          ) : (
            orders.map((order) => {
              const minimalStatus = normalizeStatus(order.status);
              const detailUrl = `/dev/orders/${order.id}${debugKey ? `?debug_key=${debugKey}` : ''}`;

              return (
                <tr key={order.id} className="hover:bg-gray-800">
                  <td className="px-4 py-3 text-sm">
                    <Link href={detailUrl} className="text-blue-400 hover:text-blue-300 font-mono">
                      {order.id.slice(0, 8)}...
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-300">
                    {order.order_number}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-gray-700 text-gray-200">
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="px-2 py-1 text-xs font-semibold rounded bg-blue-900 text-blue-200">
                      {minimalStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {order.type.toUpperCase()} / {order.fiat_currency}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {Number(order.fiat_amount).toFixed(2)} {order.fiat_currency}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">
                    {new Date(order.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400 font-mono text-xs">
                    U: {order.user_id.slice(0, 6)}...<br />
                    M: {order.merchant_id.slice(0, 6)}...
                    {order.buyer_merchant_id && (
                      <>
                        <br />
                        BM: {order.buyer_merchant_id.slice(0, 6)}...
                      </>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function DevOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // CRITICAL: Block in production
  if (!isDevEnvironment()) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-300">404</h1>
          <p className="text-gray-400 mt-2">Page not found</p>
        </div>
      </div>
    );
  }

  const params = await searchParams;
  const debugKey = getDebugKey();

  // Validate debug key
  if (debugKey && params.debug_key !== debugKey) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-300">404</h1>
          <p className="text-gray-400 mt-2">Page not found</p>
        </div>
      </div>
    );
  }

  const searchFilters: SearchParams = {
    orderId: typeof params.orderId === 'string' ? params.orderId : undefined,
    corridor: typeof params.corridor === 'string' ? params.corridor : undefined,
    minimal_status: typeof params.minimal_status === 'string' ? params.minimal_status as MinimalOrderStatus : undefined,
    raw_status: typeof params.raw_status === 'string' ? params.raw_status as OrderStatus : undefined,
    merchant_id: typeof params.merchant_id === 'string' ? params.merchant_id : undefined,
    user_id: typeof params.user_id === 'string' ? params.user_id : undefined,
    buyer_merchant_id: typeof params.buyer_merchant_id === 'string' ? params.buyer_merchant_id : undefined,
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-red-500 mb-2">
            🔧 DEV ONLY - Order Debug Panel
          </h1>
          <p className="text-gray-400 text-sm">
            Read-only order debugging interface. Not accessible in production.
          </p>
        </div>

        {/* Search Form */}
        <div className="bg-gray-900 rounded-lg p-6 mb-6 border border-gray-700">
          <h2 className="text-lg font-semibold mb-4 text-gray-200">Search & Filter Orders</h2>
          <form method="GET" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {debugKey && <input type="hidden" name="debug_key" value={debugKey} />}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Order ID (partial)
              </label>
              <input
                type="text"
                name="orderId"
                defaultValue={searchFilters.orderId}
                placeholder="Enter order ID..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Corridor (Currency)
              </label>
              <input
                type="text"
                name="corridor"
                defaultValue={searchFilters.corridor}
                placeholder="e.g., AED, USD"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Raw Status
              </label>
              <select
                name="raw_status"
                defaultValue={searchFilters.raw_status || ''}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">All</option>
                <option value="pending">pending</option>
                <option value="accepted">accepted</option>
                <option value="escrow_pending">escrow_pending</option>
                <option value="escrowed">escrowed</option>
                <option value="payment_pending">payment_pending</option>
                <option value="payment_sent">payment_sent</option>
                <option value="payment_confirmed">payment_confirmed</option>
                <option value="releasing">releasing</option>
                <option value="completed">completed</option>
                <option value="cancelled">cancelled</option>
                <option value="disputed">disputed</option>
                <option value="expired">expired</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                User ID (partial)
              </label>
              <input
                type="text"
                name="user_id"
                defaultValue={searchFilters.user_id}
                placeholder="Enter user ID..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Merchant ID (partial)
              </label>
              <input
                type="text"
                name="merchant_id"
                defaultValue={searchFilters.merchant_id}
                placeholder="Enter merchant ID..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Buyer Merchant ID
              </label>
              <input
                type="text"
                name="buyer_merchant_id"
                defaultValue={searchFilters.buyer_merchant_id}
                placeholder="Enter buyer merchant ID..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3 flex gap-2">
              <button
                type="submit"
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
              >
                Search
              </button>
              <a
                href={`/dev/orders${debugKey ? `?debug_key=${debugKey}` : ''}`}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded font-medium transition-colors"
              >
                Clear Filters
              </a>
            </div>
          </form>
        </div>

        {/* Results */}
        <div className="bg-gray-900 rounded-lg border border-gray-700">
          <div className="px-6 py-4 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-gray-200">Search Results (max 50)</h2>
          </div>
          <Suspense fallback={<div className="p-8 text-center text-gray-400">Loading...</div>}>
            <OrdersList searchParams={searchFilters} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
