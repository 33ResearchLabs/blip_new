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
  walletStatus?: 'ok' | 'locked' | 'none';
  onAddWallet?: () => void;
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
  walletStatus,
  onAddWallet,
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
          walletStatus={walletStatus}
          onAddWallet={onAddWallet}
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
