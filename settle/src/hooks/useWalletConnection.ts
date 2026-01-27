'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSolanaWallet } from '@/context/SolanaWalletContext';
import { useMobileDetect } from './useMobileDetect';
import { openMobileWallet, hasMobileDeepLink } from '@/lib/wallet/deepLinks';

export interface WalletConnectionOptions {
  onConnected?: (walletAddress: string) => void;
  onError?: (error: Error) => void;
}

export interface WalletConnectionResult {
  // State
  isConnecting: boolean;
  connectingWallet: string | null;
  connectionError: string | null;

  // Actions
  connectWallet: (walletName: string) => Promise<void>;
  resetError: () => void;

  // Mobile
  isMobile: boolean;
  platform: 'ios' | 'android' | 'desktop';
  openMobileWalletApp: (walletName: string) => boolean;
}

export function useWalletConnection(options: WalletConnectionOptions = {}): WalletConnectionResult {
  const { onConnected, onError } = options;

  const { wallets, connected, wallet, disconnect, select, connect } = useWallet();
  const { walletAddress } = useSolanaWallet();
  const { isMobile, platform, isBrave } = useMobileDetect();

  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Refs to prevent duplicate callbacks
  const hasCalledOnConnected = useRef(false);
  const connectionInProgress = useRef(false);

  // Reset callback tracking when modal closes or wallet changes
  useEffect(() => {
    if (!connected) {
      hasCalledOnConnected.current = false;
    }
  }, [connected]);

  // Handle successful connection
  useEffect(() => {
    if (connected && walletAddress && !hasCalledOnConnected.current) {
      hasCalledOnConnected.current = true;
      setConnectionError(null);
      setIsConnecting(false);
      setConnectingWallet(null);
      connectionInProgress.current = false;

      if (onConnected) {
        onConnected(walletAddress);
      }
    }
  }, [connected, walletAddress, onConnected]);

  // Reset error
  const resetError = useCallback(() => {
    setConnectionError(null);
  }, []);

  // Open mobile wallet app via deep link
  const openMobileWalletApp = useCallback((walletName: string): boolean => {
    if (!isMobile || platform === 'desktop') {
      return false;
    }

    return openMobileWallet(walletName, {
      platform: platform as 'ios' | 'android',
      action: 'connect',
    });
  }, [isMobile, platform]);

  // Main connection handler
  const connectWallet = useCallback(async (walletName: string) => {
    // Prevent duplicate connection attempts
    if (connectionInProgress.current) {
      console.log('[WalletConnection] Connection already in progress, ignoring');
      return;
    }

    console.log('[WalletConnection] Connecting to:', walletName);
    console.log('[WalletConnection] Platform:', platform, 'isMobile:', isMobile, 'isBrave:', isBrave);

    connectionInProgress.current = true;
    setConnectionError(null);
    setIsConnecting(true);
    setConnectingWallet(walletName);

    try {
      const walletAdapter = wallets.find(w => w.adapter.name === walletName);

      // On mobile, if wallet is not installed and has deep link support, open the app
      if (isMobile && platform !== 'desktop') {
        const isInstalled = walletAdapter?.readyState === 'Installed' || walletAdapter?.readyState === 'Loadable';

        if (!isInstalled && hasMobileDeepLink(walletName)) {
          console.log('[WalletConnection] Wallet not installed on mobile, opening deep link');
          openMobileWalletApp(walletName);
          setIsConnecting(false);
          setConnectingWallet(null);
          connectionInProgress.current = false;
          return;
        }
      }

      if (!walletAdapter) {
        throw new Error(`Wallet ${walletName} not found`);
      }

      const adapter = walletAdapter.adapter;

      // If already connected, we're done
      if (adapter.connected && adapter.publicKey) {
        console.log('[WalletConnection] Already connected');
        setIsConnecting(false);
        setConnectingWallet(null);
        connectionInProgress.current = false;
        return;
      }

      // For Phantom, use native Phantom API (works better across browsers)
      if (walletName === 'Phantom') {
        const phantom = (window as any).phantom?.solana || (window as any).solana;

        if (!phantom) {
          // On mobile, try to open the app
          if (isMobile && platform !== 'desktop') {
            openMobileWalletApp('Phantom');
            setIsConnecting(false);
            setConnectingWallet(null);
            connectionInProgress.current = false;
            return;
          }

          window.open('https://phantom.app/', '_blank');
          setConnectionError('Please install Phantom wallet');
          throw new Error('Phantom wallet not installed');
        }

        console.log('[WalletConnection] Using native Phantom API...');

        try {
          // Try silent connect first (if user has previously approved)
          let connected = false;
          try {
            const resp = await phantom.connect({ onlyIfTrusted: true });
            if (resp?.publicKey) {
              console.log('[WalletConnection] Phantom silent connect successful');
              connected = true;
            }
          } catch {
            // Silent connect failed, will try full connect
          }

          if (!connected) {
            // Full connect (shows popup)
            const resp = await phantom.connect();
            const pubKey = resp.publicKey.toString();
            console.log('[WalletConnection] Phantom connected:', pubKey);
          }

          // Select the adapter to sync React state
          select(adapter.name);

          // Wait for adapter to sync
          await new Promise(resolve => setTimeout(resolve, 200));

          // If adapter didn't sync but Phantom is connected, that's still OK
          if (!adapter.connected && phantom.publicKey) {
            console.log('[WalletConnection] Adapter not synced but Phantom is connected');
          }

          return;
        } catch (err: any) {
          if (err?.message?.includes('User rejected')) {
            setConnectionError('Connection cancelled');
          } else {
            console.error('[WalletConnection] Phantom connect failed:', err);
            setConnectionError('Connection failed. Please try again.');
          }
          throw err;
        }
      }

      // For other wallets, use standard adapter flow
      console.log('[WalletConnection] Using standard adapter flow for', walletName);
      select(adapter.name);

      // Wait for adapter to be ready
      await new Promise(resolve => setTimeout(resolve, 200));

      // Connect with timeout
      const connectPromise = adapter.connect();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out')), 30000)
      );

      await Promise.race([connectPromise, timeoutPromise]);
      console.log('[WalletConnection] Connected successfully!');

    } catch (error: any) {
      console.error('[WalletConnection] Error:', error);
      const msg = error?.message || String(error);

      if (msg.includes('User rejected') || error?.code === 4001) {
        setConnectionError('Connection cancelled');
      } else if (msg.includes('timed out')) {
        setConnectionError('Connection timed out. Please try again.');
      } else if (msg.includes('Unexpected error')) {
        setConnectionError('Wallet error. Please refresh and try again.');
      } else {
        setConnectionError('Connection failed. Please try again.');
      }

      if (onError) {
        onError(error);
      }
    } finally {
      setIsConnecting(false);
      setConnectingWallet(null);
      connectionInProgress.current = false;
    }
  }, [wallets, select, isMobile, platform, isBrave, openMobileWalletApp, onError]);

  return {
    isConnecting,
    connectingWallet,
    connectionError,
    connectWallet,
    resetError,
    isMobile,
    platform,
    openMobileWalletApp,
  };
}
