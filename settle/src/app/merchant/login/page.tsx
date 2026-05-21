"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronLeft, Eye, EyeOff, Loader2, Mail, ShieldCheck, Store } from "lucide-react";
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
    solanaWallet,
    setShowWalletPrompt: () => {},
    setShowUsernameModal: () => {},
  });

  // Seed authTab / loginError from URL params so deep links like
  // /merchant/login?tab=register and /merchant/login?reason=session_expired
  // land on the right state.
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
    <div className="w-full mx-auto flex flex-col bg-surface-base text-text-primary relative min-h-dvh">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] md:w-[700px] h-[300px] md:h-[500px] bg-warning/[0.05] rounded-full blur-[120px]" />
      </div>

      <div className="flex min-h-dvh flex-col items-center px-5 py-4 relative z-10">
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
              className="mb-4 sm:mb-10 shrink-0"
            >
              <div className="text-center mb-1">
                <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-text-tertiary mb-2">
                  {isSignIn ? "Welcome back" : "Get started"}
                </p>
                <h1 className="text-[26px] sm:text-[32px] font-bold text-text-primary tracking-[-0.03em] leading-[1.05]">
                  {isSignIn ? (
                    <>Login <span className="text-text-tertiary font-light">as</span> Merchant</>
                  ) : (
                    <>Create <span className="text-text-tertiary font-light">Merchant</span> Account</>
                  )}
                </h1>
              </div>
            </motion.div>

            {/* Tabs — hidden while the post-signup verification panel is
                shown; switching tabs there would have no visible effect. */}
            {!auth.pendingVerificationEmail && (
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
            )}

            <div className="flex-1 min-h-0 rounded-2xl p-4 sm:p-6 flex flex-col gap-3 sm:gap-4 bg-surface-card border border-border-subtle shadow-2xl">
              {/* Post-signup verification gate. Registration is NOT
                  complete until the merchant clicks the link in the email
                  we just sent — the form is replaced with a check-your-inbox
                  panel so they can't proceed without verifying. The same
                  panel swaps body to a "verified!" success card the moment
                  the poller in useDashboardAuth flips
                  pendingVerificationVerified true (link clicked on this
                  device, another device, or scanned by an email proxy —
                  any of them resolve the gate). */}
              {auth.pendingVerificationEmail ? (
                auth.pendingVerificationVerified ? (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-5 py-2"
                  >
                    <div className="flex justify-center">
                      <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8 text-success" />
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-base font-semibold text-text-primary">
                        Business email verified
                      </p>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        <span className="font-semibold break-all text-text-primary">
                          {auth.pendingVerificationEmail}
                        </span>{" "}
                        is confirmed. Your merchant account is ready.
                      </p>
                    </div>

                    <div className="rounded-xl px-4 py-3 flex items-start gap-3 bg-success-dim border border-success-border">
                      <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-0.5" />
                      <p className="text-[11px] text-text-secondary leading-relaxed">
                        A verified business email lets us reach you for
                        compliance checks and protects your account from
                        impersonation.
                      </p>
                    </div>

                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        auth.clearPendingVerification();
                        auth.setAuthTab("signin");
                      }}
                      className="w-full py-3 rounded-xl text-sm font-bold bg-white text-[#0B0F14]"
                    >
                      Continue to sign in
                    </motion.button>
                  </motion.div>
                ) : (
                  <>
                    <div className="rounded-xl p-4 flex gap-3 bg-success-dim border border-success-border">
                      <div className="w-9 h-9 rounded-lg bg-success/15 flex items-center justify-center flex-shrink-0">
                        <Mail className="w-4 h-4 text-success" />
                      </div>
                      <div className="text-[13px] leading-relaxed text-text-primary">
                        <p>
                          We sent a verification link to{" "}
                          <span className="font-semibold break-all">
                            {auth.pendingVerificationEmail}
                          </span>
                          .
                        </p>
                        <p className="mt-1 text-text-secondary">
                          Click the link in that email to activate your account.
                          This screen updates automatically as soon as we
                          detect the verification.
                        </p>
                      </div>
                    </div>

                    <p className="text-[12px] text-text-tertiary flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-text-tertiary" />
                      Waiting for verification…
                    </p>

                    {/* Resend stays — covers the case where the email never
                        arrived or got lost. The "I've verified, take me
                        to sign-in" button was removed: the poller (every
                        4–12s plus on window focus) auto-converts this
                        panel into the success card the moment the click
                        is detected, so the manual escape hatch is no
                        longer needed. */}
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={auth.resendVerificationEmail}
                      disabled={auth.isResendingVerification || auth.verificationCooldownSeconds > 0}
                      className="w-full py-3 rounded-xl text-sm font-bold bg-surface-hover hover:bg-surface-card border border-border-medium text-text-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {auth.isResendingVerification ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending…
                        </>
                      ) : auth.verificationCooldownSeconds > 0 ? (
                        `Resend available in ${auth.verificationCooldownSeconds}s`
                      ) : (
                        "Resend verification email"
                      )}
                    </motion.button>

                    <p className="text-[11px] text-text-tertiary text-center">
                      Didn&apos;t get it? Check spam. Links expire after 24 hours.
                    </p>
                  </>
                )
              ) : (
              <>
              {/* Verification-success banner. Same trigger as the dashboard
                  LoginScreen — server polling (or "I've verified") detected
                  email verification flipped to true. */}
              {isSignIn && auth.verificationSuccessNotice && (
                <div className="rounded-xl p-3 flex items-start gap-2.5 bg-success-dim border border-success-border">
                  <div className="w-1.5 h-1.5 rounded-full bg-success mt-1.5 flex-shrink-0" />
                  <div className="flex-1 text-sm text-text-primary">
                    <span className="font-semibold text-success">Email verified.</span>{" "}
                    <span className="text-text-secondary">Sign in below to continue.</span>
                  </div>
                  <button
                    onClick={auth.dismissVerificationSuccess}
                    aria-label="Dismiss"
                    className="text-text-tertiary hover:text-text-primary text-lg leading-none px-1 -mt-0.5"
                  >
                    ×
                  </button>
                </div>
              )}
              {auth.loginError === "EMAIL_NOT_VERIFIED" && !auth.verificationSuccessNotice ? (
                <div className="rounded-xl p-3 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-2">
                  <p className="font-medium">
                    Verify your email before signing in.
                  </p>
                  <p className="text-xs text-amber-200/80">
                    We just sent a fresh verification link to your inbox.
                    Click it, then come back to sign in.
                  </p>
                  <button
                    type="button"
                    onClick={auth.resendVerificationEmail}
                    disabled={auth.isResendingVerification || auth.verificationCooldownSeconds > 0}
                    className="mt-1 w-full py-2 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-200 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {auth.isResendingVerification ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                    ) : auth.verificationCooldownSeconds > 0 ? (
                      `Resend available in ${auth.verificationCooldownSeconds}s`
                    ) : (
                      "Resend verification email"
                    )}
                  </button>
                </div>
              ) : auth.loginError && !auth.verificationSuccessNotice ? (
                <div className="rounded-xl p-3 text-sm bg-error-dim border border-error-border text-error">
                  {auth.loginError}
                </div>
              ) : null}

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
                  {isSignIn ? "Email or Username" : "Email"}
                </label>
                <input
                  type={isSignIn ? "text" : "email"}
                  autoComplete={isSignIn ? "username" : "email"}
                  inputMode={isSignIn ? "email" : undefined}
                  value={isSignIn ? auth.loginForm.email : auth.registerForm.email}
                  onChange={(e) =>
                    isSignIn
                      ? auth.setLoginForm({ ...auth.loginForm, email: e.target.value })
                      : auth.setRegisterForm({ ...auth.registerForm, email: e.target.value })
                  }
                  placeholder={isSignIn ? "you@business.com or username" : "you@business.com"}
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
                {/* Forgot password — sign-in only. */}
                {isSignIn && (
                  <div className="mt-2 text-right">
                    <Link
                      href="/merchant/forgot-password"
                      className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
                    >
                      Forgot password?
                    </Link>
                  </div>
                )}
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
              </>
              )}

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
