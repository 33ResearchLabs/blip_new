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

  const { wallets, connected, select } = useWallet();
  const { walletAddress } = useSolanaWallet();
  const { isMobile, platform } = useMobileDetect();

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

  // Main connection handler - simplified approach
  // Just check if wallet info is available and signing works, then let them in
  const connectWallet = useCallback(async (walletName: string) => {
    // Prevent duplicate connection attempts
    if (connectionInProgress.current) {
      console.log('[WalletConnection] Connection already in progress, ignoring');
      return;
    }

    console.log('[WalletConnection] Connecting to:', walletName);

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

      // If already connected with publicKey, we're done
      if (adapter.connected && adapter.publicKey) {
        console.log('[WalletConnection] Already connected');
        setIsConnecting(false);
        setConnectingWallet(null);
        connectionInProgress.current = false;
        return;
      }

      // For Phantom, check native API first - if already connected, just use it
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

        // Check if Phantom already has publicKey and signMessage available
        // If so, user is already connected - just proceed
        if (phantom.publicKey && phantom.signMessage) {
          console.log('[WalletConnection] Phantom already has wallet info, proceeding...');
          select(adapter.name);
          // Brief wait for adapter to sync
          await new Promise(resolve => setTimeout(resolve, 100));
          return;
        }

        // Try silent connect first (if user has previously approved)
        try {
          const resp = await phantom.connect({ onlyIfTrusted: true });
          if (resp?.publicKey) {
            console.log('[WalletConnection] Phantom silent connect successful');
            select(adapter.name);
            await new Promise(resolve => setTimeout(resolve, 100));
            return;
          }
        } catch {
          // Silent connect failed - this is normal for first-time users
          console.log('[WalletConnection] Silent connect not available, trying full connect...');
        }

        // Single connect attempt - no retries, no complex logic
        try {
          const resp = await phantom.connect();
          if (resp?.publicKey) {
            console.log('[WalletConnection] Phantom connected:', resp.publicKey.toString());
            select(adapter.name);
            await new Promise(resolve => setTimeout(resolve, 100));
            return;
          }
        } catch (err: any) {
          if (err?.message?.includes('User rejected') || err?.code === 4001) {
            setConnectionError('Connection cancelled');
          } else {
            console.error('[WalletConnection] Phantom connect failed:', err);
            setConnectionError('Connection failed. Please try again.');
          }
          throw err;
        }

        return;
      }

      // For other wallets, use standard adapter flow
      console.log('[WalletConnection] Using standard adapter flow for', walletName);
      select(adapter.name);

      // Wait for adapter to be ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simple connect - no complex timeout logic
      await adapter.connect();
      console.log('[WalletConnection] Connected successfully!');

    } catch (error: any) {
      console.error('[WalletConnection] Error:', error);
      const msg = error?.message || String(error);

      if (msg.includes('User rejected') || error?.code === 4001) {
        setConnectionError('Connection cancelled');
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
  }, [wallets, select, isMobile, platform, openMobileWalletApp, onError]);

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
