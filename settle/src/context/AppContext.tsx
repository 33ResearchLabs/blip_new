'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '@/lib/api/client';
import type { User, Order, OrderWithRelations, MerchantOfferWithMerchant, UserBankAccount } from '@/lib/types/database';

// Types for context
interface AppState {
  // Auth
  user: User | null;
  isLoading: boolean;
  isConnected: boolean;

  // Orders
  orders: OrderWithRelations[];
  activeOrder: OrderWithRelations | null;

  // Bank Accounts
  bankAccounts: UserBankAccount[];

  // Trade settings
  tradePreference: 'fast' | 'cheap' | 'best';
  paymentMethod: 'bank' | 'cash';
}

interface AppContextType extends AppState {
  // Auth actions
  connectWallet: (walletAddress: string) => Promise<void>;
  disconnectWallet: () => void;

  // Order actions
  createOrder: (amount: number, type: 'buy' | 'sell') => Promise<OrderWithRelations>;
  fetchOrders: () => Promise<void>;
  setActiveOrder: (orderId: string | null) => void;
  updateOrderStatus: (orderId: string, status: string) => Promise<void>;
  cancelOrder: (orderId: string, reason?: string) => Promise<void>;
  submitReview: (orderId: string, rating: number, comment?: string) => Promise<void>;

  // Bank account actions
  fetchBankAccounts: () => Promise<void>;
  addBankAccount: (data: { bank_name: string; account_name: string; iban: string }) => Promise<void>;

  // Settings
  setTradePreference: (pref: 'fast' | 'cheap' | 'best') => void;
  setPaymentMethod: (method: 'bank' | 'cash') => void;

