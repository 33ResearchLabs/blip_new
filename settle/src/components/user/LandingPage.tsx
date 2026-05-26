"use client";

import { useState, useEffect } from "react";
import { motion, type PanInfo } from "framer-motion";
import { useRouter } from "next/navigation";
import { Loader2, Eye, EyeOff, ChevronLeft, User, Store, ArrowRight, Check, X, Mail, CheckCircle2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { InstallPWAButton } from "@/components/InstallPWAButton";
import { Logo } from "@/components/shared/Logo";
import { usePwaContext } from "@/hooks/usePwaContext";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import {
  validateUserUsername,
  validateUserPassword,
  validateUserPin,
  USER_PIN_LENGTH,
} from "@/lib/validation/userAuth";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import OrDivider from "@/components/auth/OrDivider";

interface LandingPageProps {
  loginForm: { username: string; password: string };
  setLoginForm: (f: { username: string; password: string }) => void;
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
  /** Seconds remaining on the server-side resend throttle. When >0 the
   *  resend button is disabled and a countdown is shown instead. */
  verificationCooldownSeconds?: number;
  /** True once polling (or the manual "I've verified" button) detects the
   *  email is verified. Renders a green banner above the sign-in form. */
  verificationSuccessNotice?: boolean;
  onDismissVerificationSuccess?: () => void;
  /** When true AND pendingVerificationEmail is set, the check-your-inbox
   *  panel swaps in place to a "Email verified" success card so the user
   *  sees a clear confirmation that polling detected their click. */
  pendingVerificationVerified?: boolean;
  /** Register-only email field. Driven by useUserAuth.registerEmail. */
  registerEmail?: string;
  setRegisterEmail?: (v: string) => void;
  /** When true, skips the welcome page and goes straight to the login form.
   *  Used by the /login route. */
  skipWelcome?: boolean;
  /** Apply a successful /api/auth/google response — same shape as the
   *  password-login success path (user + accessToken + token). When omitted
   *  the Google button is hidden so we never render an unwired flow. */
  onGoogleSuccess?: (data: any) => void;
}

export function LandingPage({
  loginForm, setLoginForm, authMode, setAuthMode,
  handleUserLogin, handleUserRegister, isLoggingIn, loginError, setLoginError,
  pendingVerificationEmail,
  onClearPendingVerification,
  onResendVerification,
  isResendingVerification,
  verificationCooldownSeconds = 0,
  verificationSuccessNotice,
  onDismissVerificationSuccess,
  pendingVerificationVerified,
  registerEmail = "",
  setRegisterEmail,
  skipWelcome = false,
  onGoogleSuccess,
}: LandingPageProps) {
  const router = useRouter();
  // Hide merchant entry points when running as the User PWA — those routes
  // are blocked by PwaAppGuard anyway, so the buttons would be dead.
  const pwa = usePwaContext();
  const hideMerchantLinks = pwa.standalone && pwa.app === "user";
  const [showPassword, setShowPassword] = useState(false);

  // ── Remember me ────────────────────────────────────────────────────────
  // Persists the entered username/email locally so users don't have to
  // retype it on every visit. Mirrors the merchant-side pattern. Default
  // is unchecked for SSR-stable markup; the saved preference + value
  // hydrate in the effect below.
  const [rememberMe, setRememberMe] = useState(false);
  useEffect(() => {
    try {
      const flag = window.localStorage.getItem("blip:user:rememberMe") === "true";
      if (!flag) return;
      setRememberMe(true);
      const saved = window.localStorage.getItem("blip:user:rememberedUsername") || "";
      if (saved && !loginForm.username) {
        setLoginForm({ ...loginForm, username: saved });
      }
    } catch {
      // localStorage unavailable; ignore.
    }
    // Run once on mount; we intentionally don't react to subsequent
    // username edits so we don't keep re-applying the saved value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleRememberMe = (checked: boolean) => {
    setRememberMe(checked);
    try {
      if (checked) {
        window.localStorage.setItem("blip:user:rememberMe", "true");
        if (loginForm.username) {
          window.localStorage.setItem(
            "blip:user:rememberedUsername",
            loginForm.username.trim(),
          );
        }
      } else {
        window.localStorage.removeItem("blip:user:rememberMe");
        window.localStorage.removeItem("blip:user:rememberedUsername");
      }
    } catch {
      // Ignore storage failures; in-memory state still updates.
    }
  };

  // Left-swipe → merchant login (Tinder-style horizontal pan). No-op inside
  // the User PWA — merchant routes are blocked there.
  const onSwipeEnd = (_: unknown, info: PanInfo) => {
    if (hideMerchantLinks) return;
    if (info.offset.x < -80 || info.velocity.x < -400) {
      router.push("/merchant/login?tab=signin");
    }
  };
  // Derived directly from the `skipWelcome` prop (which is itself read from
  // `?welcome=skip` in the URL) so that client-side navigation back to "/"
  // — e.g. tapping the Home button — flips us out of the form view and
  // back to the welcome chooser. Using `useState` here would freeze the
  // value at first mount and the Home button would appear to do nothing.
  const showWelcome = !skipWelcome;
  // Track which fields the user has interacted with so we don't surface
  // "required" errors before they've even started typing.
  const [touched, setTouched] = useState<{ username?: boolean; password?: boolean }>({});
  const submit = () => {
    if (authMode === 'login' && rememberMe && loginForm.username) {
      try {
        window.localStorage.setItem(
          'blip:user:rememberedUsername',
          loginForm.username.trim(),
        );
      } catch { /* ignore */ }
    }
    return authMode === 'login' ? handleUserLogin() : handleUserRegister();
  };

  const usernameError = authMode === 'register' && touched.username
    ? validateUserUsername(loginForm.username)
    : null;
  // Register uses a 6-digit PIN; login keeps the existing password field
  // since pre-PIN accounts still have password credentials.
  const passwordError = touched.password
    ? (authMode === 'register'
        ? validateUserPin(loginForm.password)
        : validateUserPassword(loginForm.password))
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
      !!validateUserUsername(loginForm.username) ||
      !!validateUserPin(loginForm.password) ||
      usernameTaken ||
      usernameAvailability.state === 'checking' ||
      // Email is required on the register tab — and must look like an
      // email so the backend's emailRegex check doesn't reject the
      // submission after we've already flashed a loading state.
      !registerEmail.trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerEmail.trim())
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
          className="relative z-10 mb-2"
        >
          <Logo onDark />
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

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="relative z-10 mt-8 sm:mt-12 text-[10px] font-mono tracking-[0.2em] text-white/40 flex items-center gap-3"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
          ESCROW-PROTECTED · ON-CHAIN SETTLEMENT
        </motion.p>
      </div>
    );
  }

  return (
    <motion.div
      className="w-full mx-auto flex flex-col bg-surface-base text-text-primary relative min-h-dvh touch-pan-y"
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

          <div className="flex-1 min-h-0 rounded-2xl p-4 sm:p-6 flex flex-col gap-3 sm:gap-4 bg-surface-card border border-border-subtle shadow-2xl">
            {/* Post-signup verification gate. Registration is NOT complete
                until the user clicks the link we just sent — the form is
                replaced by an inbox panel, which the poller in useUserAuth
                flips into a success card the moment verification is
                detected. Mirrors the merchant flow exactly. */}
            {pendingVerificationEmail ? (
              pendingVerificationVerified ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-5 py-2"
                >
                  <div className="flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                    </div>
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-base font-semibold text-text-primary">
                      Email verified
                    </p>
                    <p className="text-xs text-text-secondary leading-relaxed">
                      <span className="font-semibold break-all text-text-primary">
                        {pendingVerificationEmail}
                      </span>{" "}
                      is confirmed. Your account is ready to use.
                    </p>
                  </div>

                  <div className="rounded-xl px-4 py-3 flex items-start gap-3 bg-emerald-500/[0.06] border border-emerald-500/20">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-text-secondary leading-relaxed">
                      Verified emails help us protect your funds and
                      recover access if you ever lose your device.
                    </p>
                  </div>

                  {onClearPendingVerification && (
                    <button
                      onClick={onClearPendingVerification}
                      className="w-full py-3 rounded-xl text-sm font-bold bg-accent text-accent-text"
                    >
                      Continue to sign in
                    </button>
                  )}
                </motion.div>
              ) : (
                <div className="space-y-3.5">
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 flex gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                      <Mail className="w-4 h-4 text-emerald-400" />
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
                        This screen updates automatically as soon as we detect
                        the verification.
                      </p>
                    </div>
                  </div>

                  <div className="text-[12px] text-text-tertiary flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-text-tertiary" />
                    Waiting for verification…
                  </div>

                  {onResendVerification && (
                    <button
                      onClick={onResendVerification}
                      disabled={isResendingVerification || verificationCooldownSeconds > 0}
                      className="w-full py-2.5 rounded-lg text-[13px] font-medium bg-surface-hover hover:bg-surface-card border border-border-medium text-text-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isResendingVerification ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Sending…
                        </>
                      ) : verificationCooldownSeconds > 0 ? (
                        `Resend available in ${verificationCooldownSeconds}s`
                      ) : (
                        "Resend verification email"
                      )}
                    </button>
                  )}

                  <p className="text-[11px] text-text-tertiary text-center">
                    Didn&apos;t get it? Check spam. Links expire after 24 hours.
                  </p>
                </div>
              )
            ) : (
              <>
            {loginError === 'EMAIL_NOT_VERIFIED' ? (
              <div className="rounded-xl p-3 text-sm bg-amber-500/10 border border-amber-500/30 text-amber-300 space-y-2">
                <p className="font-medium">
                  Verify your email before signing in.
                </p>
                <p className="text-xs text-amber-200/80">
                  We just sent a fresh verification link
                  {loginForm.username.includes('@')
                    ? <> to <span className="font-semibold break-all">{loginForm.username.trim()}</span></>
                    : null}.
                  Click it from your inbox, then come back to sign in.
                </p>
                {onResendVerification && (
                  <button
                    type="button"
                    onClick={onResendVerification}
                    disabled={isResendingVerification || verificationCooldownSeconds > 0}
                    className="mt-1 w-full py-2 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-200 hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isResendingVerification ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                    ) : verificationCooldownSeconds > 0 ? (
                      <>Resend available in {verificationCooldownSeconds}s</>
                    ) : (
                      'Resend verification email'
                    )}
                  </button>
                )}
              </div>
            ) : loginError ? (
              <div className="rounded-xl p-3 text-sm bg-error-dim border border-error-border text-error">
                {loginError}
              </div>
            ) : null}

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
                placeholder={authMode === 'register' ? '3–20 chars · letters, numbers, _' : 'username or you@email.com'}
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

            {/* Email field — register-only. We collect it so we can run
                an email verification gate (mailed link → users.email_verified=true).
                Used later by forgot-password and account-recovery flows. */}
            {authMode === 'register' && setRegisterEmail && (
              <div>
                <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">
                  Email
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={registerEmail}
                    onChange={e => setRegisterEmail(e.target.value)}
                    placeholder="you@email.com"
                    autoCapitalize="none"
                    autoCorrect="off"
                    maxLength={254}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                    className="w-full rounded-xl px-4 py-3 pl-10 text-sm font-medium outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary"
                  />
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                </div>
                <p className="mt-1.5 text-[10px] text-text-tertiary">
                  We&apos;ll send you a verification link before activating
                  your account.
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary">
                  {authMode === 'register' ? `Set a ${USER_PIN_LENGTH}-digit PIN` : 'Password'}
                </label>
                {/* Forgot-password — login tab only. The backend
                    /api/auth/user/forgot-password emails a 15-min reset
                    link to the address on file, gated to accounts that
                    have a password set (wallet-only users have nothing
                    to reset). */}
                {authMode === 'login' && (
                  <Link
                    href="/user/forgot-password"
                    className="text-[11px] font-medium text-text-tertiary hover:text-text-primary transition-colors"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={loginForm.password}
                  onChange={e => {
                    const next = authMode === 'register'
                      ? e.target.value.replace(/\D/g, '').slice(0, USER_PIN_LENGTH)
                      : e.target.value;
                    setLoginForm({ ...loginForm, password: next });
                  }}
                  onBlur={() => setTouched(t => ({ ...t, password: true }))}
                  placeholder={authMode === 'register' ? `${USER_PIN_LENGTH}-digit PIN` : '••••••••'}
                  maxLength={authMode === 'register' ? USER_PIN_LENGTH : 24}
                  inputMode={authMode === 'register' ? 'numeric' : undefined}
                  autoComplete={authMode === 'register' ? 'one-time-code' : 'current-password'}
                  onKeyDown={e => e.key === 'Enter' && submit()}
                  className={`w-full rounded-xl pl-4 pr-11 py-3 text-sm font-medium outline-none bg-surface-hover border ${
                    passwordError ? 'border-error' : 'border-border-subtle'
                  } text-text-primary placeholder:text-text-tertiary ${
                    authMode === 'register' ? 'tracking-[0.4em] text-center' : ''
                  }`}
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
              {authMode === 'register' && !passwordError && (
                <p className="mt-1.5 text-[10px] text-text-tertiary">
                  You&apos;ll use this PIN to sign in. Keep it private.
                </p>
              )}
            </div>

            {/* Remember me — login tab only. Pre-fills the username on
                future visits to this device. */}
            {authMode === 'login' && (
              <label className="flex items-center gap-2 cursor-pointer select-none -mt-1">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => toggleRememberMe(e.target.checked)}
                  className="peer sr-only"
                />
                <span
                  className={`w-4 h-4 rounded-md inline-flex items-center justify-center border transition-colors ${
                    rememberMe
                      ? 'bg-accent border-accent'
                      : 'border-border-medium bg-surface-card'
                  }`}
                >
                  {rememberMe && <Check className="w-3 h-3 text-accent-text" strokeWidth={3} />}
                </span>
                <span className="text-[12px] font-medium text-text-secondary">
                  Remember me
                </span>
              </label>
            )}

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

            {onGoogleSuccess && (
              <div className="space-y-2 pt-1">
                <OrDivider />
                <GoogleSignInButton
                  role="user"
                  source={authMode === 'login' ? 'user_app_login_google' : 'user_app_register_google'}
                  theme="dark"
                  onSuccess={onGoogleSuccess}
                  onError={(msg) => setLoginError(msg)}
                  disabled={isLoggingIn}
                />
              </div>
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
              </>
            )}
          </div>
          </div>

        </div>
      </div>

    </motion.div>
  );
}
