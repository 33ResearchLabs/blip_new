"use client";

import {
  Home,
  Activity,
  MessageCircle,
  Sparkles,
  History,
} from "lucide-react";

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
      icon: Home,
      badge: 0,
    },
    {
      id: 'orders' as const,
      label: 'New Order',
      icon: Sparkles,
      badge: pendingCount,
    },
    {
      id: 'escrow' as const,
      label: 'Active Order',
      icon: Activity,
      badge: ongoingCount,
    },
    {
      id: 'chat' as const,
      label: 'Chat',
      icon: MessageCircle,
      badge: totalUnread,
    },
    {
      id: 'history' as const,
      label: 'History',
      icon: History,
      badge: 0,
    },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-background/95 backdrop-blur-sm border-t border-foreground/[0.06] px-1 py-1.5 pb-safe z-50">
      <div className="flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = mobileView === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setMobileView(tab.id)}
              className={`flex flex-col items-center gap-0.5 px-2 py-2 min-w-[56px] rounded-xl transition-all ${
                isActive ? 'bg-foreground/[0.08]' : ''
              }`}
            >
              <div className="relative">
                <Icon className={`w-[22px] h-[22px] ${isActive ? 'text-foreground' : 'text-foreground/30'}`} />
                {tab.badge > 0 && (
                  <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-primary text-background text-[10px] font-bold rounded-full flex items-center justify-center">
                    {tab.badge > 9 ? '9+' : tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-medium ${isActive ? 'text-foreground' : 'text-foreground/30'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
