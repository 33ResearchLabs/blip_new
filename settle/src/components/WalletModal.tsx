'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wallet, ExternalLink, ChevronRight, Loader2, Check, LogOut, Smartphone } from 'lucide-react';
import { MOCK_MODE } from '@/lib/config/mockMode';

// ============================================================================
// REAL WALLET IMPORTS (commented out in mock mode, kept for easy restoration)
// When MOCK_MODE=false, these are used for real Solana wallet connections.
// ============================================================================
/* MOCK_MODE_TOGGLE: Real wallet imports - uncomment when MOCK_MODE=false */
import { useWallet } from '@solana/wallet-adapter-react';
import { useSolanaWallet } from '@/context/SolanaWalletContext';
import { useWalletConnection } from '@/hooks/useWalletConnection';
import { useMobileDetect } from '@/hooks/useMobileDetect';
import { hasMobileDeepLink, getAppStoreLink } from '@/lib/wallet/deepLinks';

// Ultra-minimal theme configurations - NO colors, only subtle grays
const THEMES = {
  user: {
    primary: 'white',
    secondary: 'white/80',
    gradient: 'from-white/10 to-white/10',
    gradientHover: 'hover:from-white/20 hover:to-white/20',
    border: 'border-white/6',
    borderAccent: 'border-white/12',
    bgAccent: 'bg-white/5',
    bgAccentHover: 'hover:bg-white/10',
    textAccent: 'text-white',
    textAccentLight: 'text-white/70',
    loaderColor: 'text-white',
    subtitle: 'Solana Devnet',
    footer: 'By connecting, you agree to the Terms of Service',
  },
  merchant: {
    primary: 'white',
    secondary: 'white/80',
    gradient: 'from-white/10 to-white/10',
    gradientHover: 'hover:from-white/20 hover:to-white/20',
    border: 'border-white/6',
    borderAccent: 'border-white/12',
    bgAccent: 'bg-white/5',
    bgAccentHover: 'hover:bg-white/10',
    textAccent: 'text-white',
    textAccentLight: 'text-white/70',
    loaderColor: 'text-white',
    subtitle: 'Merchant Dashboard',
    footer: 'Solana Devnet - Merchant Portal',
  },
};

// Wallet display info
const WALLET_INFO: Record<string, { name: string; icon: string; description: string }> = {
  Phantom: {
    name: 'Phantom',
    icon: '👻',
    description: 'The friendly Solana wallet',
  },
  Solflare: {
    name: 'Solflare',
    icon: '🔥',
    description: 'Secure Solana wallet',
  },
  Torus: {
    name: 'Torus',
    icon: '🔵',
    description: 'Social login wallet',
  },
  Ledger: {
    name: 'Ledger',
    icon: '🔐',
    description: 'Hardware wallet',
  },
  'Coinbase Wallet': {
    name: 'Coinbase Wallet',
    icon: '🔷',
    description: 'Coinbase self-custody wallet',
  },
  WalletConnect: {
    name: 'WalletConnect',
    icon: '🔗',
    description: 'Connect mobile wallet via QR',
  },
};

export interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (walletAddress: string) => void;
  theme?: 'user' | 'merchant';
  walletFilter?: string[];
  showMobileOptions?: boolean;
}

