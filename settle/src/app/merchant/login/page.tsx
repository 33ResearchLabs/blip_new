"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Eye, EyeOff, Loader2, Store } from "lucide-react";
import { useMerchantStore } from "@/stores/merchantStore";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { useDashboardAuth } from "@/hooks/useDashboardAuth";

export default function MerchantLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  const merchantId = useMerchantStore((s) => s.merchantId);
  const solanaWallet = useSolanaWallet();
  const [showPassword, setShowPassword] = useState(false);

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

  useEffect(() => {
    const tab = searchParams.get("tab");
    auth.setAuthTab(tab === "register" || tab === "create" ? "create" : "signin");
    const reason = searchParams.get("reason");
    if (reason === "session_expired") {
      auth.setLoginError("Your session expired. Please sign in again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isLoggedIn && merchantId) router.replace("/merchant");
  }, [isLoggedIn, merchantId, router]);

  const isSignIn = auth.authTab === "signin";
  const submit = () => (isSignIn ? auth.handleLogin() : auth.handleRegister());
  const isLoading = isSignIn ? auth.isLoggingIn : auth.isRegistering;

  const isDisabled =
    isLoading ||
    (isSignIn
      ? !auth.loginForm.email || !auth.loginForm.password
      : !auth.registerForm.email ||
        !auth.registerForm.password ||
        !auth.registerForm.confirmPassword);

  return (
    <div className="w-full mx-auto flex flex-col bg-surface-base text-text-primary relative overflow-hidden h-dvh">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] md:w-[700px] h-[300px] md:h-[500px] bg-warning/[0.05] rounded-full blur-[120px]" />
      </div>

      <div className="flex h-full flex-col items-center px-5 py-4 relative z-10">
        <div className="w-full max-w-[440px] flex-1 flex flex-col self-stretch mx-auto">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-3 gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-text-primary bg-surface-card hover:bg-surface-hover border border-border-medium hover:border-text-tertiary transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Home
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-text-primary bg-surface-card hover:bg-surface-hover border border-border-medium hover:border-text-tertiary transition-all"
            >
              Are you a user?
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="flex-1 flex flex-col pt-6 sm:pt-[50px] pb-1 min-h-0">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="mb-6 sm:mb-10 shrink-0"
            >
              <div className="text-center mb-1">
                <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-text-tertiary mb-2">
                  {isSignIn ? "Welcome back" : "Get started"}
                </p>
                <h1 className="text-[32px] font-bold text-text-primary tracking-[-0.03em] leading-[1.05]">
                  {isSignIn ? (
                    <>Login <span className="text-text-tertiary font-light">as</span> Merchant</>
                  ) : (
                    <>Create <span className="text-text-tertiary font-light">Merchant</span> Account</>
                  )}
                </h1>
              </div>
            </motion.div>

            {/* Tabs */}
            <div className="flex mb-4 bg-surface-card rounded-xl p-1">
              <button
                onClick={() => { auth.setAuthTab("signin"); auth.setLoginError(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isSignIn ? "bg-white text-[#0B0F14]" : "text-text-tertiary"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { auth.setAuthTab("create"); auth.setLoginError(""); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  !isSignIn ? "bg-white text-[#0B0F14]" : "text-text-tertiary"
                }`}
              >
                Create Account
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto rounded-2xl p-5 sm:p-6 flex flex-col gap-3 sm:gap-4 bg-surface-card border border-border-subtle shadow-2xl">
              {auth.loginError && (
                <div className="rounded-xl p-3 text-sm bg-error-dim border border-error-border text-error">
                  {auth.loginError}
                </div>
              )}

              {!isSignIn && (
                <div>
                  <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">
                    Business Name
                  </label>
                  <input
                    type="text"
                    value={auth.registerForm.businessName}
                    onChange={(e) =>
                      auth.setRegisterForm({ ...auth.registerForm, businessName: e.target.value })
                    }
                    placeholder="Your desk name"
                    maxLength={100}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={isSignIn ? auth.loginForm.email : auth.registerForm.email}
                  onChange={(e) =>
                    isSignIn
                      ? auth.setLoginForm({ ...auth.loginForm, email: e.target.value })
                      : auth.setRegisterForm({ ...auth.registerForm, email: e.target.value })
                  }
                  placeholder="you@business.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  maxLength={254}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary">
                    Password
                  </label>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={isSignIn ? auth.loginForm.password : auth.registerForm.password}
                    onChange={(e) =>
                      isSignIn
                        ? auth.setLoginForm({ ...auth.loginForm, password: e.target.value })
                        : auth.setRegisterForm({ ...auth.registerForm, password: e.target.value })
                    }
                    placeholder={isSignIn ? "••••••••" : "Min 12 characters"}
                    maxLength={100}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    className="w-full rounded-xl pl-4 pr-11 py-3 text-sm font-medium outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {!isSignIn && (
                <div>
                  <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">
                    Confirm Password
                  </label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={auth.registerForm.confirmPassword}
                    onChange={(e) =>
                      auth.setRegisterForm({ ...auth.registerForm, confirmPassword: e.target.value })
                    }
                    placeholder="Min 12 characters"
                    maxLength={100}
                    onKeyDown={(e) => e.key === "Enter" && submit()}
                    className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary"
                  />
                </div>
              )}

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={submit}
                disabled={isDisabled}
                className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 tracking-[-0.01em] transition-colors ${
                  isDisabled
                    ? "bg-white/10 text-white/40 cursor-not-allowed"
                    : "bg-white text-[#0B0F14]"
                }`}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isSignIn ? "Signing in..." : "Creating..."}
                  </>
                ) : isSignIn ? (
                  "Login as Merchant"
                ) : (
                  "Register as Merchant"
                )}
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={() => {
                  auth.setAuthTab(isSignIn ? "create" : "signin");
                  auth.setLoginError("");
                }}
                className="w-full py-3 rounded-xl text-sm font-bold tracking-[-0.01em] transition-colors bg-surface-hover hover:bg-surface-card border border-border-medium text-text-primary"
              >
                {isSignIn ? "Register" : "Sign In"}
              </motion.button>

              <p className="text-center text-[11px] text-text-secondary">
                Run your desk · control spreads · earn on every trade
              </p>

              <Link
                href="/login?tab=register"
                className="relative overflow-hidden flex items-center justify-between rounded-xl px-4 py-3 transition-all group bg-white text-[#0B0F14] shadow-[0_10px_30px_-10px_rgba(56,189,248,0.45)] hover:shadow-[0_14px_40px_-10px_rgba(56,189,248,0.6)]"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #ffffff 0%, #eff6ff 55%, #dbeafe 100%)",
                }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-6 -top-6 w-20 h-20 rounded-full"
                  style={{ background: "radial-gradient(circle, rgba(56,189,248,0.55), transparent 70%)" }}
                />
                <div className="relative">
                  <div className="inline-flex items-center gap-1.5 mb-1">
                    <Store className="w-3 h-3 text-sky-700" />
                    <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-sky-700">For Users</span>
                  </div>
                  <p className="text-[13px] font-bold leading-tight">Just want to trade?</p>
                  <p className="text-[10px] text-black/55 mt-0.5">Buy & sell crypto · escrow-protected</p>
                </div>
                <span className="relative shrink-0 ml-3 inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#0B0F14] text-white group-hover:translate-x-0.5 transition-transform">
                  Register
                  <span aria-hidden>→</span>
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
