'use client';

import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wallet, ExternalLink, ChevronRight, Loader2, Check, LogOut, Smartphone } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSolanaWallet } from '@/context/SolanaWalletContext';
import { useWalletConnection } from '@/hooks/useWalletConnection';
import { useMobileDetect } from '@/hooks/useMobileDetect';
import { hasMobileDeepLink, getAppStoreLink } from '@/lib/wallet/deepLinks';

// Theme configurations
const THEMES = {
  user: {
    primary: 'purple-500',
    secondary: 'blue-500',
    gradient: 'from-purple-500 to-blue-500',
    gradientHover: 'hover:from-purple-600 hover:to-blue-600',
    border: 'border-white/10',
    borderAccent: 'border-purple-500/50',
    bgAccent: 'bg-purple-500/20',
    bgAccentHover: 'hover:bg-purple-500/30',
    textAccent: 'text-purple-500',
    textAccentLight: 'text-purple-400',
    loaderColor: 'text-purple-500',
    subtitle: 'Solana Devnet',
    footer: 'By connecting, you agree to the Terms of Service',
  },
  merchant: {
    primary: '[#c9a962]',
    secondary: '[#a88b4a]',
    gradient: 'from-[#c9a962] to-[#a88b4a]',
    gradientHover: 'hover:from-[#d4b56d] hover:to-[#b39655]',
    border: 'border-[#c9a962]/30',
    borderAccent: 'border-[#c9a962]/50',
    bgAccent: 'bg-[#c9a962]/20',
    bgAccentHover: 'hover:bg-[#c9a962]/30',
    textAccent: 'text-[#c9a962]',
    textAccentLight: 'text-[#c9a962]',
    loaderColor: 'text-[#c9a962]',
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

      // Apply custom filter if provided
      if (walletFilter && !walletFilter.includes(w.adapter.name)) {
        return false;
      }

      return true;
    });
  }, [wallets, walletFilter]);

  // Separate installed and not-installed wallets
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

  // Mobile-compatible wallets (have deep link support)
  const mobileWallets = useMemo(() =>
    filteredWallets.filter(w => hasMobileDeepLink(w.adapter.name)),
    [filteredWallets]
  );

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

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className={`fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto bg-[#1a1a1a] rounded-2xl border ${themeConfig.border} overflow-hidden z-50 max-h-[85vh] flex flex-col`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between p-4 border-b ${themeConfig.border}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${themeConfig.gradient} flex items-center justify-center`}>
                  <Wallet className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Connect Wallet</h2>
                  <p className="text-xs text-white/50">{themeConfig.subtitle}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-white/60" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 overflow-y-auto flex-1">
              {connected && walletAddress ? (
                /* Connected State */
                <div className="space-y-4">
                  <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                        <Check className="w-5 h-5 text-green-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-green-500">Connected</p>
                        <p className="text-xs text-white/50">{wallet?.adapter.name}</p>
                      </div>
                    </div>
                    <div className="bg-black/30 rounded-lg p-3">
                      <p className="text-xs text-white/50 mb-1">Wallet Address</p>
                      <p className="text-sm text-white font-mono break-all">{walletAddress}</p>
                    </div>
                  </div>

                  {/* Balances */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 rounded-xl p-4">
                      <p className="text-xs text-white/50 mb-1">SOL Balance</p>
                      <p className="text-lg font-semibold text-white">
                        {solBalance !== null ? solBalance.toFixed(4) : '...'} SOL
                      </p>
                    </div>
                    <div className="bg-white/5 rounded-xl p-4">
                      <p className="text-xs text-white/50 mb-1">USDT Balance</p>
                      <p className="text-lg font-semibold text-white">
                        {usdtBalance !== null ? usdtBalance.toFixed(2) : '...'} USDT
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => refreshBalances()}
                    className="w-full py-2 text-sm text-white/50 hover:text-white transition-colors"
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
                      className="flex-1 py-3 bg-red-500/10 border border-red-500/30 text-red-400 font-medium rounded-xl hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
                    >
                      <LogOut className="w-4 h-4" />
                      Disconnect
                    </button>
                    <button
                      onClick={onClose}
                      className={`flex-1 py-3 bg-gradient-to-r ${themeConfig.gradient} text-white font-medium rounded-xl hover:opacity-90 transition-opacity`}
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
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        <X className="w-5 h-5 text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-400">{connectionError}</p>
                      </div>
                    </div>
                  )}

                  {/* Connecting Indicator */}
                  {isConnecting && (
                    <div className={`mb-4 ${themeConfig.bgAccent} border ${themeConfig.borderAccent} rounded-xl p-4 flex items-center gap-3`}>
                      <Loader2 className={`w-6 h-6 ${themeConfig.loaderColor} animate-spin`} />
                      <div>
                        <p className={`text-sm font-medium ${themeConfig.textAccentLight}`}>
                          Connecting to {connectingWallet}...
                        </p>
                        <p className="text-xs text-white/50">Approve in your wallet</p>
                      </div>
                    </div>
                  )}

                  {/* In-App Browser Warning */}
                  {isInAppBrowser && (
                    <div className="mb-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3">
                      <p className="text-sm text-yellow-400">
                        For best experience, open this page in your browser (Safari/Chrome)
                      </p>
                    </div>
                  )}

                  {/* Mobile Wallet Options */}
                  {isMobile && showMobileOptions && mobileWallets.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-white/50 uppercase tracking-wider mb-2 flex items-center gap-2">
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
                              className={`w-full flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r ${themeConfig.gradient} ${themeConfig.gradientHover} transition-all`}
                            >
                              {walletAdapter.adapter.icon ? (
                                <img
                                  src={walletAdapter.adapter.icon}
                                  alt={walletAdapter.adapter.name}
                                  className="w-10 h-10 rounded-lg"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-white/20 flex items-center justify-center text-xl">
                                  {info.icon}
                                </div>
                              )}
                              <div className="flex-1 text-left">
                                <p className="text-sm font-medium text-white">Open {info.name}</p>
                                <p className="text-xs text-white/70">Continue in app</p>
                              </div>
                              <ExternalLink className="w-5 h-5 text-white/70" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Installed Wallets */}
                  {installedWallets.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-white/50 uppercase tracking-wider mb-2">
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
                              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                                isSelected
                                  ? `${themeConfig.bgAccent} ${themeConfig.borderAccent}`
                                  : `bg-white/5 border-transparent hover:bg-white/10 hover:border-white/20`
                              } ${isConnecting && !isSelected ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                              {walletAdapter.adapter.icon ? (
                                <img
                                  src={walletAdapter.adapter.icon}
                                  alt={walletAdapter.adapter.name}
                                  className="w-10 h-10 rounded-lg"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-xl">
                                  {info.icon}
                                </div>
                              )}
                              <div className="flex-1 text-left">
                                <p className="text-sm font-medium text-white">{info.name}</p>
                                <p className="text-xs text-white/50">{info.description}</p>
                              </div>
                              {isSelected && isConnecting ? (
                                <Loader2 className={`w-5 h-5 ${themeConfig.loaderColor} animate-spin`} />
                              ) : (
                                <ChevronRight className="w-5 h-5 text-white/30" />
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
                      <p className="text-xs text-white/50 uppercase tracking-wider mb-2">Other Wallets</p>
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
                              className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/20 transition-all"
                            >
                              {walletAdapter.adapter.icon ? (
                                <img
                                  src={walletAdapter.adapter.icon}
                                  alt={walletAdapter.adapter.name}
                                  className="w-10 h-10 rounded-lg opacity-50"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-xl opacity-50">
                                  {info.icon}
                                </div>
                              )}
                              <div className="flex-1 text-left">
                                <p className="text-sm font-medium text-white/70">{info.name}</p>
                                <p className="text-xs text-white/40">Click to install</p>
                              </div>
                              <ExternalLink className="w-4 h-4 text-white/30" />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* No Wallets Found */}
                  {filteredWallets.length === 0 && (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                        <Wallet className="w-8 h-8 text-white/30" />
                      </div>
                      <p className="text-white/70 mb-2">No wallets found</p>
                      <p className="text-sm text-white/50">
                        {isMobile
                          ? 'Install a Solana wallet app like Phantom'
                          : 'Install a Solana wallet like Phantom to continue'
                        }
                      </p>
                      <a
                        href="https://phantom.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-2 mt-4 px-4 py-2 ${themeConfig.bgAccent} ${themeConfig.textAccentLight} rounded-lg ${themeConfig.bgAccentHover} transition-colors`}
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
            <div className={`p-4 border-t ${themeConfig.border} bg-white/5`}>
              <p className="text-xs text-white/40 text-center">
                {themeConfig.footer}
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
