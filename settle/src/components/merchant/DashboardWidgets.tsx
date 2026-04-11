'use client';

import { memo } from 'react';

import { StatusCard } from '@/components/merchant/StatusCard';

interface DashboardWidgetsProps {
  todayEarnings: number;
  completedOrders: number;
  cancelledOrders: number;
  balance: number;
  lockedInEscrow: number;
  isOnline: boolean;
  merchantId?: string;
  activeCorridor?: string;
  onCorridorChange?: (corridorId: string) => void;
  onToggleOnline?: () => void;
  onOpenCorridor?: () => void;
}

export const DashboardWidgets = memo(function DashboardWidgets({
  todayEarnings,
  completedOrders,
  cancelledOrders,
  balance,
  lockedInEscrow,
  isOnline,
  merchantId,
  activeCorridor,
  onCorridorChange,
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
          isOnline={isOnline}
          merchantId={merchantId}
          activeCorridor={activeCorridor}
          onCorridorChange={onCorridorChange}
          onToggleOnline={onToggleOnline}
          onOpenCorridor={onOpenCorridor}
        />
      </div>
    </div>
  );
});
