"use client";

/**
 * Dedicated /merchant/login route — standalone login page.
 *
 * Shows only the LoginScreen (no welcome page). Redirects to /merchant
 * dashboard after successful authentication.
 *
 * URL query params:
 *   ?tab=register → opens the Create Account form
 *   ?tab=signin   → opens the Sign In form (default)
 *
 * Zero regression: /merchant still shows Welcome + LoginScreen inline
 * when not authenticated. This route is additive.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMerchantStore } from "@/stores/merchantStore";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { useDashboardAuth } from "@/hooks/useDashboardAuth";
import { LoginScreen } from "@/components/merchant/LoginScreen";
import { Loader2 } from "lucide-react";

export default function MerchantLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  const merchantId = useMerchantStore((s) => s.merchantId);
  const solanaWallet = useSolanaWallet();
  const [skipWelcome, setSkipWelcome] = useState(false);

  const auth = useDashboardAuth({
    isMockMode: false,
    solanaWallet: {
      connected: !!solanaWallet?.connected,
      walletAddress: solanaWallet?.walletAddress ?? null,
      signMessage: solanaWallet?.signMessage,
      disconnect: solanaWallet?.disconnect,
    },
    setShowWalletPrompt: () => {},
    setShowUsernameModal: () => {},
  });

  // Apply tab + reason from query string on mount
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "register" || tab === "create") {
      auth.setAuthTab("create");
    } else {
      auth.setAuthTab("signin");
    }
    // Show a banner when user was bounced here due to session expiry
    const reason = searchParams.get("reason");
    if (reason === "session_expired") {
      auth.setLoginError("Your session expired. Please sign in again.");
    }
    setSkipWelcome(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (isLoggedIn && merchantId) {
      router.replace("/merchant");
    }
  }, [isLoggedIn, merchantId, router]);

  if (!skipWelcome) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-foreground/40 animate-spin" />
      </div>
    );
  }

  return (
    <LoginScreen
      authTab={auth.authTab}
      setAuthTab={auth.setAuthTab}
      loginForm={auth.loginForm}
      setLoginForm={auth.setLoginForm}
      registerForm={auth.registerForm}
      setRegisterForm={auth.setRegisterForm}
      loginError={auth.loginError}
      setLoginError={auth.setLoginError}
      isLoggingIn={auth.isLoggingIn}
      isRegistering={auth.isRegistering}
      isAuthenticating={false}
      onLogin={auth.handleLogin}
      onRegister={auth.handleRegister}
      onResendVerification={auth.resendVerificationEmail}
      isResendingVerification={auth.isResendingVerification}
      skipWelcome={true}
    />
  );
}
