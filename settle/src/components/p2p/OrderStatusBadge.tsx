'use client';

/**
 * OrderStatusBadge - Renders order status from backend statusLabel.
 *
 * No status computation. Displays exactly what the backend sends.
 */

import type { OrderStatus } from '@/types/backendOrder';

interface OrderStatusBadgeProps {
  status: OrderStatus;
  statusLabel: string;
}

const STATUS_STYLES: Record<OrderStatus, { bg: string; text: string; border: string }> = {
  open: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  accepted: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  escrowed: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30' },
  payment_sent: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  completed: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  expired: { bg: 'bg-zinc-500/20', text: 'text-zinc-400', border: 'border-zinc-500/30' },
  disputed: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
};

export function OrderStatusBadge({ status, statusLabel }: OrderStatusBadgeProps) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.open;

  return (
    <span
      className={`
        inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold
        border ${style.bg} ${style.text} ${style.border}
      `}
    >
      {statusLabel}
    </span>
  );
}
