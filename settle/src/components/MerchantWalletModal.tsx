'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wallet, ExternalLink, ChevronRight, Loader2, Check, LogOut } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSolanaWallet } from '@/context/SolanaWalletContext';

interface MerchantWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected?: (walletAddress: string) => void;
}

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
};

export default function MerchantWalletModal({ isOpen, onClose, onConnected }: MerchantWalletModalProps) {
  const { wallets, connected, wallet, disconnect, select, connect } = useWallet();
  const { walletAddress, solBalance, usdtBalance, refreshBalances } = useSolanaWallet();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pendingConnect, setPendingConnect] = useState(false);

  // Handle successful connection
  useEffect(() => {
    if (connected && walletAddress) {
      console.log('[MerchantWallet] Connected:', walletAddress);
      setConnectionError(null);
      setIsConnecting(false);
      setConnectingWallet(null);
      setPendingConnect(false);
      if (onConnected) {
        onConnected(walletAddress);
      }
    }
  }, [connected, walletAddress, onConnected]);

  // Auto-connect when wallet is selected and we have a pending connect
  // This runs AFTER select() has been processed by React
  useEffect(() => {
    if (pendingConnect && wallet && !connected) {
      console.log('[MerchantWallet] Wallet selected, now connecting:', wallet.adapter.name);

      // Check if this is Phantom in Brave - if so, don't call connect() as it causes redirect
      const isBraveBrowser = (navigator as any).brave !== undefined;
      const phantom = (window as any).phantom?.solana;

      if (isBraveBrowser && phantom?.isConnected) {
        // Phantom is already connected via direct API, just wait for adapter to sync
        console.log('[MerchantWallet] Brave + Phantom already connected, waiting for adapter sync...');

        // Poll for adapter to sync with Phantom's state
        let attempts = 0;
        const checkSync = setInterval(() => {
          attempts++;
          if (wallet.adapter.connected || attempts > 30) {
            clearInterval(checkSync);
            setPendingConnect(false);
            if (wallet.adapter.connected) {
              console.log('[MerchantWallet] Adapter synced!');
            } else {
              console.log('[MerchantWallet] Adapter sync timeout, but Phantom is connected');
            }
          }
        }, 100);
        return;
      }

      // For non-Brave browsers, call connect()
      const doConnect = async () => {
        try {
          await connect();
          console.log('[MerchantWallet] Connect successful!');
        } catch (err: any) {
          console.log('[MerchantWallet] Connect error:', err?.message);
        }
        setPendingConnect(false);
      };
      doConnect();
    }
  }, [pendingConnect, wallet, connected, connect]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      console.log('[MerchantWallet] Modal opened, wallets:', wallets.length);
      setConnectionError(null);
      setIsConnecting(false);
      setConnectingWallet(null);
      setPendingConnect(false);
    }
  }, [isOpen, wallets.length]);

  // Detect if running in Brave browser
  const isBrave = useCallback(() => {
    return (navigator as any).brave !== undefined;
  }, []);

  // Simple direct connection handler
  const handleWalletSelect = useCallback(async (walletName: string) => {
    console.log('[MerchantWallet] Selecting:', walletName);
    console.log('[MerchantWallet] Browser:', isBrave() ? 'Brave' : 'Chrome/Other');
    setConnectionError(null);
    setIsConnecting(true);
    setConnectingWallet(walletName);

    try {
      const walletAdapter = wallets.find(w => w.adapter.name === walletName);
      if (!walletAdapter) {
        throw new Error('Wallet not found');
      }

      const adapter = walletAdapter.adapter;
      console.log('[MerchantWallet] Adapter state:', {
        name: adapter.name,
        readyState: walletAdapter.readyState,
        connected: adapter.connected,
      });

      // If already connected, done
      if (adapter.connected && adapter.publicKey) {
        console.log('[MerchantWallet] Already connected');
        setIsConnecting(false);
        setConnectingWallet(null);
        return;
      }

      // For Phantom in Brave, use direct Phantom API
      if (walletName === 'Phantom' && isBrave()) {
        const phantom = (window as any).phantom?.solana;
        if (!phantom) {
          console.log('[MerchantWallet] Phantom not found in Brave');
          window.open('https://phantom.app/', '_blank');
          setConnectionError('Please install Phantom wallet');
          return;
        }
        console.log('[MerchantWallet] Brave detected, using Phantom direct API...');

        try {
          // Connect via Phantom's direct API first
          const resp = await phantom.connect();
          const pubKey = resp.publicKey.toString();
          console.log('[MerchantWallet] Phantom direct connected:', pubKey);

          // Select the wallet - this schedules a React state update
          select(adapter.name);

          // Set pending connect - the useEffect will call connect() after React processes select()
          setPendingConnect(true);
          console.log('[MerchantWallet] Adapter selected, pending connect set');

          // Don't return yet - let finally block run to clear isConnecting
          // The useEffect will handle the actual connection
          return;
        } catch (err: any) {
          if (err?.message?.includes('User rejected')) {
            setConnectionError('Connection cancelled');
          } else {
            console.error('[MerchantWallet] Phantom direct connect failed:', err);
            setConnectionError('Connection failed. Try again.');
          }
          throw err;
        }
      }

      // For Chrome and other browsers, use standard adapter flow
      console.log('[MerchantWallet] Using standard adapter flow');

      // Try direct Phantom API first for Chrome (some older Chrome versions have adapter issues)
      if (walletName === 'Phantom') {
        const phantom = (window as any).phantom?.solana || (window as any).solana;
        if (phantom?.isPhantom) {
          console.log('[MerchantWallet] Trying Phantom direct API for Chrome...');
          try {
            const resp = await phantom.connect();
            console.log('[MerchantWallet] Phantom direct connected:', resp.publicKey.toString());
            select(adapter.name);
            setPendingConnect(true);
            return;
          } catch (directErr: any) {
            console.log('[MerchantWallet] Phantom direct failed, falling back to adapter:', directErr?.message);
          }
        }
      }

      // Standard adapter flow
      select(adapter.name);

      // Wait for adapter to be ready
      await new Promise(resolve => setTimeout(resolve, 300));

      // Connect via adapter with timeout
      console.log('[MerchantWallet] Connecting via adapter.connect()...');

      // Wrap in timeout to catch hung connections
      const connectPromise = adapter.connect();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Connection timeout - popup may not have opened')), 30000)
      );

      await Promise.race([connectPromise, timeoutPromise]);
      console.log('[MerchantWallet] Connected successfully!');

    } catch (error: any) {
      console.error('[MerchantWallet] Error:', error);
      const msg = error?.message || String(error);

      if (msg.includes('User rejected') || error?.code === 4001) {
        setConnectionError('Connection cancelled');
      } else if (msg.includes('Unexpected error')) {
        setConnectionError('Wallet error. Refresh and try again.');
      } else {
        setConnectionError('Connection failed. Try again.');
      }
    } finally {
      setIsConnecting(false);
      setConnectingWallet(null);
    }
  }, [wallets, select, isBrave]);

  // Deduplicate wallets
  const seenNames = new Set<string>();
  const uniqueWallets = wallets.filter(w => {
    if (seenNames.has(w.adapter.name)) return false;
    seenNames.add(w.adapter.name);
    return true;
  });

  const installedWallets = uniqueWallets.filter(w =>
    w.readyState === 'Installed' || w.readyState === 'Loadable'
  );

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
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-md mx-auto bg-[#1a1a1a] rounded-2xl border border-[#c9a962]/30 overflow-hidden z-50 max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-[#c9a962]/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#c9a962] to-[#a88b4a] flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-black" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Connect Wallet</h2>
                  <p className="text-xs text-[#c9a962]">Merchant Dashboard</p>
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
                      className="flex-1 py-3 bg-gradient-to-r from-[#c9a962] to-[#a88b4a] text-black font-medium rounded-xl hover:opacity-90 transition-opacity"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {connectionError && (
                    <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        <X className="w-5 h-5 text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-400">{connectionError}</p>
                      </div>
                    </div>
                  )}

                  {isConnecting && (
                    <div className="mb-4 bg-[#c9a962]/10 border border-[#c9a962]/30 rounded-xl p-4 flex items-center gap-3">
                      <Loader2 className="w-6 h-6 text-[#c9a962] animate-spin" />
                      <div>
                        <p className="text-sm font-medium text-[#c9a962]">
                          Connecting to {connectingWallet}...
                        </p>
                        <p className="text-xs text-white/50">Approve in your wallet</p>
                      </div>
                    </div>
                  )}

                  {installedWallets.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs text-white/50 uppercase tracking-wider mb-2">Select Wallet</p>
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
                                ? 'bg-[#c9a962]/20 border-[#c9a962]/50'
                                : 'bg-white/5 border-transparent hover:bg-white/10 hover:border-[#c9a962]/30'
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
                              <Loader2 className="w-5 h-5 text-[#c9a962] animate-spin" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-white/30" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                        <Wallet className="w-8 h-8 text-white/30" />
                      </div>
                      <p className="text-white/70 mb-2">No wallets found</p>
                      <p className="text-sm text-white/50">
                        Install Phantom or Solflare to continue
                      </p>
                      <a
                        href="https://phantom.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-[#c9a962]/20 text-[#c9a962] rounded-lg hover:bg-[#c9a962]/30 transition-colors"
                      >
                        Get Phantom
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t border-[#c9a962]/20 bg-white/5">
              <p className="text-xs text-white/40 text-center">
                Solana Devnet - Merchant Portal
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