export default function WalletModal({
  isOpen,
  onClose,
  onConnected,
  theme = 'user',
  walletFilter,
  showMobileOptions = true,
}: WalletModalProps) {
  // All hooks must be called unconditionally (React rules-of-hooks)
  const { wallets, connected, wallet, disconnect } = useWallet();
  const { walletAddress, solBalance, usdtBalance, refreshBalances } = useSolanaWallet();
  const { isMobile, platform, isInAppBrowser } = useMobileDetect();

  const {
    isConnecting,
    connectingWallet,
    connectionError,
    connectWallet,
    resetError,
    openMobileWalletApp,
  } = useWalletConnection({ onConnected });

  const themeConfig = THEMES[theme];

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      resetError();
    }
  }, [isOpen, resetError]);

  // Filter and deduplicate wallets
  const filteredWallets = useMemo(() => {
    const seenNames = new Set<string>();
    return wallets.filter(w => {
      if (seenNames.has(w.adapter.name)) return false;
      seenNames.add(w.adapter.name);
      if (walletFilter && !walletFilter.includes(w.adapter.name)) return false;
      return true;
    });
  }, [wallets, walletFilter]);

  const installedWallets = useMemo(() =>
    filteredWallets.filter(w =>
      w.readyState === 'Installed' || w.readyState === 'Loadable'
    ),
    [filteredWallets]
  );

  const notInstalledWallets = useMemo(() =>
    filteredWallets.filter(w =>
      w.readyState !== 'Installed' && w.readyState !== 'Loadable'
    ),
    [filteredWallets]
  );

  const mobileWallets = useMemo(() =>
    filteredWallets.filter(w => hasMobileDeepLink(w.adapter.name)),
    [filteredWallets]
  );

  // ============================================================================
  // MOCK MODE: Show simplified "Mock Connected" UI instead of real wallet list
  // ============================================================================
  if (MOCK_MODE) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              onClick={onClose}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto rounded-2xl overflow-hidden z-50"
            style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}
            >
              <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <div>
                  <h2 className="text-[22px] font-semibold tracking-tight leading-none" style={{ color: '#000' }}>Mock Mode</h2>
                  <p className="text-[13px] mt-0.5" style={{ color: 'rgba(0,0,0,0.45)' }}>Wallet connect disabled - using test coins</p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                  <X className="w-5 h-5" style={{ color: 'rgba(0,0,0,0.4)' }} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="rounded-xl p-4" style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-sm font-medium mb-1" style={{ color: '#fff' }}>Test Mode Active</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    Real wallet connections are disabled. All accounts are auto-funded with 10,000 USDT test coins.
                    Login or register to get started.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="w-full py-3 font-medium rounded-xl transition-colors"
                  style={{ background: '#111111', color: '#fff' }}
                >
                  Got it
                </button>
              </div>
              <div className="p-4" style={{ borderTop: '1px solid rgba(0,0,0,0.06)', background: 'rgba(0,0,0,0.02)' }}>
                <p className="text-xs text-center" style={{ color: 'rgba(0,0,0,0.35)' }}>
                  Set NEXT_PUBLIC_MOCK_MODE=false to enable real wallets
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    );
  }

  // Handle wallet selection
  const handleWalletSelect = async (walletName: string) => {
    await connectWallet(walletName);
  };

  // Handle mobile wallet open
  const handleMobileWalletOpen = (walletName: string) => {
    const opened = openMobileWalletApp(walletName);
    if (!opened) {
      // Fallback to app store
      const storeLink = getAppStoreLink(walletName, platform as 'ios' | 'android');
      if (storeLink) {
        window.open(storeLink, '_blank');
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Modal - Apple-inspired minimal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.4, 0.0, 0.2, 1] }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto rounded-2xl overflow-hidden z-50 max-h-[85vh] flex flex-col"
            style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}
          >
            {/* Header - Minimal */}
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <div>
                <h2 className="text-[22px] font-semibold tracking-tight leading-none" style={{ color: '#000' }}>Connect Wallet</h2>
                <p className="text-[13px] mt-0.5" style={{ color: 'rgba(0,0,0,0.45)' }}>{themeConfig.subtitle}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-black/5 rounded-full transition-colors"
              >
                <X className="w-5 h-5" style={{ color: 'rgba(0,0,0,0.4)' }} />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto flex-1">
              {connected && walletAddress ? (
                /* Connected State */
                <div className="space-y-4">
                  <div className="rounded-xl p-4" style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}>
                        <Check className="w-5 h-5 text-green-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-green-500">Connected</p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{wallet?.adapter.name}</p>
                      </div>
                    </div>
                    <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Wallet Address</p>
                      <p className="text-sm font-mono break-all" style={{ color: '#fff' }}>{walletAddress}</p>
                    </div>
                  </div>

                  {/* Balances */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl p-4" style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>SOL Balance</p>
                      <p className="text-lg font-semibold" style={{ color: '#fff' }}>
                        {solBalance !== null ? solBalance.toFixed(4) : '...'} SOL
                      </p>
                    </div>
                    <div className="rounded-xl p-4" style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <p className="text-xs mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>USDT Balance</p>
                      <p className="text-lg font-semibold" style={{ color: '#fff' }}>
                        {usdtBalance !== null ? usdtBalance.toFixed(2) : '...'} USDT
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => refreshBalances()}
                    className="w-full py-2 text-sm transition-colors"
                    style={{ color: 'rgba(0,0,0,0.45)' }}
                  >
                    Refresh Balances
                  </button>

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        disconnect();
                        onClose();
                      }}
                      className="flex-1 py-3 bg-red-500/10 border border-red-500/20 text-red-500 font-medium rounded-xl hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
                    >
                      <LogOut className="w-4 h-4" />
                      Disconnect
                    </button>
                    <button
                      onClick={onClose}
                      className="flex-1 py-3 font-medium rounded-xl transition-colors"
                      style={{ background: '#111111', color: '#fff' }}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : (
                /* Disconnected State */
                <>
                  {/* Error Alert */}
                  {connectionError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        <X className="w-5 h-5 text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-500">{connectionError}</p>
                      </div>
                    </div>
                  )}

                  {/* Connecting Indicator */}
                  {isConnecting && (
                    <div className="mb-4 rounded-xl p-4 flex items-center gap-3" style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#fff' }} />
                      <div>
                        <p className="text-sm font-medium" style={{ color: '#fff' }}>
                          Connecting to {connectingWallet}...
                        </p>
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>Approve in your wallet</p>
                      </div>
                    </div>
                  )}

                  {/* In-App Browser Warning */}
                  {isInAppBrowser && (
                    <div className="mb-4 rounded-xl p-3" style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)' }}>
                      <p className="text-sm" style={{ color: 'rgba(0,0,0,0.6)' }}>
                        For best experience, open this page in your browser (Safari/Chrome)
                      </p>
                    </div>
                  )}

                  {/* Mobile Wallet Options */}
                  {isMobile && showMobileOptions && mobileWallets.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs uppercase tracking-wider mb-2 flex items-center gap-2" style={{ color: 'rgba(0,0,0,0.4)' }}>
                        <Smartphone className="w-3 h-3" />
                        Open in Wallet App
                      </p>
                      <div className="space-y-2">
                        {mobileWallets.map((walletAdapter) => {
                          const info = WALLET_INFO[walletAdapter.adapter.name] || {
                            name: walletAdapter.adapter.name,
                            icon: '💳',
                            description: 'Solana wallet',
                          };

                          return (
                            <button
                              key={`mobile-${walletAdapter.adapter.name}`}
                              onClick={() => handleMobileWalletOpen(walletAdapter.adapter.name)}
                              className="w-full flex items-center gap-3 p-4 rounded-xl transition-all"
                              style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}
                            >
                              {walletAdapter.adapter.icon ? (
                                <img
                                  src={walletAdapter.adapter.icon}
                                  alt={walletAdapter.adapter.name}
                                  className="w-10 h-10 rounded-lg"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl" style={{ background: 'rgba(255,255,255,0.1)' }}>
                                  {info.icon}
                                </div>
                              )}
                              <div className="flex-1 text-left">
                                <p className="text-[15px] font-medium" style={{ color: '#fff' }}>{info.name}</p>
                                <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>Continue in app</p>
                              </div>
                              <ChevronRight className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.3)' }} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Installed Wallets */}
                  {installedWallets.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(0,0,0,0.4)' }}>
                        {isMobile ? 'Available Wallets' : 'Detected Wallets'}
                      </p>
                      <div className="space-y-2">
                        {installedWallets.map((walletAdapter) => {
                          const info = WALLET_INFO[walletAdapter.adapter.name] || {
                            name: walletAdapter.adapter.name,
                            icon: '💳',
                            description: 'Solana wallet',
                          };
                          const isSelected = connectingWallet === walletAdapter.adapter.name;

                          return (
                            <button
                              key={walletAdapter.adapter.name}
                              onClick={() => handleWalletSelect(walletAdapter.adapter.name)}
                              disabled={isConnecting}
                              className={`w-full flex items-center gap-3 p-4 rounded-xl transition-all ${isConnecting && !isSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
                              style={isSelected
                                ? { background: '#1a1a1a', border: '2px solid rgba(255,255,255,0.2)' }
                                : { background: '#111111', border: '1px solid rgba(255,255,255,0.08)' }}
                            >
                              {walletAdapter.adapter.icon ? (
                                <img
                                  src={walletAdapter.adapter.icon}
                                  alt={walletAdapter.adapter.name}
                                  className="w-10 h-10 rounded-lg"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl" style={{ background: 'rgba(255,255,255,0.1)' }}>
                                  {info.icon}
                                </div>
                              )}
                              <div className="flex-1 text-left">
                                <p className="text-[15px] font-medium" style={{ color: '#fff' }}>{info.name}</p>
                                <p className="text-[13px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{info.description}</p>
                              </div>
                              {isSelected && isConnecting ? (
                                <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#fff' }} />
                              ) : (
                                <ChevronRight className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.3)' }} />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Not Installed Wallets (desktop only) */}
                  {!isMobile && notInstalledWallets.length > 0 && (
                    <div>
                      <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(0,0,0,0.4)' }}>Other Wallets</p>
                      <div className="space-y-2">
                        {notInstalledWallets.map((walletAdapter) => {
                          const info = WALLET_INFO[walletAdapter.adapter.name] || {
                            name: walletAdapter.adapter.name,
                            icon: '💳',
                            description: 'Solana wallet',
                          };

                          return (
                            <a
                              key={walletAdapter.adapter.name}
                              href={walletAdapter.adapter.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full flex items-center gap-3 p-3 rounded-xl transition-all"
                              style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}
                            >
                              {walletAdapter.adapter.icon ? (
                                <img
                                  src={walletAdapter.adapter.icon}
                                  alt={walletAdapter.adapter.name}
                                  className="w-10 h-10 rounded-lg opacity-50"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl opacity-50" style={{ background: 'rgba(0,0,0,0.06)' }}>
                                  {info.icon}
                                </div>
                              )}
                              <div className="flex-1 text-left">
                                <p className="text-sm font-medium" style={{ color: 'rgba(0,0,0,0.6)' }}>{info.name}</p>
                                <p className="text-xs" style={{ color: 'rgba(0,0,0,0.35)' }}>Click to install</p>
                              </div>
                              <ExternalLink className="w-4 h-4" style={{ color: 'rgba(0,0,0,0.3)' }} />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* No Wallets Found */}
                  {filteredWallets.length === 0 && (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#111111' }}>
                        <Wallet className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.4)' }} />
                      </div>
                      <p className="mb-2" style={{ color: 'rgba(0,0,0,0.6)' }}>No wallets found</p>
                      <p className="text-sm" style={{ color: 'rgba(0,0,0,0.4)' }}>
                        {isMobile
                          ? 'Install a Solana wallet app like Phantom'
                          : 'Install a Solana wallet like Phantom to continue'
                        }
                      </p>
                      <a
                        href="https://phantom.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg transition-colors"
                        style={{ background: '#111111', color: '#fff' }}
                      >
                        Get Phantom
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4" style={{ borderTop: '1px solid rgba(0,0,0,0.06)', background: 'rgba(0,0,0,0.02)' }}>
              <p className="text-xs text-center" style={{ color: 'rgba(0,0,0,0.35)' }}>
                {themeConfig.footer}
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
