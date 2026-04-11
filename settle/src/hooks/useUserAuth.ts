"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Screen, Order, BankAccount } from "@/components/user/screens/types";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { useMerchantStore } from '@/stores/merchantStore';

interface UseUserAuthParams {
  setScreen: (s: Screen) => void;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setBankAccounts: React.Dispatch<React.SetStateAction<BankAccount[]>>;
  setResolvedDisputes: React.Dispatch<React.SetStateAction<any[]>>;
  solanaWallet: any;
  escrowTxStatus: string;
  setEscrowTxStatus: (s: 'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error') => void;
  fetchOrders: (uid: string) => Promise<void>;
  fetchBankAccounts: (uid: string) => Promise<void>;
  fetchResolvedDisputes: (uid: string) => Promise<void>;
}

export function useUserAuth({
  setScreen,
  setOrders,
  setBankAccounts,
  setResolvedDisputes,
  solanaWallet,
  escrowTxStatus,
  setEscrowTxStatus,
  fetchOrders,
  fetchBankAccounts,
  fetchResolvedDisputes,
}: UseUserAuthParams) {
  const [userId, setUserId] = useState<string | null>(null);
  const [userWallet, setUserWallet] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("Guest");
  const [userBalance, setUserBalance] = useState<number>(0);
  const [newUserName, setNewUserName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Solana wallet state
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [walletUsername, setWalletUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isAuthenticatingRef = useRef(false);
  const lastAuthenticatedWalletRef = useRef<string | null>(null);
  const authAttemptedForWalletRef = useRef<string | null>(null);

  // Embedded wallet UI state
  const [showWalletSetup, setShowWalletSetup] = useState(false);
  const [showWalletUnlock, setShowWalletUnlock] = useState(false);

  const connectWallet = useCallback(async (walletAddress: string, name?: string) => {
    try {
      const res = await fetchWithAuth('/api/auth/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet_address: walletAddress, type: 'user', name }),
      });
      if (!res.ok) {
        console.log('Auth API not available - running in demo mode');
        return false;
      }
      const data = await res.json();
      if (data.success && data.data.user) {
        const user = data.data.user;
        setUserId(user.id);
        setUserWallet(walletAddress);
        setUserName(user.name || 'User');
        localStorage.setItem('blip_wallet', walletAddress);
        if (data.data.token) useMerchantStore.getState().setSessionToken(data.data.token);
        fetchOrders(user.id);
        fetchBankAccounts(user.id);
        fetchResolvedDisputes(user.id);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      return false;
    }
  }, [fetchOrders, fetchBankAccounts, fetchResolvedDisputes]);

  const escrowTxStatusRef = useRef(escrowTxStatus);
  const setEscrowTxStatusRef = useRef(setEscrowTxStatus);
  escrowTxStatusRef.current = escrowTxStatus;
  setEscrowTxStatusRef.current = setEscrowTxStatus;

  const handleSolanaWalletConnect = useCallback(async (walletAddress: string) => {
    console.log('[User] Wallet connected via modal:', walletAddress);
    setShowWalletModal(false);
    if (escrowTxStatusRef.current === 'connecting') {
      setEscrowTxStatusRef.current('idle');
      console.log('[Wallet] Connected during escrow flow, user can now click Confirm & Lock');
    }
  }, []);

  const createAccount = useCallback(async () => {
    if (!newUserName.trim()) return;
    setIsLoading(true);
    const randomWallet = '0x' + Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    const success = await connectWallet(randomWallet, newUserName.trim());
    setIsLoading(false);
    if (success) {
      setNewUserName('');
      setScreen('home');
    }
  }, [connectWallet, newUserName, setScreen]);

  const handleWalletUsername = useCallback(async (username: string) => {
    const phantom = (window as any).phantom?.solana;
    const walletAddress = solanaWallet.walletAddress || phantom?.publicKey?.toString();
    const signFn = solanaWallet.signMessage || (phantom?.signMessage ? async (msg: Uint8Array) => {
      const result = await phantom.signMessage(msg, 'utf8');
      return result.signature;
    } : null);

    if (!walletAddress || !signFn) {
      throw new Error("Wallet not connected");
    }
    if (!username.trim()) {
      throw new Error("Username is required");
    }

    try {
      const timestamp = Date.now();
      const nonce = Math.random().toString(36).substring(7);
      const message = `Sign this message to authenticate with Blip Money\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signatureUint8 = await signFn(encodedMessage);
      const bs58 = await import('bs58');
      const signature = bs58.default.encode(signatureUint8);

      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_username',
          wallet_address: walletAddress,
          signature,
          message,
          username: username.trim(),
        }),
      });

      const data = await res.json();

      if (data.success && data.data.user) {
        const user = data.data.user;
        setUserId(user.id);
        setUserWallet(user.wallet_address);
        setUserName(user.username || user.name || 'User');
        setUserBalance(user.balance || 0);
        localStorage.setItem('blip_user', JSON.stringify(user));
        if (data.data.token) useMerchantStore.getState().setSessionToken(data.data.token);
        fetchOrders(user.id);
        fetchBankAccounts(user.id);
        fetchResolvedDisputes(user.id);
        setShowUsernameModal(false);
        setWalletUsername("");
        setScreen('home');
      } else {
        throw new Error(data.error || 'Failed to set username');
      }
    } catch (error) {
      console.error('Set username error:', error);
      throw error;
    }
  }, [solanaWallet, setScreen, fetchOrders, fetchBankAccounts, fetchResolvedDisputes]);

  const handleUserLogin = useCallback(async () => {
    if (!loginForm.username || !loginForm.password) {
      setLoginError('Username and password are required');
      return;
    }
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password,
          action: 'login',
        }),
      });

      const data = await res.json();

      if (data.success && data.data.user) {
        const user = data.data.user;
        setUserId(user.id);
        setUserWallet(user.wallet_address);
        setUserName(user.username || user.name || 'User');
        setUserBalance(user.balance || 0);
        localStorage.setItem('blip_user', JSON.stringify(user));
        if (data.data.token) useMerchantStore.getState().setSessionToken(data.data.token);
        fetchOrders(user.id);
        fetchBankAccounts(user.id);
        fetchResolvedDisputes(user.id);
        setScreen('home');
      } else {
        setLoginError(data.error || 'Login failed');
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Connection failed');
    } finally {
      setIsLoggingIn(false);
    }
  }, [loginForm, setScreen, fetchOrders, fetchBankAccounts, fetchResolvedDisputes]);

  const handleUserRegister = useCallback(async () => {
    if (!loginForm.username || !loginForm.password) {
      setLoginError('Username and password are required');
      return;
    }
    if (loginForm.username.length < 3) {
      setLoginError('Username must be at least 3 characters');
      return;
    }
    if (loginForm.password.length < 6) {
      setLoginError('Password must be at least 6 characters');
      return;
    }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginForm.username,
          password: loginForm.password,
          action: 'register',
        }),
      });

      const data = await res.json();

      if (data.success && data.data.user) {
        const user = data.data.user;
        setUserId(user.id);
        setUserWallet(user.wallet_address);
        setUserName(user.username || user.name || 'User');
        setUserBalance(user.balance || 0);
        localStorage.setItem('blip_user', JSON.stringify(user));
        if (data.data.token) useMerchantStore.getState().setSessionToken(data.data.token);
        fetchOrders(user.id);
        fetchBankAccounts(user.id);
        fetchResolvedDisputes(user.id);
        setScreen('home');
      } else {
        setLoginError(data.error || 'Registration failed');
      }
    } catch (err) {
      console.error('Registration error:', err);
      setLoginError('Connection failed');
    } finally {
      setIsLoggingIn(false);
    }
  }, [loginForm, setScreen, fetchOrders, fetchBankAccounts, fetchResolvedDisputes]);

  // Initialize - restore session if available
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedUser = localStorage.getItem('blip_user');
        const savedWallet = localStorage.getItem('blip_wallet');

        if (savedUser) {
          const user = JSON.parse(savedUser);
          console.log('[Session] Restoring user session:', user.username);

          const checkRes = await fetchWithAuth(`/api/auth/user?action=check_session&user_id=${user.id}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.success && checkData.data?.valid) {
              setUserId(user.id);
              setUserName(user.username || user.name || 'User');
              setUserBalance(user.balance || 0);
              if (checkData.data.token) useMerchantStore.getState().setSessionToken(checkData.data.token);
              if (savedWallet) {
                setUserWallet(savedWallet);
              }
              fetchOrders(user.id);
              fetchBankAccounts(user.id);
              fetchResolvedDisputes(user.id);
              // Fetch fresh balance from DB (mock mode only)
              if (process.env.NEXT_PUBLIC_MOCK_MODE === 'true') {
                fetchWithAuth(`/api/mock/balance?userId=${user.id}&type=user`)
                  .then(r => r.ok ? r.json() : null)
                  .then(data => {
                    if (data?.success && data.balance !== undefined) {
                      setUserBalance(data.balance);
                    }
                  })
                  .catch(() => {});
              }
              setScreen('home');
              setIsInitializing(false);
              return;
            }
          }
          console.log('[Session] User session invalid, clearing...');
          localStorage.removeItem('blip_user');
          localStorage.removeItem('blip_wallet');
        }
      } catch (err) {
        console.error('[Session] Failed to restore session:', err);
        localStorage.removeItem('blip_user');
        localStorage.removeItem('blip_wallet');
      }

      setScreen('welcome');
      setIsInitializing(false);
    };

    restoreSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    userId, setUserId,
    userWallet, setUserWallet,
    userName, setUserName,
    userBalance, setUserBalance,
    newUserName, setNewUserName,
    isLoading, setIsLoading,
    isInitializing,
    loginForm, setLoginForm,
    authMode, setAuthMode,
    loginError, setLoginError,
    isLoggingIn,
    showWalletModal, setShowWalletModal,
    showUsernameModal, setShowUsernameModal,
    walletUsername, setWalletUsername,
    usernameError, setUsernameError,
    isAuthenticating, setIsAuthenticating,
    isAuthenticatingRef,
    lastAuthenticatedWalletRef,
    authAttemptedForWalletRef,
    showWalletSetup, setShowWalletSetup,
    showWalletUnlock, setShowWalletUnlock,
    connectWallet,
    handleSolanaWalletConnect,
    createAccount,
    handleWalletUsername,
    handleUserLogin,
    handleUserRegister,
  };
}
