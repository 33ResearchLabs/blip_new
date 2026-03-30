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
        setMember(data.data.member);
        setIsLoggedIn(true);
        localStorage.setItem("compliance_member", JSON.stringify(data.data.member));
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
        setMember(data.data.member);
        setAuthMethod("wallet");
        setIsLoggedIn(true);
        localStorage.setItem("compliance_member", JSON.stringify({ ...data.data.member, authMethod: "wallet" }));
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

  // Check for saved session OR merchant with compliance access
  useEffect(() => {
    const saved = localStorage.getItem("compliance_member");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setMember(parsed);
        setIsLoggedIn(true);
        return;
      } catch {
        localStorage.removeItem("compliance_member");
      }
    }

    // Auto-login: check if logged-in merchant has compliance access
    const merchantData = localStorage.getItem("blip_merchant");
    if (merchantData) {
      try {
        const merchant = JSON.parse(merchantData);
        if (merchant?.id) {
          fetchWithAuth(`/api/compliance/disputes?limit=1`).then(res => {
            if (res.ok) {
              // Merchant has compliance access — auto-login
              const complianceMember = {
                id: merchant.id,
                email: null,
                wallet_address: null,
                name: merchant.display_name || merchant.business_name || 'Merchant',
                role: 'merchant-compliance',
              };
              setMember(complianceMember);
              setIsLoggedIn(true);
              localStorage.setItem("compliance_member", JSON.stringify(complianceMember));
            }
          }).catch(() => {});
        }
      } catch {}
    }
  }, []);

  // Logout
  const handleLogout = () => {
    localStorage.removeItem("compliance_member");
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
