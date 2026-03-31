'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Zap, Wallet, Lock, LogOut, User, Settings, ChevronDown, Activity, Shield } from 'lucide-react';

export type NavPage = 'dashboard' | 'wallet' | 'settings' | 'ops';

interface MerchantNavbarProps {
  activePage: NavPage;
  merchantInfo?: {
    username?: string;
    display_name?: string;
    business_name?: string;
    avatar_url?: string | null;
    has_ops_access?: boolean;
    has_compliance_access?: boolean;
  } | null;
  embeddedWalletState?: 'initializing' | 'none' | 'locked' | 'unlocked';
  /** Extra buttons rendered before the profile section (e.g. tx history, payment methods) */
  rightActions?: React.ReactNode;
  onLogout?: () => void;
  onOpenProfile?: () => void;
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
  onOpenProfile,
}: MerchantNavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleLogout = () => {
    setMenuOpen(false);
    if (onLogout) {
      onLogout();
    } else {
      localStorage.removeItem('blip_merchant');
      localStorage.removeItem('merchant_info');
      window.location.href = '/merchant';
    }
  };

  const initial = (merchantInfo?.username || merchantInfo?.display_name)?.charAt(0)?.toUpperCase() || '?';
  const displayName = merchantInfo?.username || merchantInfo?.display_name || merchantInfo?.business_name || 'Merchant';

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
            <Link
              href="/merchant/wallet"
              className={`${pill(activePage === 'wallet')} flex items-center gap-1.5`}
            >
              {embeddedWalletState === 'unlocked' ? (
                <Wallet className="w-3.5 h-3.5 text-green-400" />
              ) : embeddedWalletState === 'locked' ? (
                <Lock className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Wallet className="w-3.5 h-3.5" />
              )}
              Wallet
            </Link>
            <Link href="/merchant/settings" className={pill(activePage === 'settings')}>
              Settings
            </Link>
            {merchantInfo?.has_ops_access && (
              <Link
                href="/ops"
                className={`${pill(activePage === 'ops')} flex items-center gap-1.5`}
              >
                <Activity className="w-3.5 h-3.5 text-primary" />
                Ops
              </Link>
            )}
            {merchantInfo?.has_compliance_access && (
              <Link
                href="/compliance"
                className={`${pill(activePage === 'compliance' as NavPage)} flex items-center gap-1.5`}
              >
                <Shield className="w-3.5 h-3.5 text-purple-400" />
                Compliance
              </Link>
            )}
          </nav>
        </div>

        {/* Right: Actions + Avatar dropdown */}
        <div className="flex items-center gap-2 shrink-0">
          {rightActions}

          {rightActions && <div className="w-px h-6 bg-white/[0.06] mx-0.5" />}

          {/* Avatar button with dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(prev => !prev)}
              className={`flex items-center gap-1.5 p-1 pr-2 rounded-full transition-colors ${
                menuOpen
                  ? 'bg-white/[0.08] ring-1 ring-white/[0.12]'
                  : 'hover:bg-white/[0.06]'
              }`}
            >
              <div className="relative w-7 h-7 rounded-full border border-white/10 flex items-center justify-center text-[11px] overflow-hidden bg-white/[0.04]">
                {merchantInfo?.avatar_url ? (
                  <img src={merchantInfo.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-semibold text-white/70">{initial}</span>
                )}
              </div>
              <ChevronDown className={`w-3 h-3 text-white/30 transition-transform hidden sm:block ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown menu */}
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-white/[0.08] bg-card-solid shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 z-[60]">
                {/* User info header */}
                <div className="px-3 py-2.5 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2.5">
                    <div className="relative w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-[13px] overflow-hidden bg-white/[0.04] shrink-0">
                      {merchantInfo?.avatar_url ? (
                        <img src={merchantInfo.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <span className="font-semibold text-white/70">{initial}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-medium text-white truncate">{displayName}</p>
                      {merchantInfo?.business_name && merchantInfo.business_name !== displayName && (
                        <p className="text-[10px] text-white/40 truncate">{merchantInfo.business_name}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Menu items */}
                <div className="py-1">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenProfile?.();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <User className="w-4 h-4" />
                    Edit Profile
                  </button>
                  <Link
                    href="/merchant/wallet"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <Wallet className="w-4 h-4" />
                    Wallet
                  </Link>
                  <Link
                    href="/merchant/settings"
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Settings
                  </Link>
                  {merchantInfo?.has_ops_access && (
                    <Link
                      href="/ops"
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-primary/70 hover:text-primary hover:bg-primary/[0.06] transition-colors"
                    >
                      <Activity className="w-4 h-4" />
                      Ops Panel
                    </Link>
                  )}
                  {merchantInfo?.has_compliance_access && (
                    <Link
                      href="/compliance"
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/[0.06] transition-colors"
                    >
                      <Shield className="w-4 h-4" />
                      Compliance
                    </Link>
                  )}
                </div>

                {/* Logout */}
                <div className="border-t border-white/[0.06] py-1">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-red-400/70 hover:text-red-400 hover:bg-red-500/[0.06] transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
