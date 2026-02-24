"use client";

import { useState, useEffect, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";

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

  // Auth UI state
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ email: "", password: "", confirmPassword: "", businessName: "" });
  const [authTab, setAuthTab] = useState<'signin' | 'create'>('signin');
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleMerchantUsername = useCallback(async (username: string) => {
    if (!solanaWallet.connected || !solanaWallet.walletAddress) {
      throw new Error("Wallet not connected");
    }
    if (!username.trim()) {
      throw new Error("Username is required");
    }

    try {
      if (merchantId && merchantInfo) {
        const res = await fetch('/api/auth/merchant', {
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
          setMerchantInfo(updatedMerchant);
          setIsLoggedIn(true);
          setShowUsernameModal(false);
          localStorage.setItem('blip_merchant', JSON.stringify(updatedMerchant));
        } else {
          throw new Error(data.error || 'Failed to update username');
        }
        return;
      }

      if (!solanaWallet.signMessage) {
        throw new Error("Wallet signature method not available");
      }

      const timestamp = Date.now();
      const nonce = Math.random().toString(36).substring(7);
      const message = `Sign this message to authenticate with Blip Money\n\nWallet: ${solanaWallet.walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
      const encodedMessage = new TextEncoder().encode(message);
      const signatureUint8 = await solanaWallet.signMessage(encodedMessage);
      const bs58 = await import('bs58');
      const signature = bs58.default.encode(signatureUint8);

      const res = await fetch('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_merchant',
          wallet_address: solanaWallet.walletAddress,
          signature,
          message,
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
        localStorage.setItem('blip_merchant', JSON.stringify(merchant));
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
      localStorage.setItem('blip_merchant', JSON.stringify(updatedInfo));
    }
  }, [merchantInfo, setMerchantInfo]);

  const handleLogin = useCallback(async () => {
    setIsLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginForm.email,
          password: loginForm.password,
          action: 'login',
        }),
      });

      const data = await res.json();
      if (data.success && data.data.merchant) {
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        localStorage.setItem('blip_merchant', JSON.stringify(data.data.merchant));
        if (!isMockMode && !data.data.merchant.wallet_address) {
          setTimeout(() => setShowWalletPrompt(true), 500);
        }
      } else {
        if (res.status === 401) {
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
      const res = await fetch('/api/auth/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          email: registerForm.email,
          password: registerForm.password,
          business_name: registerForm.businessName || undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.data.merchant) {
        setMerchantId(data.data.merchant.id);
        setMerchantInfo(data.data.merchant);
        setIsLoggedIn(true);
        localStorage.setItem('blip_merchant', JSON.stringify(data.data.merchant));
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
    localStorage.removeItem('blip_merchant');
    localStorage.removeItem('merchant_info');
    if (solanaWallet.disconnect) {
      solanaWallet.disconnect();
    }
    window.location.href = '/merchant';
  }, [solanaWallet]);

  // Session restore on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedMerchant = localStorage.getItem('blip_merchant');
        if (savedMerchant) {
          const merchant = JSON.parse(savedMerchant);
          const checkRes = await fetch(`/api/auth/merchant?action=check_session&merchant_id=${merchant.id}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.success && checkData.data?.valid) {
              const freshMerchant = checkData.data.merchant || merchant;
              setMerchantId(freshMerchant.id);
              setMerchantInfo(freshMerchant);
              setIsLoggedIn(true);
              setIsLoading(false);
              localStorage.setItem('blip_merchant', JSON.stringify(freshMerchant));
              if (!isMockMode && !freshMerchant.wallet_address && !solanaWallet.connected) {
                setTimeout(() => setShowWalletPrompt(true), 1000);
              }
              return;
            }
          }
          localStorage.removeItem('blip_merchant');
          localStorage.removeItem('merchant_info');
        }
      } catch (err) {
        console.error('[Merchant] Failed to restore session:', err);
        localStorage.removeItem('blip_merchant');
        localStorage.removeItem('merchant_info');
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

    // Auth actions
    handleLogin,
    handleRegister,
    handleLogout,
    handleMerchantUsername,
    handleProfileUpdated,
  };
}
