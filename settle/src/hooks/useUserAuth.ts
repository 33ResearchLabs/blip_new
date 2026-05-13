"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Screen, Order, BankAccount } from "@/components/user/screens/types";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { useMerchantStore } from '@/stores/merchantStore';
import { clearAuthStorageOnLogout } from '@/lib/auth/logoutCleanup';
import {
  validateUserUsername,
  validateUserEmail,
  validateUserPassword,
} from '@/lib/validation/userAuth';

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
  // `email` is only collected on the register form; sign-in uses
  // username + password only. Keeping the shape unified avoids a separate
  // register-form state object and a discriminated union here.
  const [loginForm, setLoginForm] = useState({ username: "", password: "", email: "" });
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  // Carries the user id from a 403 EMAIL_NOT_VERIFIED response so the
  // UI can offer a "Resend verification email" affordance without
  // having to re-submit the password to identify the account.
  const [unverifiedUserId, setUnverifiedUserId] = useState<string | null>(null);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  // Set after a successful registration response while the user has not
  // yet clicked the verification link. The home screen refuses to mount
  // until it's cleared; the LandingPage renders a "check your inbox"
  // panel instead of the form so the user can't proceed without verifying.
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  // Surface a green "Email verified — sign in to continue" banner above the
  // sign-in form once polling (or the manual "I've verified" button)
  // detects the email is verified.
  const [verificationSuccessNotice, setVerificationSuccessNotice] = useState(false);

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
      // Server-issued nonce flow — no client-generated nonce. The legacy
      // dual-mode (LOGIN_NONCE_REQUIRED=false) was removed; this path now
      // requires a fresh, single-use nonce from /api/auth/nonce.
      const { signLoginNonce } = await import('@/lib/auth/walletAuth');
      const { nonce, message, signature } = await signLoginNonce(walletAddress, signFn);

      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_username',
          wallet_address: walletAddress,
          signature,
          message,
          nonce,
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
      setLoginError('Username or email and password are required');
      return;
    }
    setIsLoggingIn(true);
    setLoginError("");

    try {
      // `loginForm.username` may hold a username or an email — server disambiguates
      // by the presence of `@`. Backward-compat: still send `username` so older
      // server builds keep working; new server prefers `identifier`.
      const identifier = loginForm.username.trim();
      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier,
          username: identifier,
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
        setUnverifiedUserId(null);
        setScreen('home');
      } else if (data.code === 'EMAIL_NOT_VERIFIED') {
        // Same pattern useDashboardAuth uses on the merchant side: surface
        // the sentinel string as the error and stash the user id so the
        // login screen can render a "Resend verification email" button.
        setLoginError('EMAIL_NOT_VERIFIED');
        setUnverifiedUserId(data.userId || null);
      } else {
        setLoginError(data.error || 'Login failed');
        setUnverifiedUserId(null);
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Connection failed');
      setUnverifiedUserId(null);
    } finally {
      setIsLoggingIn(false);
    }
  }, [loginForm, setScreen, fetchOrders, fetchBankAccounts, fetchResolvedDisputes]);

  // Re-issue the verification email when the login screen surfaces
  // EMAIL_NOT_VERIFIED. Best-effort fire-and-forget shape mirroring the
  // merchant flow — the server always returns success to prevent
  // account-existence enumeration via this endpoint.
  const handleResendVerification = useCallback(async () => {
    const targetId = unverifiedUserId;
    const targetEmail = loginForm.email?.trim();
    if (!targetId && !targetEmail) return;
    setIsResendingVerification(true);
    try {
      await fetchWithAuth('/api/auth/user/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          targetId ? { userId: targetId } : { email: targetEmail }
        ),
      });
    } catch (err) {
      console.error('Resend verification error:', err);
    } finally {
      setIsResendingVerification(false);
    }
  }, [unverifiedUserId, loginForm.email]);

  const handleUserRegister = useCallback(async () => {
    const email = loginForm.email?.trim() ?? '';
    // Single source of truth for the rules — same module the API uses, so
    // the message the user sees here matches what would come back from the
    // server if they bypassed the client check.
    const usernameErr = validateUserUsername(loginForm.username);
    if (usernameErr) { setLoginError(usernameErr); return; }
    const emailErr = validateUserEmail(email);
    if (emailErr) { setLoginError(emailErr); return; }
    const passwordErr = validateUserPassword(loginForm.password);
    if (passwordErr) { setLoginError(passwordErr); return; }

    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: loginForm.username.trim(),
          password: loginForm.password,
          email,
          action: 'register',
        }),
      });

      const data = await res.json();

      if (data.success && data.data.user) {
        // Registration is NOT complete until the user clicks the
        // verification link. The backend now returns
        // requiresEmailVerification=true and does not issue auth cookies
        // on this response — so flipping the user into the home screen
        // here would put the UI in a "logged in" state with no real
        // session, and every protected call would 401. Show a check-
        // your-inbox panel instead, and capture the user id so polling
        // (and the resend button) can target this account.
        if (data.data.requiresEmailVerification) {
          setPendingVerificationEmail(loginForm.email.trim().toLowerCase());
          setUnverifiedUserId(data.data.user.id);
          setLoginError('');
          // Clear the password so it doesn't linger in memory while the
          // user goes to check their inbox.
          setLoginForm(p => ({ ...p, password: '' }));
          return;
        }
        // Fallback path: backend chose not to require email verification
        // for this account (e.g. an admin-provisioned bypass). Same as
        // before — log them in.
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

  const clearPendingVerification = useCallback(() => {
    setPendingVerificationEmail(null);
    setUnverifiedUserId(null);
    setLoginError('');
  }, []);

  const dismissVerificationSuccess = useCallback(() => {
    setVerificationSuccessNotice(false);
  }, []);

  // Poll the backend while the "check your inbox" panel is shown so we can
  // auto-advance the moment the user clicks the verification link —
  // including when that click happens on a different device (phone, etc).
  // Server-authoritative: there is no client-side trust, no localStorage,
  // and no cross-tab signal. The endpoint returns only { verified: boolean }
  // and is rate-limited so polling can't be weaponised.
  //
  // Cadence: every 4s for the first minute, then back off to every 12s.
  // Stop polling after 15 minutes — link still works, user just has to
  // hit "I've verified my email" manually. Also polls immediately on
  // window focus so returning to this tab feels instant.
  //
  // Mirrors useDashboardAuth's polling effect — keep them in sync.
  useEffect(() => {
    if (!pendingVerificationEmail || !unverifiedUserId) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const advanceOnVerified = () => {
      if (cancelled) return;
      // Pre-fill the sign-in identifier so the user only has to type
      // their password. Identity is already confirmed server-side; this
      // is purely a convenience.
      setLoginForm(p => ({ ...p, username: p.email || p.username }));
      setPendingVerificationEmail(null);
      setUnverifiedUserId(null);
      setAuthMode('login');
      setVerificationSuccessNotice(true);
    };

    const checkOnce = async () => {
      if (cancelled) return;
      try {
        const res = await fetchWithAuth(
          `/api/auth/user/verification-status?userId=${encodeURIComponent(unverifiedUserId)}`,
          { method: 'GET' },
        );
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        if (data?.success && data?.verified) {
          advanceOnVerified();
        }
      } catch {
        // Network blip — wait for next tick.
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed > 15 * 60_000) return;
      const delay = elapsed < 60_000 ? 4_000 : 12_000;
      timer = setTimeout(async () => {
        await checkOnce();
        scheduleNext();
      }, delay);
    };

    void checkOnce();
    scheduleNext();

    const onFocus = () => { void checkOnce(); };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [pendingVerificationEmail, unverifiedUserId]);

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
          // The server has already told us the session is gone — run the
          // shared logout sweep so we drop EVERY auth/identity key + any
          // unlocked wallet session material in one place, not just the
          // two we used to remove. Otherwise the next account on this
          // device could see stale walletAddress / blip_wallet_session:*.
          clearAuthStorageOnLogout();
        }
      } catch (err) {
        console.error('[Session] Failed to restore session:', err);
        clearAuthStorageOnLogout();
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
    // EMAIL_NOT_VERIFIED surface — login screen consumes these to show
    // a "Resend verification email" affordance when the user hits the
    // verification gate. unverifiedUserId is null in the happy path.
    unverifiedUserId,
    isResendingVerification,
    handleResendVerification,
    // Post-signup verification gate — set when registration succeeds but
    // the user has not yet clicked the email link. LandingPage renders a
    // "check your inbox" panel until the polling effect detects
    // verification (or the user dismisses manually).
    pendingVerificationEmail,
    clearPendingVerification,
    verificationSuccessNotice,
    dismissVerificationSuccess,
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
