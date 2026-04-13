'use client';

/**
 * Live countdown timer showing time remaining for the current order action.
 *
 * Shows context-aware messages:
 *  - accepted:     "Xh Xm to lock escrow"
 *  - escrowed:     "Xh Xm to send payment"
 *  - payment_sent: "Xh Xm for confirmation"
 *  - disputed:     "Xh Xm to resolve"
 *
 * Used on BOTH user and merchant order detail screens.
 * Turns red under 5 minutes. Shows clock icon when urgent.
 */

import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface OrderExpiryTimerProps {
  expiresAt: Date | string;
  /** Current order status — drives the contextual label */
  status?: string;
  /** Who is viewing: determines the action label perspective */
  viewerRole?: 'buyer' | 'seller';
  /** Compact mode: just the time, no label */
  compact?: boolean;
}

function getActionLabel(status: string | undefined, role: string | undefined): string {
  switch (status) {
    case 'accepted':
      return role === 'seller' ? 'to lock escrow' : 'for escrow';
    case 'escrowed':
      return role === 'buyer' ? 'to send payment' : 'for payment';
    case 'payment_sent':
    case 'payment_confirmed':
      return role === 'seller' ? 'to confirm' : 'for confirmation';
    case 'disputed':
      return 'to resolve';
    default:
      return 'remaining';
  }
}

export function OrderExpiryTimer({
  expiresAt,
  status,
  viewerRole,
  compact = false,
}: OrderExpiryTimerProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const expiresMs = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt.getTime();
  const diffSec = Math.max(0, Math.floor((expiresMs - now) / 1000));

  if (diffSec <= 0) {
    return <span className="text-[12px] font-mono font-bold text-error">Time&apos;s up</span>;
  }

  const hrs = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  const isUrgent = diffSec < 300;
  const color = isUrgent ? 'text-error' : 'text-text-tertiary';

  const timeStr = hrs > 0
    ? `${hrs}h ${mins}m ${secs}s`
    : mins > 0
      ? `${mins}m ${secs}s`
      : `${secs}s`;

  const label = compact ? '' : ` ${getActionLabel(status, viewerRole)}`;

  return (
    <span className={`text-[12px] font-mono font-medium ${color} flex items-center gap-1`}>
      {isUrgent && <Clock className="w-3 h-3 shrink-0" />}
      {timeStr}{label}
    </span>
  );
}
