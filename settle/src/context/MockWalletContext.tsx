'use client';

// ============================================================================
// MOCK WALLET CONTEXT
// ============================================================================
// Provides the same interface as SolanaWalletContext but backed by DB balances.
// Used when NEXT_PUBLIC_MOCK_MODE=true. No real Solana connections are made.
// To restore real wallet functionality, set NEXT_PUBLIC_MOCK_MODE=false.
// ============================================================================

import React, { FC, ReactNode, useState, useCallback, useEffect } from 'react';
import { SolanaWalletContext } from './SolanaWalletContext';

// Mock provider that provides values into the same SolanaWalletContext
const MockWalletInnerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);
  const [mockUserId, setMockUserId] = useState<string | null>(null);
  const [mockUserType, setMockUserType] = useState<'user' | 'merchant'>('user');
  const [mockWalletAddress, setMockWalletAddress] = useState<string | null>(null);

  // Read user info from localStorage on mount and watch for changes
  useEffect(() => {
    const checkUser = () => {
      try {
        // Check for user session
        // Note: blip_user and blip_merchant store full JSON objects, not just IDs
        const userRaw = localStorage.getItem('blip_user');
        const merchantRaw = localStorage.getItem('blip_merchant');
        const wallet = localStorage.getItem('blip_wallet');

        if (merchantRaw) {
          try {
            const merchant = JSON.parse(merchantRaw);
            const id = merchant.id || merchantRaw;
            setMockUserId(id);
            setMockUserType('merchant');
            setMockWalletAddress(merchant.wallet_address || wallet || `MOCK_MERCHANT_${id.slice(0, 8)}`);
          } catch {
            setMockUserId(merchantRaw);
            setMockUserType('merchant');
            setMockWalletAddress(wallet || `MOCK_MERCHANT_${merchantRaw.slice(0, 8)}`);
          }
        } else if (userRaw) {
          try {
            const user = JSON.parse(userRaw);
            const id = user.id || userRaw;
            setMockUserId(id);
            setMockUserType('user');
            setMockWalletAddress(user.wallet_address || wallet || `MOCK_USER_${id.slice(0, 8)}`);
          } catch {
            setMockUserId(userRaw);
            setMockUserType('user');
            setMockWalletAddress(wallet || `MOCK_USER_${userRaw.slice(0, 8)}`);
          }
        } else {
          setMockUserId(null);
          setMockWalletAddress(null);
        }
      } catch {
        // localStorage not available
      }
    };

    checkUser();

    // Poll for changes (localStorage doesn't have a native change event in same tab)
    const interval = setInterval(checkUser, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch balance from DB
  const refreshBalances = useCallback(async () => {
    if (!mockUserId) {
      setUsdtBalance(null);
      return;
    }

    try {
      const res = await fetch(`/api/mock/balance?userId=${mockUserId}&type=${mockUserType}`);
      if (res.ok) {
        const data = await res.json();
        setUsdtBalance(data.balance ?? 0);
      }
    } catch (error) {
      console.error('[MockWallet] Failed to fetch balance:', error);
    }
  }, [mockUserId, mockUserType]);

  // Refresh balance when user changes + poll every 5s
  useEffect(() => {
    if (mockUserId) {
      refreshBalances();
      const interval = setInterval(refreshBalances, 5000);
      return () => clearInterval(interval);
    }
  }, [mockUserId, refreshBalances]);

  // Mock deposit to escrow - returns demo tx hash
  // Balance deduction is handled server-side in the escrow POST endpoint
  const depositToEscrow = useCallback(async (params: {
    amount: number;
    merchantWallet?: string;
    tradeId?: number;
  }) => {
    if (!mockUserId) throw new Error('Not logged in');

    const tradeId = params.tradeId ?? Date.now();
    const txHash = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Refresh balance after a short delay (server deducts on escrow record)
    setTimeout(() => refreshBalances(), 1000);

    return {
      txHash,
      success: true,
      tradePda: `mock-trade-${tradeId}`,
      escrowPda: `mock-escrow-${tradeId}`,
      tradeId,
    };
  }, [mockUserId, refreshBalances]);

  // Mock deposit open (same as deposit)
  const depositToEscrowOpen = useCallback(async (params: {
    amount: number;
    tradeId?: number;
    side?: 'buy' | 'sell';
  }) => {
    return depositToEscrow({ amount: params.amount, tradeId: params.tradeId });
  }, [depositToEscrow]);

  // No-op mock operations that return success
  const mockTradeOp = useCallback(async (_params: Record<string, unknown>) => ({
    txHash: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    success: true,
    tradePda: 'mock-trade-pda',
    escrowPda: 'mock-escrow-pda',
    tradeId: Date.now(),
  }), []);

  const mockLaneOp = useCallback(async () => ({
    txHash: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    success: true,
    lanePda: 'mock-lane-pda',
    laneId: 1,
  }), []);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const value: any = {
    // Wallet state - auto-connected when user is logged in
    connected: !!mockUserId,
    connecting: false,
    publicKey: null,
    walletAddress: mockWalletAddress,

    // Actions
    connect: () => { /* no-op in mock mode */ },
    disconnect: () => {
      setMockUserId(null);
      setMockWalletAddress(null);
      setUsdtBalance(null);
    },
    openWalletModal: () => { /* no-op in mock mode */ },
    signMessage: async (message: Uint8Array) => {
      // Return a fake signature in mock mode
      const fakeSignature = new Uint8Array(64);
      for (let i = 0; i < 64; i++) fakeSignature[i] = Math.floor(Math.random() * 256);
      return fakeSignature;
    },

    // Balance - USDT from DB, SOL is fake
    solBalance: 1.5,
    usdtBalance,
    refreshBalances,

    // Lane operations (no-ops)
    createCorridor: mockLaneOp,
    fundCorridor: mockLaneOp,
    withdrawCorridor: mockLaneOp,
    getCorridorInfo: async () => null,

    // Trade operations
    createTrade: mockTradeOp,
    lockEscrow: mockTradeOp,
    releaseEscrow: mockTradeOp,
    refundEscrow: mockTradeOp,
    extendEscrow: mockTradeOp,
    fundEscrowOnly: mockTradeOp,
    acceptTrade: mockTradeOp,
    depositToEscrow,
    depositToEscrowOpen,

    // V2.3: Payment confirmation & disputes (no-ops)
    confirmPayment: mockTradeOp,
    openDispute: mockTradeOp,
    resolveDispute: mockTradeOp,

    // Network
    network: 'devnet' as const,
    programReady: true,
    reinitializeProgram: () => { /* no-op */ },
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <SolanaWalletContext.Provider value={value}>
      {children}
    </SolanaWalletContext.Provider>
  );
};

// Main mock provider - no Solana connection/wallet providers needed
export const MockWalletProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Don't render until client-side
  if (!isClient) {
    return <>{children}</>;
  }

  return (
    <MockWalletInnerProvider>
      {children}
    </MockWalletInnerProvider>
  );
};