  // Refresh
  refreshOrder: (orderId: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>({
    user: null,
    isLoading: true,
    isConnected: false,
    orders: [],
    activeOrder: null,
    bankAccounts: [],
    tradePreference: 'fast',
    paymentMethod: 'bank',
  });

  // Load saved user on mount
  useEffect(() => {
    const savedWallet = localStorage.getItem('walletAddress');
    if (savedWallet) {
      connectWallet(savedWallet).finally(() => {
        setState(s => ({ ...s, isLoading: false }));
      });
    } else {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, []);

  // Connect wallet
  const connectWallet = useCallback(async (walletAddress: string) => {
    try {
      const result = await api.auth.connectWallet(walletAddress, 'user') as { type: string; user: User };

      if (result.type === 'user' && result.user) {
        localStorage.setItem('walletAddress', walletAddress);
        setState(s => ({
          ...s,
          user: result.user,
          isConnected: true,
        }));

        // Fetch related data
        fetchOrders();
        fetchBankAccounts();
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }, []);

  // Disconnect wallet
  const disconnectWallet = useCallback(() => {
    localStorage.removeItem('walletAddress');
    setState(s => ({
      ...s,
      user: null,
      isConnected: false,
      orders: [],
      activeOrder: null,
      bankAccounts: [],
    }));
  }, []);

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    if (!state.user?.id) return;

    try {
      const orders = await api.orders.list(state.user.id) as OrderWithRelations[];
      setState(s => ({ ...s, orders }));
    } catch (error) {
      console.error('Failed to fetch orders:', error);
    }
  }, [state.user?.id]);

  // Create order
  const createOrder = useCallback(async (amount: number, type: 'buy' | 'sell'): Promise<OrderWithRelations> => {
    if (!state.user?.id) throw new Error('Not connected');

    const order = await api.orders.create({
      user_id: state.user.id,
      crypto_amount: amount,
      type,
      payment_method: state.paymentMethod,
      preference: state.tradePreference,
    }) as OrderWithRelations;

    setState(s => ({
      ...s,
      orders: [order, ...s.orders],
      activeOrder: order,
    }));

    return order;
  }, [state.user?.id, state.paymentMethod, state.tradePreference]);

  // Set active order
  const setActiveOrder = useCallback((orderId: string | null) => {
    if (!orderId) {
      setState(s => ({ ...s, activeOrder: null }));
      return;
    }

    const order = state.orders.find(o => o.id === orderId);
    if (order) {
      setState(s => ({ ...s, activeOrder: order }));
    } else {
      // Fetch from API if not in local state
      refreshOrder(orderId);
    }
  }, [state.orders]);

  // Refresh single order
  const refreshOrder = useCallback(async (orderId: string) => {
    try {
      const order = await api.orders.get(orderId) as OrderWithRelations;
      setState(s => ({
        ...s,
        orders: s.orders.map(o => o.id === orderId ? order : o),
        activeOrder: s.activeOrder?.id === orderId ? order : s.activeOrder,
      }));
    } catch (error) {
      console.error('Failed to refresh order:', error);
    }
  }, []);

  // Update order status
  const updateOrderStatus = useCallback(async (orderId: string, status: string) => {
    if (!state.user?.id) throw new Error('Not connected');

    await api.orders.updateStatus(orderId, status, 'user', state.user.id);
    await refreshOrder(orderId);
  }, [state.user?.id, refreshOrder]);

  // Cancel order
  const cancelOrder = useCallback(async (orderId: string, reason?: string) => {
    if (!state.user?.id) throw new Error('Not connected');

    await api.orders.cancel(orderId, 'user', state.user.id, reason);

    setState(s => ({
      ...s,
      orders: s.orders.filter(o => o.id !== orderId),
      activeOrder: s.activeOrder?.id === orderId ? null : s.activeOrder,
    }));
  }, [state.user?.id]);

  // Submit review
  const submitReview = useCallback(async (orderId: string, rating: number, comment?: string) => {
    if (!state.user?.id) throw new Error('Not connected');

    const order = state.orders.find(o => o.id === orderId);
    if (!order) throw new Error('Order not found');

    await api.orders.submitReview(orderId, {
      reviewer_type: 'user',
      reviewer_id: state.user.id,
      reviewee_type: 'merchant',
      reviewee_id: order.merchant_id,
      rating,
      comment,
    });
  }, [state.user?.id, state.orders]);

  // Fetch bank accounts
  const fetchBankAccounts = useCallback(async () => {
    if (!state.user?.id) return;

    try {
      const accounts = await api.users.getBankAccounts(state.user.id) as UserBankAccount[];
      setState(s => ({ ...s, bankAccounts: accounts }));
    } catch (error) {
      console.error('Failed to fetch bank accounts:', error);
    }
  }, [state.user?.id]);

  // Add bank account
  const addBankAccount = useCallback(async (data: { bank_name: string; account_name: string; iban: string }) => {
    if (!state.user?.id) throw new Error('Not connected');

    const account = await api.users.addBankAccount(state.user.id, data) as UserBankAccount;
    setState(s => ({
      ...s,
      bankAccounts: [...s.bankAccounts, account],
    }));
  }, [state.user?.id]);

  // Settings
  const setTradePreference = useCallback((pref: 'fast' | 'cheap' | 'best') => {
    setState(s => ({ ...s, tradePreference: pref }));
  }, []);

  const setPaymentMethod = useCallback((method: 'bank' | 'cash') => {
    setState(s => ({ ...s, paymentMethod: method }));
  }, []);

  const value: AppContextType = {
    ...state,
    connectWallet,
    disconnectWallet,
    createOrder,
    fetchOrders,
    setActiveOrder,
    updateOrderStatus,
    cancelOrder,
    submitReview,
    fetchBankAccounts,
    addBankAccount,
    setTradePreference,
    setPaymentMethod,
    refreshOrder,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

// Individual hooks for specific functionality
export function useUser() {
  const { user, isConnected, isLoading, connectWallet, disconnectWallet } = useApp();
  return { user, isConnected, isLoading, connectWallet, disconnectWallet };
}

export function useOrders() {
  const { orders, activeOrder, fetchOrders, setActiveOrder, createOrder, updateOrderStatus, cancelOrder, refreshOrder } = useApp();
  return { orders, activeOrder, fetchOrders, setActiveOrder, createOrder, updateOrderStatus, cancelOrder, refreshOrder };
}

export function useBankAccounts() {
  const { bankAccounts, fetchBankAccounts, addBankAccount } = useApp();
  return { bankAccounts, fetchBankAccounts, addBankAccount };
}

export function useTradeSettings() {
  const { tradePreference, paymentMethod, setTradePreference, setPaymentMethod } = useApp();
  return { tradePreference, paymentMethod, setTradePreference, setPaymentMethod };
}
