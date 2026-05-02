"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { useMerchantStore } from '@/stores/merchantStore';

interface ComplianceMember {
  id: string;
  email: string | null;
  wallet_address: string | null;
  name: string;
  role: string;
}

interface SolanaWalletHook {
  connected: boolean;
  connecting: boolean;
  publicKey: unknown;
  walletAddress: string | null;
  connect: () => void;
  disconnect: () => void;
  openWalletModal: () => void;
  solBalance: number | null;
  usdtBalance: number | null;
  refreshBalances: () => Promise<void>;
  releaseEscrow: (params: any) => Promise<{ txHash: string; success: boolean }>;
  refundEscrow: (params: any) => Promise<{ txHash: string; success: boolean }>;
  resolveDispute: (params: any) => Promise<{ txHash: string; success: boolean }>;
  openDispute: (params: any) => Promise<{ txHash: string; success: boolean }>;
  network: "devnet" | "mainnet-beta";
}

interface UseComplianceAuthReturn {
  isLoggedIn: boolean;
  setIsLoggedIn: React.Dispatch<React.SetStateAction<boolean>>;
  member: ComplianceMember | null;
  setMember: React.Dispatch<React.SetStateAction<ComplianceMember | null>>;
  loginForm: { email: string; password: string };
  setLoginForm: React.Dispatch<React.SetStateAction<{ email: string; password: string }>>;
  loginError: string;
  setLoginError: React.Dispatch<React.SetStateAction<string>>;
  isLoading: boolean;
  authMethod: "email" | "wallet";
  showWalletModal: boolean;
  setShowWalletModal: React.Dispatch<React.SetStateAction<boolean>>;
  isWalletLoggingIn: boolean;
  handleLogin: () => Promise<void>;
  handleWalletLogin: () => Promise<void>;
  handleLogout: () => void;
}

export function useComplianceAuth(solanaWallet: SolanaWalletHook): UseComplianceAuthReturn {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [member, setMember] = useState<ComplianceMember | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [authMethod, setAuthMethod] = useState<"email" | "wallet">("email");
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [isWalletLoggingIn, setIsWalletLoggingIn] = useState(false);

  // Login handler
  const handleLogin = async () => {
    setIsLoading(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth("/api/auth/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginForm.email,
          password: loginForm.password,
          action: "login",
        }),
      });

      const data = await res.json();

      if (data.success) {
        // In-memory only. Identity persists across reload via the httpOnly
        // cookie set by this same response; the next mount restores via
        // /api/auth/me. No localStorage mirror.
        setMember(data.data.member);
        setIsLoggedIn(true);
        if (data.data.token) useMerchantStore.getState().setSessionToken(data.data.token);
      } else {
        setLoginError(data.error || "Login failed");
      }
    } catch (error) {
      console.error("Login error:", error);
      setLoginError("Connection failed");
    } finally {
      setIsLoading(false);
    }
  };

  // Wallet login handler
  const handleWalletLogin = async () => {
    if (!solanaWallet.connected || !solanaWallet.walletAddress) {
      setShowWalletModal(true);
      return;
    }

    setIsWalletLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetchWithAuth("/api/auth/compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: solanaWallet.walletAddress,
          action: "wallet_login",
        }),
      });

      const data = await res.json();

      if (data.success) {
        // In-memory only — see handleLogin above. Cookie carries the
        // session across reload.
        setMember(data.data.member);
        setAuthMethod("wallet");
        setIsLoggedIn(true);
        if (data.data.token) useMerchantStore.getState().setSessionToken(data.data.token);
      } else {
        setLoginError(data.error || "Wallet not authorized for compliance access");
      }
    } catch (error) {
      console.error("Wallet login error:", error);
      setLoginError("Connection failed");
    } finally {
      setIsWalletLoggingIn(false);
    }
  };

  // Auto-login when wallet connects
  useEffect(() => {
    if (solanaWallet.connected && solanaWallet.walletAddress && !isLoggedIn && !isWalletLoggingIn) {
      const pendingWalletLogin = sessionStorage.getItem("pending_compliance_wallet_login");
      if (pendingWalletLogin) {
        sessionStorage.removeItem("pending_compliance_wallet_login");
        handleWalletLogin();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solanaWallet.connected, solanaWallet.walletAddress, isLoggedIn, isWalletLoggingIn]);

  // Restore compliance session via cookie-authed /api/auth/me. Two paths
  // resolve to the compliance dashboard:
  //   1. Actor is `compliance` — direct compliance team member, full access.
  //   2. Actor is `merchant` AND merchant has compliance_access — promote
  //      them to a "merchant-compliance" pseudo-member for UI purposes.
  //
  // No localStorage read for identity. The httpOnly access cookie is the
  // only credential — works on hard refresh and deep-link entry.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
        });
        if (cancelled || !meRes.ok) return;
        const me = await meRes.json();
        if (cancelled || !me?.success) return;

        const actorType = me?.data?.actorType;

        if (actorType === 'compliance' && me?.data?.member) {
          setMember(me.data.member);
          setIsLoggedIn(true);
          return;
        }

        if (actorType === 'merchant' && me?.data?.merchant?.id) {
          const merchant = me.data.merchant;
          // Probe a compliance endpoint to check ACL — same heuristic as
          // before, but the merchant identity comes from the verified cookie
          // rather than a localStorage blob.
          const aclRes = await fetchWithAuth(`/api/compliance/disputes?limit=1`);
          if (cancelled) return;
          if (aclRes.ok) {
            setMember({
              id: merchant.id,
              email: null,
              wallet_address: null,
              name: merchant.display_name || merchant.business_name || 'Merchant',
              role: 'merchant-compliance',
            });
            setIsLoggedIn(true);
          }
        }
      } catch {
        // Network error — leave the user signed-out. They'll see the login
        // form and a fresh probe will run on the next mount.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Logout — clear in-memory state. Real cookie invalidation happens via
  // /api/auth/logout in the page-level logout handlers; this hook just
  // wipes the local UI state.
  const handleLogout = () => {
    setMember(null);
    setIsLoggedIn(false);
  };

  return {
    isLoggedIn,
    setIsLoggedIn,
    member,
    setMember,
    loginForm,
    setLoginForm,
    loginError,
    setLoginError,
    isLoading,
    authMethod,
    showWalletModal,
    setShowWalletModal,
    isWalletLoggingIn,
    handleLogin,
    handleWalletLogin,
    handleLogout,
  };
}

export type { ComplianceMember };
