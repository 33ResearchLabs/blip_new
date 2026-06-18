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

// Generate a deterministic valid Solana-like base58 address from an ID
function mockBase58Address(seed: string): string {
  const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 44; i++) {
    const charCode = seed.charCodeAt(i % seed.length) + i;
    result += base58Chars[charCode % base58Chars.length];
  }
  return result;
}

// Mock provider that provides values into the same SolanaWalletContext
const MockWalletInnerProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);
  const [mockUserId, setMockUserId] = useState<string | null>(null);
  const [mockUserType, setMockUserType] = useState<'user' | 'merchant'>('user');
  const [mockWalletAddress, setMockWalletAddress] = useState<string | null>(null);

  // Discover the active user / merchant via cookie-authed /api/auth/me.
  // Identity used to come from `blip_user` / `blip_merchant` localStorage
  // entries — those are no longer written, so we ask the server who's logged
  // in instead. Polls every 10s + listens for the in-app `blip-auth-change`
  // signal so login/logout in another part of the app re-runs the probe.
  useEffect(() => {
    let cancelled = false;
    const checkUser = async () => {
      try {
        const res = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
        });
        if (cancelled) return;

        // 401 / non-OK → not logged in
        if (!res.ok) {
          setMockUserId(null);
          setMockWalletAddress(null);
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        if (!json?.success) {
          setMockUserId(null);
          setMockWalletAddress(null);
          return;
        }

        const wallet = (() => {
          try {
            return localStorage.getItem('blip_wallet');
          } catch {
            return null;
          }
        })();

        const actorType = json?.data?.actorType;
        if (actorType === 'merchant' && json?.data?.merchant?.id) {
          const merchant = json.data.merchant;
          setMockUserId(merchant.id);
          setMockUserType('merchant');
          setMockWalletAddress(
            merchant.wallet_address || wallet || `MOCK_MERCHANT_${String(merchant.id).slice(0, 8)}`
          );
        } else if (actorType === 'user' && json?.data?.user?.id) {
          const user = json.data.user;
          setMockUserId(user.id);
          setMockUserType('user');
          setMockWalletAddress(
            user.wallet_address || wallet || mockBase58Address(String(user.id))
          );
        } else {
          setMockUserId(null);
          setMockWalletAddress(null);
        }
      } catch {
        // Network error — leave state as-is rather than flap to logged-out;
        // a transient blip shouldn't kick the user out of mock mode.
      }
    };

    void checkUser();

    // In-app custom event fired by login / logout flows.
    const handleCustom = () => { void checkUser(); };

    // Slow fallback poll (10s) — covers cases where the custom event was
    // missed (e.g. another tab logged out and we have no storage event for
    // cookies). The cost is one tiny GET; not a hot path.
    const interval = setInterval(() => { void checkUser(); }, 10000);

    window.addEventListener('blip-auth-change', handleCustom);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('blip-auth-change', handleCustom);
    };
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

  // Mock create-and-lock (counterparty known at lock time). On real wallets this
  // differs from depositToEscrowOpen on-chain, but in mock mode there is no chain
  // — both just record escrow server-side — so it delegates the same way. Without
  // this the merchant lock flow (useEscrowOperations) throws
  // "createAndLockEscrow is not a function" in mock mode.
  const createAndLockEscrow = useCallback(async (params: {
    amount: number;
    counterparty?: string;
    side?: 'buy' | 'sell';
    tradeId?: number;
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
    createAndLockEscrow,

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
