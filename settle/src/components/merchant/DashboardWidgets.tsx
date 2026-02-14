'use client';

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
}

export function DashboardWidgets({
  todayEarnings,
  completedOrders,
  cancelledOrders,
  avgResponseMins,
  rank,
  balance,
  lockedInEscrow,
  isOnline,
}: DashboardWidgetsProps) {
  return (
    <div className="mb-3 px-4">
      <StatusCard
        balance={balance}
        lockedInEscrow={lockedInEscrow}
        todayEarnings={todayEarnings}
        completedOrders={completedOrders}
        cancelledOrders={cancelledOrders}
        rank={rank}
        isOnline={isOnline}
      />
    </div>
  );
}
