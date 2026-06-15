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
      router.push("/market/login?tab=signin");
    }
  };
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


  return (
    <motion.div
      className="w-full mx-auto flex flex-col relative min-h-dvh touch-pan-y text-[#1d1d1f]"
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        background:
          "radial-gradient(50% 35% at 50% 0%, rgba(204,120,92,0.07), transparent 70%), #FAF8F5",
      }}
      drag="x"
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.35, right: 0 }}
      onPanEnd={onSwipeEnd}
    >
      {/* Fraunces — React 19 hoists <link> elements into <head> automatically.
          Used for the headline italic accent ("Sign in.") below. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap"
      />

      {/* Swipe hint — only on first interaction-less render */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 z-20 text-[10px] font-mono tracking-[0.2em] text-[#6b675f]/60 rotate-90 origin-right"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.7, 0.7, 0] }}
        transition={{ duration: 4, delay: 1.5, times: [0, 0.15, 0.85, 1] }}
      >
        ← SWIPE FOR MERCHANT
      </motion.div>

      {/* Topbar — brand on the left, utility actions on the right.
          On mobile only the Install PWA button is shown; Home is
          handled by the brand Logo (already wraps a Link to `/`) and
          Merchant has its own dedicated promo card at the bottom of
          the form, so cramming the trio across <640px just caused the
          "Merchant" pill to clip ("Merch…"). */}
      <header className="flex items-center justify-between gap-3 px-5 py-5 sm:px-8 sm:py-[22px]">
        {/* Inline brand mark — the shared <Logo /> component renders
            with `text-foreground`, which resolves to `#ffffff` inside
            the `.user-scope` (dark-theme) wrapper and is therefore
            invisible on this page's cream surface. We inline an ink-
            stroked variant so the wordmark always reads against the
            light card, regardless of the active user-scope theme. */}
        <Link
          href="/"
          aria-label="Blip money home"
          className="flex items-center gap-1.5 no-underline"
        >
          
                    <img
                      src="/brand/blip-icon-192.png"
                      alt="Blip"
                      width={36}
                      height={36}
                      decoding="async"
                      fetchPriority="high"
                      className="w-9 h-9 object-contain"
                    />
                  
          <span
            className="flex items-baseline"
            style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.045em", fontWeight: 700, color: "#1d1d1f" }}
          >
            <span>Blip</span>
            <span
              className="ml-1"
              style={{ fontStyle: "italic", fontWeight: 600, letterSpacing: "-0.045em", color: "#1d1d1f" }}
            >
              money
            </span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            aria-label="Back to home"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-[#1d1d1f] bg-white border border-[#dcd4c5] hover:border-[#1d1d1f] transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Home</span>
          </Link>
          <InstallPWAButton app="user" />
          {!hideMerchantLinks && (
            <Link
              href="/market/login"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-[#1d1d1f] bg-white border border-[#dcd4c5] hover:border-[#1d1d1f] transition-colors"
            >
              Merchant
              <span aria-hidden>→</span>
            </Link>
          )}
          <span className="hidden md:inline-flex items-center gap-2 text-[11.5px] uppercase font-semibold text-[#6b675f] tracking-[0.06em]">
            <span
              className="inline-block w-[7px] h-[7px] rounded-full bg-[#d8b85a]"
              style={{ boxShadow: "0 0 0 4px rgba(216,184,90,0.18)" }}
            />
            Pre-launch
          </span>
        </div>
      </header>

      {/* Center stage with the sign-in card */}
      <main className="flex-1 flex items-center justify-center px-5 py-6 sm:px-6 sm:py-8 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[440px] bg-white border border-[#ece6dc] rounded-[22px] pt-9 px-[26px] pb-7 sm:pt-11 sm:px-10 sm:pb-9"
          style={{ boxShadow: "0 30px 80px -40px rgba(60,40,30,0.14)" }}
        >
          {/* Eyebrow */}
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.20em] text-[#cc785c] bg-[#f4e3d9] px-3 py-1.5 rounded-full font-medium mb-[22px]">
            {authMode === 'login' ? 'app.blip.money' : 'Create account'}
          </span>

          {/* Headline (Fraunces) */}
          <h1
            className="text-[30px] sm:text-[36px] leading-[1.05] tracking-[-0.022em] text-[#1d1d1f] mb-2"
            style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500 }}
          >
            {authMode === 'login' ? (
              <>Welcome back. <em className="italic text-[#cc785c]">Sign in.</em></>
            ) : (
              <>Get started. <em className="italic text-[#cc785c]">Create account.</em></>
            )}
          </h1>
          <p className="text-[#3a3a3c] text-[14.5px] leading-[1.55] mb-8">
            {authMode === 'login'
              ? "One login. We'll take you to wherever you were last — user app or Blip Market."
              : "Pick a username and a 6-digit PIN. We'll send a quick email verification before activating your account."}
          </p>

          {/* Polling success notice — green banner when the inbox poller
              detects verification while the user is on the sign-in form. */}
          {verificationSuccessNotice && !pendingVerificationEmail && (
            <div className="mb-4 rounded-xl bg-[#eaf8ef] border border-[#3fae6a]/30 px-4 py-3 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-[#3fae6a] flex-shrink-0 mt-0.5" />
              <div className="flex-1 text-[13px] text-[#1d1d1f]">
                Email verified — you can sign in now.
              </div>
              {onDismissVerificationSuccess && (
                <button
                  type="button"
                  onClick={onDismissVerificationSuccess}
                  aria-label="Dismiss"
                  className="text-[#6b675f] hover:text-[#1d1d1f]"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

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
                  <div className="w-16 h-16 rounded-full bg-[#3fae6a]/10 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-[#3fae6a]" />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <p className="text-base font-semibold text-[#1d1d1f]">
                    Email verified
                  </p>
                  <p className="text-xs text-[#3a3a3c] leading-relaxed">
                    <span className="font-semibold break-all text-[#1d1d1f]">
                      {pendingVerificationEmail}
                    </span>{" "}
                    is confirmed. Your account is ready to use.
                  </p>
                </div>

                <div className="rounded-xl px-4 py-3 flex items-start gap-3 bg-[#3fae6a]/[0.06] border border-[#3fae6a]/20">
                  <ShieldCheck className="w-4 h-4 text-[#3fae6a] shrink-0 mt-0.5" />
                  <p className="text-[11px] text-[#3a3a3c] leading-relaxed">
                    Verified emails help us protect your funds and
                    recover access if you ever lose your device.
                  </p>
                </div>

                {onClearPendingVerification && (
                  <button
                    onClick={onClearPendingVerification}
                    className="w-full py-3.5 rounded-xl text-[14.5px] font-medium bg-[#1d1d1f] hover:bg-black text-[#fff] flex items-center justify-center gap-2 transition-colors"
                  >
                    Continue to sign in
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </motion.div>
            ) : (
              <div className="space-y-3.5">
                <div className="rounded-xl border border-[#3fae6a]/25 bg-[#3fae6a]/[0.06] p-4 flex gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#3fae6a]/15 flex items-center justify-center flex-shrink-0">
                    <Mail className="w-4 h-4 text-[#3fae6a]" />
                  </div>
                  <div className="text-[13px] leading-relaxed text-[#1d1d1f]">
                    <p>
                      We sent a verification link to{" "}
                      <span className="font-semibold break-all">
                        {pendingVerificationEmail}
                      </span>
                      .
                    </p>
                    <p className="mt-1 text-[#3a3a3c]">
                      Click the link in that email to activate your account.
                      This screen updates automatically as soon as we detect
                      the verification.
                    </p>
                  </div>
                </div>

                <div className="text-[12px] text-[#6b675f] flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6b675f]" />
                  Waiting for verification…
                </div>

                {onResendVerification && (
                  <button
                    onClick={onResendVerification}
                    disabled={isResendingVerification || verificationCooldownSeconds > 0}
                    className="w-full py-2.5 rounded-lg text-[13px] font-medium bg-[#fdfbf7] hover:border-[#1d1d1f] border border-[#dcd4c5] text-[#1d1d1f] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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

                <p className="text-[11px] text-[#6b675f] text-center">
                  Didn&apos;t get it? Check spam. Links expire after 24 hours.
                </p>
              </div>
            )
          ) : (
            <>
              {/* Mode tabs — segmented control */}
              <div className="flex mb-5 p-1 rounded-xl bg-[#f4e3d9]/50">
                <button
                  type="button"
                  onClick={() => { setAuthMode('login'); setLoginError(''); }}
                  className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-all ${
                    authMode === 'login'
                      ? 'bg-white text-[#1d1d1f] shadow-[0_1px_2px_rgba(60,40,30,0.06)]'
                      : 'text-[#6b675f]'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMode('register'); setLoginError(''); }}
                  className={`flex-1 py-2 rounded-lg text-[13px] font-medium transition-all ${
                    authMode === 'register'
                      ? 'bg-white text-[#1d1d1f] shadow-[0_1px_2px_rgba(60,40,30,0.06)]'
                      : 'text-[#6b675f]'
                  }`}
                >
                  Create Account
                </button>
              </div>

              {/* Error banners */}
              {loginError === 'EMAIL_NOT_VERIFIED' ? (
                <div className="mb-4 rounded-xl p-3.5 text-sm bg-[#fef6e4] border border-[#cc785c]/30 text-[#7a4327] space-y-2">
                  <p className="font-medium">
                    Verify your email before signing in.
                  </p>
                  <p className="text-xs text-[#7a4327]/80">
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
                      className="mt-1 w-full py-2 rounded-lg text-xs font-semibold bg-[#cc785c]/10 border border-[#cc785c]/30 text-[#7a4327] hover:bg-[#cc785c]/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
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
                <div className="mb-4 rounded-xl p-3.5 text-sm bg-[#fdecea] border border-[#e5484d]/30 text-[#a31b1f]">
                  {loginError}
                </div>
              ) : null}

              {/* Form — Enter on any input submits via onSubmit */}
              <form
                onSubmit={(e) => { e.preventDefault(); submit(); }}
                className="space-y-3"
              >
                {/* Username */}
                <div>
                  <label className="block text-[11.5px] tracking-[0.08em] uppercase text-[#6b675f] font-medium mb-2">
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
                    placeholder={authMode === 'register' ? '4–20 chars · letters, numbers, _' : 'username or you@email.com'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    maxLength={authMode === 'register' ? 20 : 254}
                    className={`w-full rounded-xl px-4 py-3.5 text-[15px] outline-none transition-all bg-[#fdfbf7] focus:bg-white focus:shadow-[0_0_0_4px_rgba(204,120,92,0.10)] text-[#1d1d1f] placeholder:text-[#6b675f]/60 border ${
                      usernameError || usernameTaken
                        ? 'border-[#e5484d]/60 focus:border-[#e5484d]'
                        : 'border-[#dcd4c5] focus:border-[#cc785c]'
                    }`}
                  />
                  {/* Per-field status: format error wins over availability,
                      since availability only matters once the format passes. */}
                  {usernameError ? (
                    <p className="mt-1.5 text-[11.5px] text-[#a31b1f]">{usernameError}</p>
                  ) : authMode === 'register' && usernameAvailability.state === 'checking' ? (
                    <p className="mt-1.5 text-[11.5px] text-[#6b675f] inline-flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Checking availability…
                    </p>
                  ) : authMode === 'register' && usernameAvailability.state === 'available' &&
                    usernameAvailability.value === loginForm.username.trim() ? (
                    <p className="mt-1.5 text-[11.5px] text-[#3fae6a] inline-flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Available
                    </p>
                  ) : usernameTaken ? (
                    <p className="mt-1.5 text-[11.5px] text-[#a31b1f] inline-flex items-center gap-1">
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
                    <label className="block text-[11.5px] tracking-[0.08em] uppercase text-[#6b675f] font-medium mb-2">
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
                        className="w-full rounded-xl pl-10 pr-4 py-3.5 text-[15px] outline-none transition-all bg-[#fdfbf7] focus:bg-white focus:border-[#cc785c] focus:shadow-[0_0_0_4px_rgba(204,120,92,0.10)] text-[#1d1d1f] placeholder:text-[#6b675f]/60 border border-[#dcd4c5]"
                      />
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b675f]" />
                    </div>
                    <p className="mt-1.5 text-[11px] text-[#6b675f]">
                      We&apos;ll send you a verification link before activating
                      your account.
                    </p>
                  </div>
                )}

                {/* Password / PIN */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[11.5px] tracking-[0.08em] uppercase text-[#6b675f] font-medium">
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
                        className="text-[12px] font-medium text-[#3a3a3c] hover:text-[#cc785c] transition-colors"
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
                      className={`w-full rounded-xl pl-4 pr-11 py-3.5 text-[15px] outline-none transition-all bg-[#fdfbf7] focus:bg-white focus:shadow-[0_0_0_4px_rgba(204,120,92,0.10)] text-[#1d1d1f] placeholder:text-[#6b675f]/60 border ${
                        passwordError
                          ? 'border-[#e5484d]/60 focus:border-[#e5484d]'
                          : 'border-[#dcd4c5] focus:border-[#cc785c]'
                      } ${authMode === 'register' ? 'tracking-[0.4em] text-center' : ''}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6b675f] hover:text-[#1d1d1f] transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordError ? (
                    <p className="mt-1.5 text-[11.5px] text-[#a31b1f]">{passwordError}</p>
                  ) : authMode === 'register' ? (
                    <p className="mt-1.5 text-[11px] text-[#6b675f]">
                      You&apos;ll use this PIN to sign in. Keep it private.
                    </p>
                  ) : null}
                </div>

                {/* Remember me — login tab only. Pre-fills the username on
                    future visits to this device. */}
                {authMode === 'login' && (
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => toggleRememberMe(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span
                      className={`w-4 h-4 rounded-md inline-flex items-center justify-center border transition-colors ${
                        rememberMe
                          ? 'bg-[#1d1d1f] border-[#1d1d1f]'
                          : 'border-[#dcd4c5] bg-white'
                      }`}
                    >
                      {rememberMe && <Check className="w-3 h-3 text-[#fff]" strokeWidth={3} />}
                    </span>
                    <span className="text-[12.5px] font-medium text-[#3a3a3c]">
                      Remember me
                    </span>
                  </label>
                )}

                {/* Submit */}
                <motion.button
                  type="submit"
                  whileTap={{ scale: 0.98 }}
                  disabled={isDisabled}
                  className={`w-full py-3.5 px-[18px] mt-1.5 rounded-xl text-[14.5px] font-medium flex items-center justify-center gap-2 transition-colors ${
                    isDisabled
                      ? 'bg-[#dcd4c5]/50 text-[#6b675f]/70 cursor-not-allowed'
                      : 'bg-[#1d1d1f] hover:bg-black text-[#fff]'
                  }`}
                >
                  {isLoggingIn ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {authMode === 'login' ? 'Signing in…' : 'Creating account…'}
                    </>
                  ) : (
                    <>
                      {authMode === 'login' ? 'Sign in' : 'Create account'}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </motion.button>
              </form>

              {/* Or + Google */}
              {onGoogleSuccess && (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-[#6b675f]">
                    <span className="flex-1 h-px bg-[#ece6dc]" />
                    or
                    <span className="flex-1 h-px bg-[#ece6dc]" />
                  </div>
                  <GoogleSignInButton
                    role="user"
                    source={authMode === 'login' ? 'user_app_login_google' : 'user_app_register_google'}
                    theme="light"
                    onSuccess={onGoogleSuccess}
                    onError={(msg) => setLoginError(msg)}
                    disabled={isLoggingIn}
                  />
                </div>
              )}

              <p className="mt-5 text-center text-[11.5px] text-[#6b675f]">
                Connect your wallet after signing in to enable on-chain trading
              </p>

              {/* Foot card — mode toggle in portal.html's "New to Blip?" style */}
              <div className="mt-[14px] pt-[14px] border-t border-[#ece6dc] text-[12.5px] text-[#6b675f] text-center">
                {authMode === 'login' ? (
                  <>New to Blip?{" "}
                    <button
                      type="button"
                      onClick={() => { setAuthMode('register'); setLoginError(''); }}
                      className="font-medium text-[#1d1d1f] hover:text-[#cc785c] border-b border-[#dcd4c5] hover:border-[#cc785c] transition-colors"
                    >
                      Create an account →
                    </button>
                  </>
                ) : (
                  <>Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => { setAuthMode('login'); setLoginError(''); }}
                      className="font-medium text-[#1d1d1f] hover:text-[#cc785c] border-b border-[#dcd4c5] hover:border-[#cc785c] transition-colors"
                    >
                      Sign in →
                    </button>
                  </>
                )}
              </div>

              {/* Merchant promo */}
              {!hideMerchantLinks && (
                <Link
                  href="/market/login?tab=register"
                  className="relative overflow-hidden mt-4 flex items-center justify-between rounded-xl px-4 py-3 transition-colors group bg-[#fdfbf7] border border-[#ece6dc] hover:border-[#cc785c]"
                >
                  <div className="relative">
                    <div className="inline-flex items-center gap-1.5 mb-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#3fae6a]" />
                      <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-[#2d8c52]">For Merchants</span>
                    </div>
                    <p className="text-[13px] font-semibold leading-tight text-[#1d1d1f]">Run your own P2P desk</p>
                    <p className="text-[10.5px] text-[#6b675f] mt-0.5">Control spreads · earn on every trade</p>
                  </div>
                  <span className="shrink-0 ml-3 inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-full bg-[#1d1d1f] text-[#fff] group-hover:translate-x-0.5 transition-transform">
                    Register
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </Link>
              )}
            </>
          )}
        </motion.div>
      </main>

      {/* Below feature tags */}
      <div className="px-5 py-6 sm:px-8 flex justify-center gap-7 text-[11.5px] text-[#6b675f] flex-wrap">
        <span className="inline-flex items-center gap-2">
          <span className="w-[5px] h-[5px] rounded-full bg-[#6b675f]" />
          Escrow-protected
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-[5px] h-[5px] rounded-full bg-[#6b675f]" />
          On-chain settlement
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-[5px] h-[5px] rounded-full bg-[#6b675f]" />
          Same login on both sides
        </span>
      </div>
    </motion.div>
  );
}
