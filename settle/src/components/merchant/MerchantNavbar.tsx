'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Wallet, Lock, LogOut, User, Settings, ChevronDown, Activity, Shield,
  Menu, X, Bell, BarChart3,
} from 'lucide-react';

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
  rightActions?: React.ReactNode;
  onLogout?: () => void;
  onOpenProfile?: () => void;
  notificationCount?: number;
  onOpenNotifications?: () => void;
}

const pill = (active: boolean) =>
  active
    ? 'px-3 py-[5px] rounded-md text-[12px] font-medium bg-foreground/[0.08] text-foreground transition-colors'
    : 'px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.04] transition-colors';

export function MerchantNavbar({
  activePage,
  merchantInfo,
  embeddedWalletState,
  rightActions,
  onLogout,
  onOpenProfile,
  notificationCount = 0,
  onOpenNotifications,
}: MerchantNavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close desktop dropdown on outside click
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

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  const handleLogout = () => {
    setMenuOpen(false);
    setDrawerOpen(false);
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
    <>
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-2xl border-b border-border-strong">
        <div className="h-12 md:h-[50px] flex items-center px-3 md:px-4 gap-3">
          {/* Left: Logo — always visible */}
          <div className="flex items-center shrink-0">
            <Link href="/merchant" className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary fill-primary" />
              <span className="text-[17px] leading-none whitespace-nowrap">
                <span className="font-bold text-foreground">Blip</span>{' '}
                <span className="italic text-foreground/80">money</span>
              </span>
            </Link>
          </div>

          {/* Center: Nav pills — desktop only */}
          <div className="hidden md:flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-foreground/[0.03] rounded-lg p-[3px]">
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

          {/* Right: Desktop — Avatar dropdown | Mobile — Notification + Hamburger */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Desktop: rightActions + avatar dropdown */}
            <div className="hidden md:flex items-center gap-2">
              {rightActions}
              {rightActions && <div className="w-px h-6 bg-foreground/[0.06] mx-0.5" />}

              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(prev => !prev)}
                  className={`flex items-center gap-1.5 p-1 pr-2 rounded-full transition-colors ${
                    menuOpen ? 'bg-foreground/[0.08] ring-1 ring-foreground/[0.12]' : 'hover:bg-foreground/[0.06]'
                  }`}
                >
                  <div className="relative w-7 h-7 rounded-full border border-foreground/10 flex items-center justify-center text-[11px] overflow-hidden bg-foreground/[0.04]">
                    {merchantInfo?.avatar_url ? (
                      <img src={merchantInfo.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <span className="font-semibold text-foreground/70">{initial}</span>
                    )}
                  </div>
                  <ChevronDown className={`w-3 h-3 text-foreground/30 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-foreground/[0.08] bg-card-solid shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 z-[60]">
                    <div className="px-3 py-2.5 border-b border-foreground/[0.06]">
                      <div className="flex items-center gap-2.5">
                        <div className="relative w-9 h-9 rounded-full border border-foreground/10 flex items-center justify-center text-[13px] overflow-hidden bg-foreground/[0.04] shrink-0">
                          {merchantInfo?.avatar_url ? (
                            <img src={merchantInfo.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                          ) : (
                            <span className="font-semibold text-foreground/70">{initial}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-foreground truncate">{displayName}</p>
                          {merchantInfo?.business_name && merchantInfo.business_name !== displayName && (
                            <p className="text-[10px] text-foreground/40 truncate">{merchantInfo.business_name}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="py-1">
                      <button onClick={() => { setMenuOpen(false); onOpenProfile?.(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors">
                        <User className="w-4 h-4" /> Edit Profile
                      </button>
                      <Link href="/merchant/wallet" onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors">
                        <Wallet className="w-4 h-4" /> Wallet
                      </Link>
                      <Link href="/merchant/settings" onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors">
                        <Settings className="w-4 h-4" /> Settings
                      </Link>
                      {merchantInfo?.has_ops_access && (
                        <Link href="/ops" onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-primary/70 hover:text-primary hover:bg-primary/[0.06] transition-colors">
                          <Activity className="w-4 h-4" /> Ops Panel
                        </Link>
                      )}
                      {merchantInfo?.has_compliance_access && (
                        <Link href="/compliance" onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/[0.06] transition-colors">
                          <Shield className="w-4 h-4" /> Compliance
                        </Link>
                      )}
                    </div>
                    <div className="border-t border-foreground/[0.06] py-1">
                      <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-red-400/70 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/[0.06] transition-colors">
                        <LogOut className="w-4 h-4" /> Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Mobile: Notification bell + Hamburger */}
            <div className="flex md:hidden items-center gap-1">
              {onOpenNotifications && (
                <button onClick={onOpenNotifications} className="relative p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors">
                  <Bell className="w-5 h-5 text-foreground/50" />
                  {notificationCount > 0 && (
                    <span className="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full text-[9px] font-bold flex items-center justify-center text-white">
                      {notificationCount > 9 ? '9+' : notificationCount}
                    </span>
                  )}
                </button>
              )}
              <button
                onClick={() => setDrawerOpen(true)}
                className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors"
              >
                <Menu className="w-5 h-5 text-foreground/70" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Mobile Drawer ── */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] md:hidden"
              onClick={() => setDrawerOpen(false)}
            />
            {/* Drawer panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 w-[280px] bg-card-solid border-l border-foreground/[0.06] z-[61] md:hidden flex flex-col"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between p-4 border-b border-foreground/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full border border-foreground/10 flex items-center justify-center text-sm overflow-hidden bg-foreground/[0.04]">
                    {merchantInfo?.avatar_url ? (
                      <img src={merchantInfo.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <span className="font-semibold text-foreground/70">{initial}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
                    {merchantInfo?.business_name && merchantInfo.business_name !== displayName && (
                      <p className="text-[11px] text-foreground/40 truncate">{merchantInfo.business_name}</p>
                    )}
                  </div>
                </div>
                <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-foreground/[0.06] transition-colors">
                  <X className="w-5 h-5 text-foreground/40" />
                </button>
              </div>

              {/* Drawer menu items */}
              <div className="flex-1 overflow-y-auto py-2">
                <Link href="/merchant" onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors">
                  <Zap className="w-5 h-5" /> Dashboard
                </Link>
                <Link href="/merchant/wallet" onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors">
                  <Wallet className="w-5 h-5" /> Wallet
                </Link>
                <Link href="/merchant/analytics" onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors">
                  <BarChart3 className="w-5 h-5" /> Analytics
                </Link>
                <Link href="/merchant/settings" onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors">
                  <Settings className="w-5 h-5" /> Settings
                </Link>
                <button onClick={() => { setDrawerOpen(false); onOpenProfile?.(); }} className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors">
                  <User className="w-5 h-5" /> Edit Profile
                </button>

                {merchantInfo?.has_ops_access && (
                  <>
                    <div className="mx-4 my-2 border-t border-foreground/[0.06]" />
                    <Link href="/ops" onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-primary/70 hover:text-primary hover:bg-primary/[0.04] transition-colors">
                      <Activity className="w-5 h-5" /> Ops Panel
                    </Link>
                  </>
                )}
                {merchantInfo?.has_compliance_access && (
                  <Link href="/compliance" onClick={() => setDrawerOpen(false)} className="flex items-center gap-3 px-4 py-3 text-sm text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/[0.04] transition-colors">
                    <Shield className="w-5 h-5" /> Compliance
                  </Link>
                )}
              </div>

              {/* Drawer footer — logout */}
              <div className="border-t border-foreground/[0.06] p-4">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-[var(--color-error)]/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
