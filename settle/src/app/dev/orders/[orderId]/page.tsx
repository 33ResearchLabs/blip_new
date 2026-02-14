/**
 * DEV-ONLY Order Debug Panel - Detail View
 *
 * Comprehensive order debugging with all relevant information.
 * IMPORTANT: This page is ONLY accessible in non-production environments.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isDevEnvironment, getDebugKey } from '@/lib/debugAuth';
import { query, queryOne } from '@/lib/db';
import { Order, OrderEvent } from '@/lib/types/database';
import { normalizeStatus, isTransientStatus } from '@/lib/orders/statusNormalizer';
import { MOCK_MODE } from '@/lib/config/mockMode';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

async function getOrderDetails(orderId: string) {
  const order = await queryOne<Order>(
    'SELECT * FROM orders WHERE id = $1',
    [orderId]
  );

  if (!order) return null;

  const events = await query<OrderEvent>(
    `SELECT * FROM order_events
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT 30`,
    [orderId]
  );

  return { order, events };
}

function calculateTimeRemaining(expiresAt: Date | null): string {
  if (!expiresAt) return 'No expiry set';

  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffMs = expiry.getTime() - now.getTime();

  if (diffMs <= 0) return 'EXPIRED';

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h remaining`;
  if (hours > 0) return `${hours}h ${minutes % 60}m remaining`;
  return `${minutes}m remaining`;
}

function checkDiagnostics(order: Order, events: OrderEvent[]): Record<string, boolean | string> {
  const diagnostics: Record<string, boolean | string> = {};

  // Check for micro-statuses
  diagnostics['has_micro_status'] = isTransientStatus(order.status);

  // Check if terminal status has no further transitions
  const terminalStatuses = ['completed', 'cancelled', 'expired'];
  if (terminalStatuses.includes(order.status)) {
    const eventsAfterTerminal = events.filter(
      (e) => e.new_status && !terminalStatuses.includes(e.new_status)
    );
    diagnostics['terminal_is_final'] = eventsAfterTerminal.length === 0;
  } else {
    diagnostics['terminal_is_final'] = 'N/A (not terminal)';
  }

  // Basic timestamp checks
  diagnostics['has_created_at'] = !!order.created_at;
  diagnostics['has_accepted_at'] = order.status === 'pending' ? 'N/A' : !!order.accepted_at;

  // Check escrow fields in MOCK_MODE
  if (MOCK_MODE) {
    diagnostics['has_escrow_tx'] = !!order.escrow_tx_hash;
    diagnostics['has_release_tx'] = order.status === 'completed' ? !!order.release_tx_hash : 'N/A';
  }

  return diagnostics;
}

export default async function DevOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // CRITICAL: Block in production
  if (!isDevEnvironment()) {
    notFound();
  }

  const { orderId } = await params;
  const queryParams = await searchParams;
  const debugKey = getDebugKey();

  // Validate debug key
  if (debugKey && queryParams.debug_key !== debugKey) {
    notFound();
  }

  const data = await getOrderDetails(orderId);
  if (!data) {
    notFound();
  }

  const { order, events } = data;
  const minimalStatus = normalizeStatus(order.status);
  const diagnostics = checkDiagnostics(order, events);
  const timeRemaining = calculateTimeRemaining(order.expires_at);

  const backUrl = `/dev/orders${debugKey ? `?debug_key=${debugKey}` : ''}`;

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            href={backUrl}
            className="text-blue-400 hover:text-blue-300 text-sm mb-3 inline-block"
          >
            ← Back to Search
          </Link>
          <h1 className="text-3xl font-bold text-red-500 mb-2">
            🔧 Order Debug View
          </h1>
          <p className="text-gray-400 text-sm font-mono">
            Order ID: {order.id}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* A) Order Summary */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-yellow-400">A) Order Summary</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-400">Order Number</dt>
                <dd className="font-mono text-white">{order.order_number}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Raw Status (DB)</dt>
                <dd>
                  <span className="px-2 py-1 text-xs font-semibold rounded bg-gray-700 text-gray-200">
                    {order.status}
                  </span>
                  {isTransientStatus(order.status) && (
                    <span className="ml-2 text-orange-400 text-xs">⚠ Transient/micro-status</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Minimal Status (API)</dt>
                <dd>
                  <span className="px-2 py-1 text-xs font-semibold rounded bg-blue-900 text-blue-200">
                    {minimalStatus}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Type / Side</dt>
                <dd className="text-white">{order.type.toUpperCase()}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Corridor / Fiat Currency</dt>
                <dd className="text-white">{order.fiat_currency}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Amount</dt>
                <dd className="text-white">
                  {Number(order.crypto_amount).toFixed(6)} {order.crypto_currency} ≈{' '}
                  {Number(order.fiat_amount).toFixed(2)} {order.fiat_currency}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Rate</dt>
                <dd className="text-white">{Number(order.rate).toFixed(2)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Platform Fee</dt>
                <dd className="text-white">{Number(order.platform_fee).toFixed(6)} {order.crypto_currency}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Network Fee</dt>
                <dd className="text-white">{Number(order.network_fee).toFixed(6)} {order.crypto_currency}</dd>
              </div>
              <div className="pt-3 border-t border-gray-700">
                <dt className="text-gray-400">Created At</dt>
                <dd className="text-white">{new Date(order.created_at).toLocaleString()}</dd>
              </div>
              {order.accepted_at && (
                <div>
                  <dt className="text-gray-400">Accepted At</dt>
                  <dd className="text-white">{new Date(order.accepted_at).toLocaleString()}</dd>
                </div>
              )}
              {order.expires_at && (
                <div>
                  <dt className="text-gray-400">Expires At</dt>
                  <dd className="text-white">
                    {new Date(order.expires_at).toLocaleString()}
                    <span className="ml-2 text-yellow-400">({timeRemaining})</span>
                  </dd>
                </div>
              )}
              {order.completed_at && (
                <div>
                  <dt className="text-gray-400">Completed At</dt>
                  <dd className="text-white">{new Date(order.completed_at).toLocaleString()}</dd>
                </div>
              )}
              {order.cancelled_at && (
                <div>
                  <dt className="text-gray-400">Cancelled At</dt>
                  <dd className="text-white">{new Date(order.cancelled_at).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* B) Participants */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-green-400">B) Participants</h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-400">User ID</dt>
                <dd className="font-mono text-white break-all">{order.user_id}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Merchant ID</dt>
                <dd className="font-mono text-white break-all">{order.merchant_id}</dd>
              </div>
              {order.buyer_merchant_id && (
                <div>
                  <dt className="text-gray-400">Buyer Merchant ID (M2M)</dt>
                  <dd className="font-mono text-white break-all">{order.buyer_merchant_id}</dd>
                </div>
              )}
              <div>
                <dt className="text-gray-400">Offer ID</dt>
                <dd className="font-mono text-white break-all">{order.offer_id}</dd>
              </div>
              {order.buyer_wallet_address && (
                <div className="pt-3 border-t border-gray-700">
                  <dt className="text-gray-400">Buyer Wallet Address</dt>
                  <dd className="font-mono text-white break-all text-xs">{order.buyer_wallet_address}</dd>
                </div>
              )}
              {order.acceptor_wallet_address && (
                <div>
                  <dt className="text-gray-400">Acceptor Wallet Address</dt>
                  <dd className="font-mono text-white break-all text-xs">{order.acceptor_wallet_address}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* C) Escrow / Mock Balances */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-purple-400">
              C) Escrow {MOCK_MODE && '(MOCK MODE)'}
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-gray-400">Escrow TX Hash</dt>
                <dd className="font-mono text-white break-all text-xs">
                  {order.escrow_tx_hash || <span className="text-gray-500">None</span>}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Escrow Address</dt>
                <dd className="font-mono text-white break-all text-xs">
                  {order.escrow_address || <span className="text-gray-500">None</span>}
                </dd>
              </div>
              {order.escrow_trade_id && (
                <div>
                  <dt className="text-gray-400">Escrow Trade ID</dt>
                  <dd className="font-mono text-white">{order.escrow_trade_id}</dd>
                </div>
              )}
              {order.escrow_trade_pda && (
                <div>
                  <dt className="text-gray-400">Escrow Trade PDA</dt>
                  <dd className="font-mono text-white break-all text-xs">{order.escrow_trade_pda}</dd>
                </div>
              )}
              {order.escrow_pda && (
                <div>
                  <dt className="text-gray-400">Escrow PDA</dt>
                  <dd className="font-mono text-white break-all text-xs">{order.escrow_pda}</dd>
                </div>
              )}
              {order.escrow_creator_wallet && (
                <div>
                  <dt className="text-gray-400">Escrow Creator Wallet</dt>
                  <dd className="font-mono text-white break-all text-xs">{order.escrow_creator_wallet}</dd>
                </div>
              )}
              <div className="pt-3 border-t border-gray-700">
                <dt className="text-gray-400">Release TX Hash</dt>
                <dd className="font-mono text-white break-all text-xs">
                  {order.release_tx_hash || <span className="text-gray-500">None</span>}
                </dd>
              </div>
              <div>
                <dt className="text-gray-400">Refund TX Hash</dt>
                <dd className="font-mono text-white break-all text-xs">
                  {order.refund_tx_hash || <span className="text-gray-500">None</span>}
                </dd>
              </div>
            </dl>
          </div>

          {/* E) Diagnostics */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-red-400">E) Diagnostics</h2>
            <dl className="space-y-3 text-sm">
              {Object.entries(diagnostics).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-gray-400 capitalize">{key.replace(/_/g, ' ')}</dt>
                  <dd>
                    {typeof value === 'boolean' ? (
                      value ? (
                        <span className="text-green-400">✓ Yes</span>
                      ) : (
                        <span className="text-red-400">✗ No</span>
                      )
                    ) : (
                      <span className="text-gray-300">{value}</span>
                    )}
                  </dd>
                </div>
              ))}
              <div className="pt-3 border-t border-gray-700">
                <dt className="text-gray-400">Payment Method</dt>
                <dd className="text-white">{order.payment_method}</dd>
              </div>
              {order.extension_count > 0 && (
                <>
                  <div>
                    <dt className="text-gray-400">Extension Count</dt>
                    <dd className="text-white">
                      {order.extension_count} / {order.max_extensions}
                    </dd>
                  </div>
                  {order.extension_requested_by && (
                    <div>
                      <dt className="text-gray-400">Last Extension Requested By</dt>
                      <dd className="text-white">{order.extension_requested_by}</dd>
                    </div>
                  )}
                </>
              )}
              <div>
                <dt className="text-gray-400">Has Manual Message</dt>
                <dd>
                  {order.has_manual_message ? (
                    <span className="text-green-400">✓ Yes</span>
                  ) : (
                    <span className="text-gray-400">No</span>
                  )}
                </dd>
              </div>
              {order.assigned_compliance_id && (
                <div>
                  <dt className="text-gray-400">Assigned Compliance ID</dt>
                  <dd className="font-mono text-white text-xs">{order.assigned_compliance_id}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* D) Order Events (Full Width) */}
        <div className="mt-6 bg-gray-900 rounded-lg p-6 border border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-cyan-400">D) Order Events (Last 30)</h2>
          {events.length === 0 ? (
            <p className="text-gray-400">No events recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                      Timestamp
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                      Event Type
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                      Transition
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                      Actor
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">
                      Metadata
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {events.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-800">
                      <td className="px-3 py-2 text-xs text-gray-300">
                        {new Date(event.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="px-2 py-1 rounded bg-gray-700 text-gray-200">
                          {event.event_type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-gray-300">
                        {event.old_status || 'null'} → {event.new_status || 'null'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-300">
                        <div>{event.actor_type}</div>
                        {event.actor_id && (
                          <div className="font-mono text-gray-500 text-[10px]">
                            {event.actor_id.slice(0, 8)}...
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400 max-w-xs">
                        {event.metadata ? (
                          <pre className="text-[10px] overflow-auto max-h-20">
                            {JSON.stringify(event.metadata, null, 2)}
                          </pre>
                        ) : (
                          <span className="text-gray-600">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Payment Details (if exists) */}
        {order.payment_details && (
          <div className="mt-6 bg-gray-900 rounded-lg p-6 border border-gray-700">
            <h2 className="text-xl font-semibold mb-4 text-orange-400">Payment Details</h2>
            <pre className="text-xs text-gray-300 overflow-auto">
              {JSON.stringify(order.payment_details, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
