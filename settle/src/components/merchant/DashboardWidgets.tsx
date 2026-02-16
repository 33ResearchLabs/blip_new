'use client';

import { memo } from 'react';

import { StatusCard } from '@/components/merchant/StatusCard';

interface DashboardWidgetsProps {
  todayEarnings: number;
  completedOrders: number;
  cancelledOrders: number;
  avgResponseMins: number;
  rank: number;
  balance: number;
  lockedInEscrow: number;
  isOnline: boolean;
  merchantId?: string;
  onToggleOnline?: () => void;
  onOpenCorridor?: () => void;
}

export const DashboardWidgets = memo(function DashboardWidgets({
  todayEarnings,
  completedOrders,
  cancelledOrders,
  avgResponseMins,
  rank,
  balance,
  lockedInEscrow,
  isOnline,
  merchantId,
  onToggleOnline,
  onOpenCorridor,
}: DashboardWidgetsProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <StatusCard
          balance={balance}
          lockedInEscrow={lockedInEscrow}
          todayEarnings={todayEarnings}
          completedOrders={completedOrders}
          cancelledOrders={cancelledOrders}
          rank={rank}
          isOnline={isOnline}
          merchantId={merchantId}
          onToggleOnline={onToggleOnline}
          onOpenCorridor={onOpenCorridor}
        />
      </div>
    </div>
  );
});
