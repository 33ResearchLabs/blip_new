"use client";

import { Bell } from "lucide-react";

interface MobileStatsBarProps {
  effectiveBalance: number | null;
  totalTradedVolume: number;
  showNotifications: boolean;
  setShowNotifications: (show: boolean) => void;
  setShowWalletModal: (show: boolean) => void;
  notifications: { read: boolean }[];
}

export function MobileStatsBar({
  effectiveBalance,
  totalTradedVolume,
  showNotifications,
  setShowNotifications,
  setShowWalletModal,
  notifications,
}: MobileStatsBarProps) {
  return (
    <div className="md:hidden flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
      {/* USDT Balance */}
      <button
        onClick={() => setShowWalletModal(true)}
        className="flex items-center gap-1 px-2 py-1 bg-white/[0.04] rounded-md border border-white/[0.08] shrink-0"
      >
        <span className="text-[11px] font-mono text-white/70">
          {effectiveBalance !== null
            ? `${effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
            : "—"}
        </span>
      </button>

      {/* Volume */}
      <div className="flex items-center gap-1 px-2 py-1 bg-white/[0.03] rounded-md shrink-0">
        <span className="text-[10px] font-mono text-gray-400">${totalTradedVolume.toLocaleString()}</span>
      </div>

      <div className="flex-1" />

      {/* Notifications */}
      <button
        onClick={() => setShowNotifications(!showNotifications)}
        className="relative p-2.5 bg-white/[0.04] rounded-md shrink-0"
      >
        <Bell className="w-4 h-4 text-gray-400" />
        {notifications.filter(n => !n.read).length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 rounded-full text-[9px] font-bold flex items-center justify-center text-white">
            {notifications.filter(n => !n.read).length}
          </span>
        )}
      </button>
    </div>
  );
}
