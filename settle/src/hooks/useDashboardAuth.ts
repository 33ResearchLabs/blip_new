"use client";

import { useState, useEffect, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface UseDashboardAuthParams {
  isMockMode: boolean;
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    signMessage?: (msg: Uint8Array) => Promise<Uint8Array>;
    disconnect?: () => void;
  };
  setShowWalletPrompt: (show: boolean) => void;
  setShowUsernameModal: (show: boolean) => void;
}

export function useDashboardAuth({
  isMockMode,
  solanaWallet,
  setShowWalletPrompt,
  setShowUsernameModal,
}: UseDashboardAuthParams) {
  const merchantId = useMerchantStore(s => s.merchantId);
  const setMerchantId = useMerchantStore(s => s.setMerchantId);
  const merchantInfo = useMerchantStore(s => s.merchantInfo);
  const setMerchantInfo = useMerchantStore(s => s.setMerchantInfo);
  const setIsLoggedIn = useMerchantStore(s => s.setIsLoggedIn);
  const isLoggedIn = useMerchantStore(s => s.isLoggedIn);
  const setIsLoading = useMerchantStore(s => s.setIsLoading);
  const setSessionToken = useMerchantStore(s => s.setSessionToken);

  // Auth UI state
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ email: "", password: "", confirmPassword: "", businessName: "" });
  const [authTab, setAuthTab] = useState<'signin' | 'create'>('signin');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Email verification state
  const [unverifiedMerchantId, setUnverifiedMerchantId] = useState<string | null>(null);
  const [isResendingVerification, setIsResendingVerification] = useState(false);

  // 2FA state
  const [pending2FA, setPending2FA] = useState<{ pendingToken: string; merchantName: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);

  const handleMerchantUsername = useCallback(async (username: string) => {
    if (!solanaWallet.connected || !solanaWallet.walletAddress) {
      throw new Error("Wallet not connected");
    }
    if (!username.trim()) {
      throw new Error("Username is required");
    }

    try {
      if (merchantId && merchantInfo) {
        const res = await fetchWithAuth('/api/auth/merchant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_username',
            merchant_id: merchantId,
            username: username.trim(),
          }),
        });
        const data = await res.json();
        if (data.success) {
          const updatedMerchant = { ...merchantInfo, username: username.trim() };
          // In-memory only. The durable copy of "who am I" lives in the
          // signed cookie + the DB; on reload we re-fetch via /api/auth/me.
          setMerchantInfo(updatedMerchant);
          setIsLoggedIn(true);
          setShowUsernameModal(false);
        } else {
          throw new Error(data.error || 'Failed to update username');
        }
        return;
      }

      if (!solanaWallet.signMessage) {
        throw new Error("Wallet signature method not available");
      }

      // Server-issued nonce flow — replay-safe.
      const { signLoginNonce } = await import('@/lib/auth/walletAuth');
      const { nonce, message, signature } = await signLoginNonce(
        solanaWallet.walletAddress,
        solanaWallet.signMessage,
      );

      const res = await fetchWithAuth('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_merchant',
          wallet_address: solanaWallet.walletAddress,
          signature,
          message,
          nonce,
          username: username.trim(),
        }),
      });

      const data = await res.json();
      if (data.success && data.data.merchant) {
        const merchant = data.data.merchant;
        setMerchantId(merchant.id);
        setMerchantInfo(merchant);
        setIsLoggedIn(true);
        setShowUsernameModal(false);
        // Identity persisted by the cookie set on this same response
        // (Set-Cookie: blip_access_token / blip_refresh_token). Nothing
        // to mirror to localStorage.
        if (data.data.token) setSessionToken(data.data.token);
      } else {
        throw new Error(data.error || 'Failed to create merchant');
      }
    } catch (error) {
      console.error('Set merchant username error:', error);
      throw error;
    }
  }, [merchantId, merchantInfo, solanaWallet, setMerchantId, setMerchantInfo, setIsLoggedIn, setShowUsernameModal]);

  const handleProfileUpdated = useCallback((avatarUrl: string, displayName?: string, bio?: string) => {
    if (merchantInfo) {
      const updatedInfo = {
        ...merchantInfo,
        avatar_url: avatarUrl || merchantInfo.avatar_url,
        ...(displayName !== undefined && { display_name: displayName }),
        ...(bio !== undefined && { bio }),
      };
      setMerchantInfo(updatedInfo);
    }
  }, [merchantInfo, setMerchantInfo]);

  const handleLogin = useCallback(async () => {
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginForm.email.trim().toLowerCase(),
          password: loginForm.password,
          action: 'login',
        }),
      });

      const data = await res.json();
      if (data.success && data.data?.requires2FA) {
        // 2FA required — show TOTP input screen
        setPending2FA({
          pendingToken: data.data.pendingToken,
          merchantName: data.data.merchant?.display_name || 'Merchant',
        });
        setTotpCode('');
      } else if (data.success && data.data.merchant) {
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        if (data.data.token) setSessionToken(data.data.token);
        if (!isMockMode && !data.data.merchant.wallet_address) {
          setTimeout(() => setShowWalletPrompt(true), 500);
        }
      } else {
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          setLoginError('EMAIL_NOT_VERIFIED');
          setUnverifiedMerchantId(data.merchantId || null);
        } else if (res.status === 401) {
          setLoginError('Incorrect email or password. Please try again.');
        } else if (res.status === 404) {
          setLoginError('No account found with this email. Please create an account first.');
        } else {
          setLoginError(data.error || 'Login failed');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Connection failed. Please check your internet and try again.');
    } finally {
      setIsLoggingIn(false);
    }
  }, [loginForm, isMockMode, setMerchantId, setMerchantInfo, setIsLoggedIn, setShowWalletPrompt]);

  const handle2FAVerify = useCallback(async () => {
    if (!pending2FA || !/^\d{6}$/.test(totpCode)) return;
    // Re-entrancy guard: pending tokens are single-use, so a double-fire
    // (StrictMode, double click, etc.) would consume the token on the first
    // call and then fail on the second with "Invalid or expired login token".
    if (isVerifying2FA) return;
    setIsVerifying2FA(true);
    setLoginError('');

    // Snapshot the token now so we can clear it from state immediately —
    // prevents any concurrent invocation from re-using the same value.
    const tokenForThisCall = pending2FA.pendingToken;

    try {
      const res = await fetchWithAuth('/api/2fa/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pendingToken: tokenForThisCall,
          code: totpCode,
        }),
      });

      const data = await res.json();
      if (data.success && data.data?.merchant) {
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        if (data.data.token) setSessionToken(data.data.token);
        setPending2FA(null);
        setTotpCode('');
        if (!isMockMode && !data.data.merchant.wallet_address) {
          setTimeout(() => setShowWalletPrompt(true), 500);
        }
      } else {
        if (data.error?.includes('Invalid or expired login token')) {
          setLoginError('Your login session timed out. Please log in again.');
          // Force user back to the login screen so they get a fresh pending token
          setPending2FA(null);
        } else {
          setLoginError(data.error || 'Invalid authenticator code');
        }
        setTotpCode('');
      }
    } catch {
      setLoginError('Connection failed. Please try again.');
    } finally {
      setIsVerifying2FA(false);
    }
  }, [pending2FA, totpCode, isVerifying2FA, isMockMode, setMerchantId, setMerchantInfo, setIsLoggedIn, setShowWalletPrompt, setSessionToken]);

  const cancel2FA = useCallback(() => {
    setPending2FA(null);
    setTotpCode('');
    setLoginError('');
  }, []);

  const resendVerificationEmail = useCallback(async () => {
    if (!unverifiedMerchantId) return;
    setIsResendingVerification(true);
    try {
      await fetchWithAuth('/api/auth/merchant/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: unverifiedMerchantId }),
      });
      setLoginError('Verification email sent! Check your inbox.');
      setUnverifiedMerchantId(null);
    } catch {
      setLoginError('Failed to resend. Please try again.');
    } finally {
      setIsResendingVerification(false);
    }
  }, [unverifiedMerchantId]);

  const handleRegister = useCallback(async () => {
    if (registerForm.password !== registerForm.confirmPassword) {
      setLoginError('Passwords do not match');
      return;
    }
    if (registerForm.password.length < 6) {
      setLoginError('Password must be at least 6 characters');
      return;
    }

    setIsRegistering(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          email: registerForm.email.trim().toLowerCase(),
          password: registerForm.password,
          business_name: registerForm.businessName?.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.data.merchant) {
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        if (data.data.token) setSessionToken(data.data.token);
        if (!isMockMode) {
          setTimeout(() => setShowWalletPrompt(true), 500);
        }
      } else {
        if (res.status === 409) {
          setLoginError('An account with this email already exists. Please sign in instead.');
        } else {
          setLoginError(data.error || 'Registration failed');
        }
      }
    } catch (err) {
      console.error('Registration error:', err);
      setLoginError('Connection failed. Please check your internet and try again.');
    } finally {
      setIsRegistering(false);
    }
  }, [registerForm, isMockMode, setMerchantId, setMerchantInfo, setIsLoggedIn, setShowWalletPrompt]);

  const handleLogout = useCallback(() => {
    // Server-side logout — invalidates the session row and clears the
    // httpOnly cookies (Set-Cookie: blip_access_token=; Max-Age=0 + same
    // for the refresh cookie). Fire-and-forget with `keepalive` so the
    // request still flushes if the redirect happens first.
    try {
      void fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      });
    } catch { /* network error — redirect proceeds anyway */ }

    // Per-merchant ephemeral keys (inr_cash_*, blip_unrecorded_escrow_*)
    // are non-secret operational state that the merchant dashboard caches
    // between sessions. They are not auth material — but on logout we
    // still wipe them so the next user on this device doesn't see them.
    try {
      const keysToRemove = Object.keys(localStorage).filter(k =>
        k.startsWith('inr_cash_') || k.startsWith('blip_unrecorded_escrow_')
      );
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch { /* ignore */ }

    // In-memory store: drop the access-token mirror and identity. The
    // durable copies live in the cookies (cleared above) and the DB.
    setSessionToken(null);
    if (solanaWallet.disconnect) {
      solanaWallet.disconnect();
    }
    window.location.href = '/merchant';
  }, [solanaWallet, setSessionToken]);

  // Session restore on mount.
  //
  // Identity is whatever the cookie-bound session says it is. We hit
  // /api/auth/me (cookie auth, no body) and either populate the store
  // with the resolved merchant or leave the user logged-out. There is no
  // localStorage probe — client-stored identity was a foot-gun and is gone.
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const meRes = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          if (
            meData?.success &&
            meData?.data?.actorType === 'merchant' &&
            meData?.data?.merchant?.id
          ) {
            const freshMerchant = meData.data.merchant;
            setMerchantId(freshMerchant.id);
            setMerchantInfo(freshMerchant);
            setIsLoggedIn(true);
            // Mirror the cookie's existence into sessionToken so the silent
            // refresh in fetchWithAuth fires when the 15-min access cookie
            // expires. Without this, the refresh gate (`!!sessionToken`) is
            // false on every page reload and 401s short-circuit instead of
            // refreshing — see useComplianceAuth for the same fix.
            setSessionToken('cookie-session');
            // Defer to useOrderFetching to flip isLoading off after the
            // first orders payload lands. Safety net at 5s for slow links.
            setTimeout(() => setIsLoading(false), 5000);
            if (
              !isMockMode &&
              !freshMerchant.wallet_address &&
              !solanaWallet.connected
            ) {
              setTimeout(() => setShowWalletPrompt(true), 1000);
            }
            return;
          }
        }
        // 401 / non-merchant actor / shape mismatch → not logged in. No
        // local state to clean up because we no longer keep any.
      } catch (err) {
        console.error('[Merchant] Failed to restore session:', err);
      }
      setIsLoading(false);
    };
    restoreSession();
  }, []); // Only run once on mount

  // Body class for dashboard layout
  useEffect(() => {
    if (isLoggedIn && merchantId) {
      document.body.classList.add('dashboard-layout');
    } else {
      document.body.classList.remove('dashboard-layout');
    }
    return () => {
      document.body.classList.remove('dashboard-layout');
    };
  }, [isLoggedIn, merchantId]);

  return {
    // Auth UI state
    loginForm, setLoginForm,
    registerForm, setRegisterForm,
    authTab, setAuthTab,
    loginError, setLoginError,
    isLoggingIn, isRegistering,

    // Email verification state
    unverifiedMerchantId, isResendingVerification, resendVerificationEmail,

    // 2FA state
    pending2FA, totpCode, setTotpCode, isVerifying2FA,
    handle2FAVerify, cancel2FA,

    // Auth actions
    handleLogin,
    handleRegister,
    handleLogout,
    handleMerchantUsername,
    handleProfileUpdated,
  };
}
