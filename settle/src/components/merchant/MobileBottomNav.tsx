"use client";

import {
  House,
  Pulse,
  ChatCircle,
  Sparkle,
  ClockCounterClockwise,
} from "@phosphor-icons/react";

export interface MobileBottomNavProps {
  mobileView: 'home' | 'orders' | 'escrow' | 'chat' | 'history' | 'marketplace';
  setMobileView: (view: 'home' | 'orders' | 'escrow' | 'chat' | 'history' | 'marketplace') => void;
  pendingCount: number;
  ongoingCount: number;
  totalUnread: number;
}

export function MobileBottomNav({
  mobileView,
  setMobileView,
  pendingCount,
  ongoingCount,
  totalUnread,
}: MobileBottomNavProps) {
  const tabs = [
    {
      id: 'home' as const,
      label: 'Home',
      icon: House,
      badge: 0,
    },
    {
      id: 'orders' as const,
      label: 'New Order',
      icon: Sparkle,
      badge: pendingCount,
    },
    {
      id: 'escrow' as const,
      label: 'Active Order',
      icon: Pulse,
      badge: ongoingCount,
    },
    {
      id: 'chat' as const,
      label: 'Chat',
      icon: ChatCircle,
      badge: totalUnread,
    },
    {
      id: 'history' as const,
      label: 'History',
      icon: ClockCounterClockwise,
      badge: 0,
    },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-background/95 backdrop-blur-sm border-t border-foreground/[0.06] px-1 py-1.5 pb-safe z-50">
      <div className="flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = mobileView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setMobileView(tab.id)}
              className={`flex flex-col items-center gap-1 px-2 py-2 min-w-[64px] rounded-xl transition-all ${
                isActive ? 'bg-foreground/[0.08]' : ''
              }`}
            >
              <div className="relative">
                <Icon weight={isActive ? "regular" : "thin"} className={`w-[26px] h-[26px] ${isActive ? 'text-foreground' : 'text-foreground/30'}`} />
                {tab.badge > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-[18px] h-[18px] bg-[#f5f5f7] text-background text-[10px] font-bold rounded-full flex items-center justify-center">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[12px] font-medium ${isActive ? 'text-foreground' : 'text-foreground/30'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
