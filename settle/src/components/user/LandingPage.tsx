"use client";

import { useState, useEffect } from "react";
import { motion, type PanInfo } from "framer-motion";
import { useRouter } from "next/navigation";
import { Zap, Loader2, Eye, EyeOff, Mail, ChevronLeft, User, Store, ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";
import { InstallPWAButton } from "@/components/InstallPWAButton";
import { usePwaContext } from "@/hooks/usePwaContext";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import {
  validateUserUsername,
  validateUserEmail,
  validateUserPassword,
} from "@/lib/validation/userAuth";

interface LandingPageProps {
  loginForm: { username: string; password: string; email: string };
  setLoginForm: (f: { username: string; password: string; email: string }) => void;
  authMode: 'login' | 'register';
  setAuthMode: (m: 'login' | 'register') => void;
  handleUserLogin: () => void;
  handleUserRegister: () => void;
  isLoggingIn: boolean;
  loginError: string;
  setLoginError: (e: string) => void;
  /** Email a fresh registration just sent its verification link to. When
   *  set, the form is replaced by a check-your-inbox panel — registration
   *  is not considered complete until the user clicks the link. */
  pendingVerificationEmail?: string | null;
  /** Clear pendingVerificationEmail and return to the sign-in tab. */
  onClearPendingVerification?: () => void;
  /** Resend the verification email. Same handler used by the
   *  EMAIL_NOT_VERIFIED login banner. */
  onResendVerification?: () => void;
  isResendingVerification?: boolean;
  /** True once polling (or the manual "I've verified" button) detects the
   *  email is verified. Renders a green banner above the sign-in form. */
  verificationSuccessNotice?: boolean;
  onDismissVerificationSuccess?: () => void;
  /** When true, skips the welcome page and goes straight to the login form.
   *  Used by the /login route. */
  skipWelcome?: boolean;
}

export function LandingPage({
  loginForm, setLoginForm, authMode, setAuthMode,
  handleUserLogin, handleUserRegister, isLoggingIn, loginError, setLoginError,
  pendingVerificationEmail,
  onClearPendingVerification,
  onResendVerification,
  isResendingVerification,
  verificationSuccessNotice,
  onDismissVerificationSuccess,
  skipWelcome = false,
}: LandingPageProps) {
  const router = useRouter();
  // Hide merchant entry points when running as the User PWA — those routes
  // are blocked by PwaAppGuard anyway, so the buttons would be dead.
  const pwa = usePwaContext();
  const hideMerchantLinks = pwa.standalone && pwa.app === "user";
  const [showPassword, setShowPassword] = useState(false);

  // Left-swipe → merchant login (Tinder-style horizontal pan). No-op inside
  // the User PWA — merchant routes are blocked there.
  const onSwipeEnd = (_: unknown, info: PanInfo) => {
    if (hideMerchantLinks) return;
    if (info.offset.x < -80 || info.velocity.x < -400) {
      router.push("/merchant/login?tab=signin");
    }
  };
  // Setter unused — navigation to the form happens via /login URL, not state toggle.
  const [showWelcome] = useState(!skipWelcome);
  // Track which fields the user has interacted with so we don't surface
  // "required" errors before they've even started typing.
  const [touched, setTouched] = useState<{ username?: boolean; email?: boolean; password?: boolean }>({});
  const submit = () => authMode === 'login' ? handleUserLogin() : handleUserRegister();

  // Per-field validity — only computed for register so login stays simple
  // (login just needs a non-empty username + password and trusts the server).
  const usernameError = authMode === 'register' && touched.username
    ? validateUserUsername(loginForm.username)
    : null;
  const emailError = authMode === 'register' && touched.email
    ? validateUserEmail(loginForm.email)
    : null;
  const passwordError = authMode === 'register' && touched.password
    ? validateUserPassword(loginForm.password)
    : null;

  // Live username-availability check for the register flow. Only fires
  // when the username passes format validation — otherwise we'd waste
  // calls and surface "taken" messaging on garbage inputs. The DB is
  // still the source of truth at submit time; this is purely a UX hint.
  type UsernameAvailability =
    | { state: 'idle' }
    | { state: 'checking' }
    | { state: 'available'; value: string }
    | { state: 'taken'; value: string }
    | { state: 'error' };
  const [usernameAvailability, setUsernameAvailability] =
    useState<UsernameAvailability>({ state: 'idle' });
  useEffect(() => {
    if (authMode !== 'register') {
      setUsernameAvailability({ state: 'idle' });
      return;
    }
    const candidate = loginForm.username.trim();
    if (!candidate || validateUserUsername(candidate)) {
      setUsernameAvailability({ state: 'idle' });
      return;
    }
    // Debounce typing so we don't spam the endpoint per keystroke. 350ms
    // is long enough that fast typing doesn't trigger N requests but
    // short enough that the indicator feels live.
    //
    // Uses the dedicated GET endpoint, NOT POST /api/auth/user with
    // action=check_username: that path shares the brute-force login
    // rate-limit bucket (10/min) in middleware and would silently 429
    // after a few keystrokes. The dedicated endpoint sits under
    // SEARCH_LIMIT (60/min) and is GET-only so it stays cache-friendly.
    let cancelled = false;
    setUsernameAvailability({ state: 'checking' });
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(
          `/api/auth/user/username-availability?username=${encodeURIComponent(candidate)}`,
          { method: 'GET' },
        );
        if (cancelled) return;
        const data = await res.json();
        if (data?.success && typeof data.data?.available === 'boolean') {
          setUsernameAvailability(
            data.data.available
              ? { state: 'available', value: candidate }
              : { state: 'taken', value: candidate }
          );
        } else {
          setUsernameAvailability({ state: 'error' });
        }
      } catch {
        if (!cancelled) setUsernameAvailability({ state: 'error' });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [loginForm.username, authMode]);

  // Treat "taken" only if the result matches the *current* input — guards
  // against a stale response landing after the user kept typing.
  const usernameTaken =
    usernameAvailability.state === 'taken' &&
    usernameAvailability.value === loginForm.username.trim();

  const isDisabled =
    isLoggingIn ||
    !loginForm.username ||
    !loginForm.password ||
    (authMode === 'register' && (
      !loginForm.email ||
      !!validateUserUsername(loginForm.username) ||
      !!validateUserEmail(loginForm.email) ||
      !!validateUserPassword(loginForm.password) ||
      usernameTaken ||
      usernameAvailability.state === 'checking'
    ));

  // Welcome page — Apple-style glass chooser.
  if (showWelcome) {
    return (
      <div
        className="relative flex-1 w-full h-dvh flex flex-col items-center justify-center px-6 py-10 sm:py-16 overflow-hidden text-white"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(120,119,198,0.18), transparent 60%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(56,189,248,0.14), transparent 60%), radial-gradient(ellipse 60% 50% at 0% 100%, rgba(168,247,98,0.12), transparent 60%), #0B0F14",
        }}
      >
        {/* Conic mesh gradient */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "conic-gradient(from 180deg at 50% 50%, rgba(168,247,98,0.08) 0deg, rgba(56,189,248,0.10) 90deg, rgba(120,119,198,0.10) 180deg, rgba(244,114,182,0.06) 270deg, rgba(168,247,98,0.08) 360deg)",
            filter: "blur(80px)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
        />

        {/* Noise overlay */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.025] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -6, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex items-center gap-2.5 mb-2"
        >
          <Zap className="w-7 h-7 text-white fill-current drop-shadow-[0_0_12px_rgba(168,247,98,0.5)]" />
          <span className="text-[24px] leading-none font-semibold tracking-[-0.02em] text-white">
            Blip <span className="italic font-light text-white/80">money</span>
          </span>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25, duration: 0.6 }}
          className="relative z-10 text-[11px] font-medium tracking-[0.3em] uppercase text-white/40 mb-8 sm:mb-12"
        >
          Choose your portal
        </motion.p>

        <div className={`relative z-10 w-full max-w-[720px] grid gap-4 ${hideMerchantLinks ? "grid-cols-1 max-w-[360px]" : "grid-cols-1 sm:grid-cols-2"}`}>
          {([
            {
              href: "/login?tab=signin",
              label: "User",
              sub: "Buy & sell crypto",
              Icon: User,
              glow: "rgba(168,247,98,0.55)",
              delay: 0.35,
            },
            // Merchant tile is hidden inside the User PWA — that route is
            // guarded by PwaAppGuard, so showing it would be a dead-end.
            ...(hideMerchantLinks
              ? []
              : [
                  {
                    href: "/merchant/login?tab=signin",
                    label: "Merchant",
                    sub: "Run a P2P desk",
                    Icon: Store,
                    glow: "rgba(120,119,198,0.55)",
                    delay: 0.45,
                  },
                ]),
          ]).map(({ href, label, sub, Icon, glow, delay }) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link href={href} className="group block">
                <motion.div
                  whileHover={{ y: -6 }}
                  whileTap={{ scale: 0.985 }}
                  transition={{ type: "spring", stiffness: 280, damping: 22 }}
                  className="relative rounded-[22px] p-[1.5px] overflow-hidden"
                  style={{
                    background:
                      "linear-gradient(140deg, rgba(255,255,255,0.35), rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.25) 100%)",
                  }}
                >
                  {/* Hover glow */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -inset-px rounded-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{
                      background: `radial-gradient(circle at 50% 0%, ${glow}, transparent 65%)`,
                      filter: "blur(20px)",
                    }}
                  />

                  <div
                    className="relative rounded-[21px] p-5 sm:p-7 backdrop-blur-2xl"
                    style={{
                      background:
                        "linear-gradient(160deg, rgba(28,28,32,0.92), rgba(18,18,22,0.85) 60%)",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.12), 0 30px 60px -20px rgba(0,0,0,0.6)",
                    }}
                  >
                    {/* Sheen */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -top-1/2 -left-1/2 w-[200%] h-[200%] opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                      style={{
                        background:
                          "conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(255,255,255,0.10) 60deg, transparent 120deg)",
                        animation: "spin 6s linear infinite",
                      }}
                    />

                    <div className="relative flex items-start justify-between">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center backdrop-blur-md"
                        style={{
                          background:
                            "linear-gradient(140deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
                          boxShadow:
                            "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.2)",
                        }}
                      >
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <motion.div
                        className="w-9 h-9 rounded-full flex items-center justify-center border border-border-subtle bg-white/[0.04]"
                        whileHover={{ rotate: -45 }}
                        transition={{ type: "spring", stiffness: 260, damping: 16 }}
                      >
                        <ArrowRight className="w-4 h-4 text-white" />
                      </motion.div>
                    </div>

                    <div className="relative mt-6 sm:mt-10">
                      <p className="text-[10px] font-medium tracking-[0.25em] uppercase text-white/40 mb-1.5">
                        Continue as
                      </p>
                      <p className="text-[24px] sm:text-[28px] font-semibold leading-none tracking-[-0.03em] text-white">
                        {label}
                      </p>
                      <p className="text-[12px] sm:text-[13px] mt-2 text-white/55 font-light">
                        {sub}
                      </p>
                    </div>
                  </div>
                </motion.div>
              </Link>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="relative z-10 mt-8 sm:mt-12"
        >
          <InstallPWAButton app="user" />
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="relative z-10 mt-5 sm:mt-8 text-[10px] font-mono tracking-[0.2em] text-white/40 flex items-center gap-3"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
          ESCROW-PROTECTED · ON-CHAIN SETTLEMENT
        </motion.p>
      </div>
    );
  }

  return (
    <motion.div
      className="w-full mx-auto flex flex-col bg-surface-base text-text-primary relative overflow-hidden h-dvh touch-pan-y"
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.35, right: 0 }}
      onPanEnd={onSwipeEnd}
    >
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] md:w-[700px] h-[300px] md:h-[500px] bg-warning/[0.05] rounded-full blur-[120px]" />
      </div>

      {/* Swipe hint — only on first interaction-less render */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 z-20 text-[10px] font-mono tracking-[0.2em] text-text-tertiary/60 rotate-90 origin-right"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.7, 0.7, 0] }}
        transition={{ duration: 4, delay: 1.5, times: [0, 0.15, 0.85, 1] }}
      >
        ← SWIPE FOR MERCHANT
      </motion.div>

      <div className="flex h-full flex-col items-center px-5 py-4 relative z-10">
        <div className="w-full max-w-[440px] flex-1 flex flex-col self-stretch mx-auto">
          {/* Top bar: home link + role switch — proper visible buttons */}
          <div className="flex items-center justify-between mb-3 gap-2 shrink-0">
            <Link
              href="/"
              aria-label="Home"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-text-primary bg-surface-card hover:bg-surface-hover border border-border-medium hover:border-text-tertiary transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              {/* Label hidden on phones — chevron alone is enough; reappears
                  on sm+ where there's more room. */}
              <span className="hidden sm:inline">Home</span>
            </Link>
            <div className="flex items-center gap-2">
              <InstallPWAButton app="user" />
              {!hideMerchantLinks && (
                <Link
                  href="/merchant/login"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-text-primary bg-surface-card hover:bg-surface-hover border border-border-medium hover:border-text-tertiary transition-all"
                >
                  Merchant
                  <span aria-hidden>→</span>
                </Link>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col pt-6 sm:pt-[50px] pb-1 min-h-0">
          <motion.div
            initial={{ opacity: 0, y: -8, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mb-4 sm:mb-8 shrink-0"
          >
            {/* Glass hero card — matches welcome chooser aesthetic */}
            <div
              className="relative rounded-[22px] p-[1.5px] overflow-hidden"
              style={{
                background:
                  "linear-gradient(140deg, rgba(255,255,255,0.35), rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.25) 100%)",
              }}
            >
              <div
                className="relative rounded-[21px] px-5 py-5 sm:px-7 sm:py-6 backdrop-blur-2xl overflow-hidden"
                style={{
                  background:
                    "linear-gradient(160deg, rgba(28,28,32,0.92), rgba(18,18,22,0.85) 60%)",
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.12), 0 30px 60px -20px rgba(0,0,0,0.6)",
                }}
              >
                {/* Corner glow */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-8 -top-8 w-32 h-32 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, rgba(168,247,98,0.35), transparent 70%)",
                    filter: "blur(10px)",
                  }}
                />
                <div className="relative flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background:
                        "linear-gradient(140deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
                      boxShadow:
                        "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.2)",
                    }}
                  >
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-white/40 mb-1">
                      {authMode === 'login' ? 'Welcome back' : 'Get started'}
                    </p>
                    <h1 className="text-[22px] sm:text-[26px] font-semibold text-white tracking-[-0.03em] leading-[1.05]">
                      {authMode === 'login' ? (
                        <>Login <span className="text-white/50 font-light">as</span> User</>
                      ) : (
                        <>Create <span className="text-white/50 font-light">an</span> Account</>
                      )}
                    </h1>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Tabs — hidden while the post-signup verification panel is
              shown; switching tabs there would have no visible effect. */}
          {!pendingVerificationEmail && (
            <div className="flex mb-4 bg-surface-card rounded-xl p-1">
              <button
                onClick={() => { setAuthMode('login'); setLoginError(''); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  authMode === 'login' ? 'bg-accent text-accent-text' : 'text-text-tertiary'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => { setAuthMode('register'); setLoginError(''); }}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  authMode === 'register' ? 'bg-accent text-accent-text' : 'text-text-tertiary'
                }`}
              >
                Create Account
              </button>
            </div>
          )}

          <div className="flex-1 min-h-0 rounded-2xl p-4 sm:p-6 flex flex-col gap-3 sm:gap-4 bg-surface-card border border-border-subtle shadow-2xl">
            {/* Post-signup verification gate. Registration is NOT complete
                until the user clicks the link in the email we just sent —
                the form is replaced with a check-your-inbox panel so they
                can't proceed without verifying. */}
            {pendingVerificationEmail ? (
              <>
                <div className="rounded-xl p-4 flex gap-3 bg-success-dim border border-success-border">
                  <div className="w-9 h-9 rounded-lg bg-success/15 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-4 h-4 text-success" />
                  </div>
                  <div className="text-[13px] leading-relaxed text-text-primary">
                    <p>
                      We sent a verification link to{" "}
                      <span className="font-semibold break-all">
                        {pendingVerificationEmail}
                      </span>
                      .
                    </p>
                    <p className="mt-1 text-text-secondary">
                      Click the link in that email to activate your account.
                      Your registration is not complete until your email is
                      verified.
                    </p>
                  </div>
                </div>

                <p className="text-[12px] text-text-tertiary">
                  Already clicked the link? Tap the button below to sign in.
                  This page also checks automatically every few seconds — if
                  you verified on another device, it will advance on its own.
                </p>

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    onClearPendingVerification?.();
                    setAuthMode('login');
                  }}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-accent text-accent-text"
                >
                  I&apos;ve verified my email — Sign in
                </motion.button>

                {onResendVerification && (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={onResendVerification}
                    disabled={isResendingVerification}
                    className="w-full py-3 rounded-xl text-sm font-bold bg-surface-hover hover:bg-surface-card border border-border-medium text-text-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isResendingVerification ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      'Resend verification email'
                    )}
                  </motion.button>
                )}

                <p className="text-[11px] text-text-tertiary text-center">
                  Didn&apos;t get it? Check spam. Links expire after 24 hours.
                </p>
              </>
            ) : (
              <>
            {/* Verification-success banner. Shown once polling (or the
                "I've verified" button) detects the email is verified. */}
            {authMode === 'login' && verificationSuccessNotice && (
              <div className="rounded-xl p-3 flex items-start gap-2.5 bg-success-dim border border-success-border">
                <div className="w-1.5 h-1.5 rounded-full bg-success mt-1.5 flex-shrink-0" />
                <div className="flex-1 text-sm text-text-primary">
                  <span className="font-semibold text-success">Email verified.</span>{" "}
                  <span className="text-text-secondary">Sign in below to continue.</span>
                </div>
                <button
                  onClick={onDismissVerificationSuccess}
                  aria-label="Dismiss"
                  className="text-text-tertiary hover:text-text-primary text-lg leading-none px-1 -mt-0.5"
                >
                  ×
                </button>
              </div>
            )}

            {loginError && (
              <div className="rounded-xl p-3 text-sm bg-error-dim border border-error-border text-error">
                {loginError}
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">
                {authMode === 'register' ? 'Username' : 'Username or Email'}
              </label>
              <input
                type="text"
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                onBlur={e => {
                  setLoginForm({ ...loginForm, username: e.target.value.trim() });
                  setTouched(t => ({ ...t, username: true }));
                }}
                placeholder={authMode === 'register' ? '3–20 chars · letters, numbers, _' : 'Username or you@email.com'}
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={authMode === 'register' ? 20 : 254}
                onKeyDown={e => e.key === 'Enter' && submit()}
                className={`w-full rounded-xl px-4 py-3 text-sm font-medium outline-none bg-surface-hover border ${
                  usernameError || usernameTaken ? 'border-error' : 'border-border-subtle'
                } text-text-primary placeholder:text-text-tertiary`}
              />
              {/* Per-field status: format error wins over availability,
                  since availability only matters once the format passes. */}
              {usernameError ? (
                <p className="mt-1.5 text-[11px] text-error">{usernameError}</p>
              ) : authMode === 'register' && usernameAvailability.state === 'checking' ? (
                <p className="mt-1.5 text-[11px] text-text-tertiary inline-flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Checking availability…
                </p>
              ) : authMode === 'register' && usernameAvailability.state === 'available' &&
                usernameAvailability.value === loginForm.username.trim() ? (
                <p className="mt-1.5 text-[11px] text-success inline-flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Available
                </p>
              ) : usernameTaken ? (
                <p className="mt-1.5 text-[11px] text-error inline-flex items-center gap-1">
                  <X className="w-3 h-3" />
                  Username already taken
                </p>
              ) : null}
            </div>

            {/* Email — register only. Required so the user can recover their
                account via the forgot-password flow. */}
            {authMode === 'register' && (
              <div>
                <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">Email</label>
                <div className="relative">
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={e => setLoginForm({ ...loginForm, email: e.target.value })}
                    onBlur={e => {
                      setLoginForm({ ...loginForm, email: e.target.value.trim() });
                      setTouched(t => ({ ...t, email: true }));
                    }}
                    placeholder="you@email.com"
                    autoCapitalize="none"
                    autoCorrect="off"
                    maxLength={254}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                    className={`w-full rounded-xl pl-10 pr-4 py-3 text-sm font-medium outline-none bg-surface-hover border ${
                      emailError ? 'border-error' : 'border-border-subtle'
                    } text-text-primary placeholder:text-text-tertiary`}
                  />
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                </div>
                {emailError ? (
                  <p className="mt-1.5 text-[11px] text-error">{emailError}</p>
                ) : (
                  <p className="mt-1.5 text-[10px] text-text-tertiary">
                    We&apos;ll send a verification link. You&apos;ll also use this email to recover your password.
                  </p>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary">Password</label>
                {authMode === 'login' && (
                  <Link
                    href="/user/forgot-password"
                    className="text-[10px] font-semibold text-text-secondary hover:text-text-primary transition-colors"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={loginForm.password}
                  onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                  onBlur={() => setTouched(t => ({ ...t, password: true }))}
                  placeholder={authMode === 'register' ? '6–24 characters' : '••••••••'}
                  maxLength={24}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  className={`w-full rounded-xl pl-4 pr-11 py-3 text-sm font-medium outline-none bg-surface-hover border ${
                    passwordError ? 'border-error' : 'border-border-subtle'
                  } text-text-primary placeholder:text-text-tertiary`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {passwordError && (
                <p className="mt-1.5 text-[11px] text-error">{passwordError}</p>
              )}
            </div>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={submit}
              disabled={isDisabled}
              className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 tracking-[-0.01em] transition-colors ${
                isDisabled
                  ? 'bg-surface-card text-text-tertiary cursor-not-allowed'
                  : 'bg-accent text-accent-text'
              }`}
            >
              {isLoggingIn
                ? <><Loader2 className="w-4 h-4 animate-spin" />{authMode === 'login' ? 'Signing in...' : 'Creating...'}</>
                : authMode === 'login' ? 'Login as User' : 'Register as User'}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setLoginError('');
              }}
              className="w-full py-3 rounded-xl text-sm font-bold tracking-[-0.01em] transition-colors bg-surface-hover hover:bg-surface-card border border-border-medium text-text-primary"
            >
              {authMode === 'login' ? 'Register' : 'Sign In'}
            </motion.button>
            </>
            )}

            <p className="text-center text-[11px] text-text-secondary">
              Connect your wallet after signing in to enable on-chain trading
            </p>

            {!hideMerchantLinks && (
              <Link
                href="/merchant/login?tab=register"
                className="relative overflow-hidden flex items-center justify-between rounded-xl px-4 py-3 transition-all group bg-white text-[#0B0F14] shadow-[0_10px_30px_-10px_rgba(168,247,98,0.45)] hover:shadow-[0_14px_40px_-10px_rgba(168,247,98,0.6)]"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, #ffffff 0%, #f0fff4 55%, #e6fbe6 100%)",
                }}
              >
                {/* corner glow */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-6 -top-6 w-20 h-20 rounded-full"
                  style={{ background: "radial-gradient(circle, rgba(168,247,98,0.55), transparent 70%)" }}
                />
                <div className="relative">
                  <div className="inline-flex items-center gap-1.5 mb-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-emerald-700">For Merchants</span>
                  </div>
                  <p className="text-[13px] font-bold leading-tight">Run your own P2P desk</p>
                  <p className="text-[10px] text-black/55 mt-0.5">Control spreads · earn on every trade</p>
                </div>
                <span className="relative shrink-0 ml-3 inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-full bg-[#0B0F14] text-white group-hover:translate-x-0.5 transition-transform">
                  Register
                  <span aria-hidden>→</span>
                </span>
              </Link>
            )}
          </div>
          </div>

        </div>
      </div>
    </motion.div>
  );
}
