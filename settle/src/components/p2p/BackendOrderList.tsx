'use client';

/**
 * BackendOrderList - Backend-driven order list.
 *
 * Displays orders with their backend-provided status, role, and action buttons.
 * NO role computation. NO status derivation. Pure rendering.
 */

import { useState, useMemo } from 'react';
import { Clock, ArrowUpDown, Filter } from 'lucide-react';
import { OrderStatusBadge } from './OrderStatusBadge';
import { OrderActionButtons } from './OrderActionButtons';
import type { BackendOrder, ActionType, OrderStatus } from '@/types/backendOrder';

interface BackendOrderListProps {
  orders: BackendOrder[];
  isLoading: boolean;
  onSelectOrder: (order: BackendOrder) => void;
  onAction: (orderId: string, action: ActionType) => Promise<void>;
  /** Currently selected order ID */
  selectedOrderId?: string;
  /** Show inline action buttons on each row */
  showInlineActions?: boolean;
  className?: string;
}

type SortField = 'created_at' | 'fiat_amount' | 'crypto_amount';
type FilterStatus = OrderStatus | 'all' | 'active';

const ACTIVE_STATUSES: OrderStatus[] = ['open', 'accepted', 'escrowed', 'payment_sent', 'disputed'];

export function BackendOrderList({
  orders,
  isLoading,
  onSelectOrder,
  onAction,
  selectedOrderId,
  showInlineActions = false,
  className = '',
}: BackendOrderListProps) {
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDesc, setSortDesc] = useState(true);

  const filteredOrders = useMemo(() => {
    let filtered = orders;

    // Filter
    if (filterStatus === 'active') {
      filtered = filtered.filter(o => ACTIVE_STATUSES.includes(o.status));
    } else if (filterStatus !== 'all') {
      filtered = filtered.filter(o => o.status === filterStatus);
    }

    // Sort
    return [...filtered].sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case 'fiat_amount':
          aVal = Number(a.fiat_amount);
          bVal = Number(b.fiat_amount);
          break;
        case 'crypto_amount':
          aVal = Number(a.crypto_amount);
          bVal = Number(b.crypto_amount);
          break;
        default:
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
      }
      return sortDesc ? bVal - aVal : aVal - bVal;
    });
  }, [orders, filterStatus, sortField, sortDesc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  const formatAmount = (amount: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getTimeAgo = (dateStr: string) => {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  if (isLoading && orders.length === 0) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <div className="animate-pulse text-zinc-500">Loading orders...</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Filters */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 overflow-x-auto">
        <Filter className="w-4 h-4 text-zinc-500 flex-shrink-0" />
        {(['all', 'active', 'open', 'escrowed', 'payment_sent', 'completed', 'cancelled'] as FilterStatus[]).map(status => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`
              px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors
              ${filterStatus === status
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }
            `}
          >
            {status === 'all' ? 'All' :
             status === 'active' ? 'Active' :
             status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
          </button>
        ))}
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-zinc-500">
        <button
          onClick={() => toggleSort('created_at')}
          className="flex items-center gap-1 hover:text-zinc-300"
        >
          <ArrowUpDown className="w-3 h-3" />
          Time {sortField === 'created_at' ? (sortDesc ? '(newest)' : '(oldest)') : ''}
        </button>
        <button
          onClick={() => toggleSort('fiat_amount')}
          className="flex items-center gap-1 hover:text-zinc-300"
        >
          Amount {sortField === 'fiat_amount' ? (sortDesc ? '(high)' : '(low)') : ''}
        </button>
        <span className="ml-auto">{filteredOrders.length} orders</span>
      </div>

      {/* Order list */}
      <div className="flex-1 overflow-y-auto">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <p className="text-sm">No orders found</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/50">
            {filteredOrders.map(order => (
              <div
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className={`
                  px-4 py-3 cursor-pointer transition-colors
                  ${selectedOrderId === order.id
                    ? 'bg-zinc-800/70 border-l-2 border-blue-500'
                    : 'hover:bg-zinc-800/30 border-l-2 border-transparent'
                  }
                `}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left side: order info */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${order.type === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                        {order.type === 'buy' ? 'BUY' : 'SELL'}
                      </span>
                      <OrderStatusBadge status={order.status} statusLabel={order.statusLabel} />
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        order.my_role === 'buyer' ? 'bg-blue-500/20 text-blue-400' :
                        order.my_role === 'seller' ? 'bg-green-500/20 text-green-400' :
                        'bg-zinc-500/20 text-zinc-400'
                      }`}>
                        {order.my_role}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {formatAmount(order.crypto_amount)} USDC
                      </span>
                      <span className="text-xs text-zinc-500">for</span>
                      <span className="text-sm font-semibold text-green-400">
                        {formatAmount(order.fiat_amount)} AED
                      </span>
                    </div>

                    {/* Next step text from backend */}
                    {order.nextStepText && !order.isTerminal && (
                      <p className="text-xs text-zinc-400 truncate">{order.nextStepText}</p>
                    )}
                  </div>

                  {/* Right side: time & unread */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-xs text-zinc-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {getTimeAgo(order.created_at)}
                    </span>
                    {(order.unread_count || 0) > 0 && (
                      <span className="w-5 h-5 bg-red-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
                        {order.unread_count}
                      </span>
                    )}
                  </div>
                </div>

                {/* Inline actions (optional) */}
                {showInlineActions && !order.isTerminal && order.primaryAction?.enabled && (
                  <div className="mt-2" onClick={e => e.stopPropagation()}>
                    <OrderActionButtons
                      orderId={order.id}
                      primaryAction={order.primaryAction}
                      secondaryAction={null}
                      onAction={onAction}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
