"use client";

import "@/components/user/styles/user-theme.css";
import { useEffect } from "react";
import { LandingPage } from "@/components/user/LandingPage";
import { useUserAuth } from "@/hooks/useUserAuth";
import { useUserTheme } from "@/hooks/useUserTheme";
import { useSolanaWalletSafe } from "@/hooks/useSolanaWalletSafe";

/**
 * /user/login — the dedicated user sign-in / sign-up route.
 *
 * Mirrors the merchant side's `/market/login`: a standalone page that renders
 * the user auth form (`LandingPage`) and, the moment auth succeeds (fresh
 * sign-in OR an existing-session bootstrap), hands off to `/user` via a full
 * navigation so the SPA re-bootstraps the session straight into Home.
 *
 * The user app has no global auth store (unlike the merchant Zustand store),
 * so we run our own `useUserAuth` instance here. Data fetchers are no-ops —
 * orders / balances are loaded by `/user` after the redirect, not here.
 */
const noop = () => {};
const noopAsync = async () => {};

export default function UserLoginPage() {
  const { theme } = useUserTheme();
  const isUserLight = theme === "light";
  const solanaWallet = useSolanaWalletSafe();

  const auth = useUserAuth({
    setScreen: noop,
    setOrders: noop,
    setBankAccounts: noop,
    setResolvedDisputes: noop,
    solanaWallet,
    escrowTxStatus: "idle",
    setEscrowTxStatus: noop,
    fetchOrders: noopAsync,
    fetchBankAccounts: noopAsync,
    fetchResolvedDisputes: noopAsync,
  });

  // Authenticated (just signed in, or arrived with a live session) → hand off
  // to the user app. Full navigation so /user re-bootstraps into Home.
  useEffect(() => {
    if (auth.userId) {
      window.location.replace("/user");
    }
  }, [auth.userId]);

  // Surface the "session expired" notice when arriving from a forced logout
  // (fetchWithAuth → /login?reason=session_expired → /user/login?reason=…).
  // Read once on mount, then strip the param so a refresh won't re-show it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("reason") === "session_expired") {
      auth.setLoginError("Your session expired. Please sign in again.");
      url.searchParams.delete("reason");
      window.history.replaceState(
        null,
        "",
        url.pathname +
          (url.searchParams.toString() ? `?${url.searchParams}` : "") +
          url.hash,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`user-scope ${isUserLight ? "user-light" : ""} min-h-dvh flex flex-col items-center overflow-y-auto relative`}
      style={{ background: "var(--user-frame)" }}
    >
      <LandingPage
        loginForm={auth.loginForm}
        setLoginForm={auth.setLoginForm}
        authMode={auth.authMode}
        setAuthMode={auth.setAuthMode}
        handleUserLogin={auth.handleUserLogin}
        handleUserRegister={auth.handleUserRegister}
        isLoggingIn={auth.isLoggingIn}
        loginError={auth.loginError}
        setLoginError={auth.setLoginError}
        pendingVerificationEmail={auth.pendingVerificationEmail}
        onClearPendingVerification={auth.clearPendingVerification}
        onResendVerification={auth.handleResendVerification}
        isResendingVerification={auth.isResendingVerification}
        verificationCooldownSeconds={auth.verificationCooldownSeconds}
        verificationSuccessNotice={auth.verificationSuccessNotice}
        onDismissVerificationSuccess={auth.dismissVerificationSuccess}
        pendingVerificationVerified={auth.pendingVerificationVerified}
        registerEmail={auth.registerEmail}
        setRegisterEmail={auth.setRegisterEmail}
        onGoogleSuccess={auth.handleGoogleSuccess}
      />
    </div>
  );
}
