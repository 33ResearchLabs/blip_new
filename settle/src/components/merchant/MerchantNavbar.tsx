'use client';

import Link from 'next/link';
import { Zap, Wallet, Lock, LogOut } from 'lucide-react';

export type NavPage = 'dashboard' | 'analytics' | 'wallet' | 'settings';

interface MerchantNavbarProps {
  activePage: NavPage;
  merchantInfo?: {
    username?: string;
    display_name?: string;
    business_name?: string;
    avatar_url?: string | null;
  } | null;
  embeddedWalletState?: 'none' | 'locked' | 'unlocked';
  /** Extra buttons rendered before the profile section (e.g. tx history, payment methods) */
  rightActions?: React.ReactNode;
  onLogout?: () => void;
}

const pill = (active: boolean) =>
  active
    ? 'px-3 py-[5px] rounded-md text-[12px] font-medium bg-white/[0.08] text-white transition-colors'
    : 'px-3 py-[5px] rounded-md text-[12px] font-medium text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors';

export function MerchantNavbar({
  activePage,
  merchantInfo,
  embeddedWalletState,
  rightActions,
  onLogout,
}: MerchantNavbarProps) {
  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      localStorage.removeItem('blip_merchant');
      localStorage.removeItem('merchant_info');
      window.location.href = '/merchant';
    }
  };

  const initial = (merchantInfo?.username || merchantInfo?.display_name)?.charAt(0)?.toUpperCase() || '?';

  return (
    <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-2xl border-b border-white/[0.05]">
      <div className="h-11 md:h-[50px] flex items-center px-3 md:px-4 gap-3">
        {/* Left: Logo */}
        <div className="flex items-center shrink-0">
          <Link href="/merchant" className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-white fill-white" />
            <span className="text-[17px] leading-none whitespace-nowrap hidden lg:block">
              <span className="font-bold text-white">Blip</span>{' '}
              <span className="italic text-white/90">money</span>
            </span>
          </Link>
        </div>

        {/* Center: Nav pills — hidden on mobile (bottom nav handles it) */}
        <div className="hidden md:flex items-center gap-2 mx-auto">
          <nav className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-[3px]">
            <Link href="/merchant" className={pill(activePage === 'dashboard')}>
              Dashboard
            </Link>
            <Link href="/merchant/analytics" className={pill(activePage === 'analytics')}>
              Analytics
            </Link>
            <Link
              href="/merchant/wallet"
              className={`${pill(activePage === 'wallet')} flex items-center gap-1.5`}
            >
              {embeddedWalletState === 'unlocked' ? (
                <Wallet className="w-3.5 h-3.5 text-green-400" />
              ) : embeddedWalletState === 'locked' ? (
                <Lock className="w-3.5 h-3.5 text-orange-400" />
              ) : (
                <Wallet className="w-3.5 h-3.5" />
              )}
              Wallet
            </Link>
            <Link href="/merchant/settings" className={pill(activePage === 'settings')}>
              Settings
            </Link>
          </nav>
        </div>

        {/* Right: Actions + Profile + Logout */}
        <div className="flex items-center gap-2 shrink-0">
          {rightActions}

          {rightActions && <div className="w-px h-6 bg-white/[0.06] mx-0.5" />}

          <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-[12px] overflow-hidden">
            {merchantInfo?.avatar_url ? (
              <img src={merchantInfo.avatar_url} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <span className="text-white/60">{initial}</span>
            )}
          </div>
          <span className="hidden sm:block text-[12px] font-medium text-white/60">
            {merchantInfo?.username || merchantInfo?.display_name || merchantInfo?.business_name || 'Merchant'}
          </span>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
            title="Logout"
          >
            <LogOut className="w-[18px] h-[18px] text-white/30 hover:text-red-400" />
          </button>
        </div>
      </div>
    </header>
  );
}
