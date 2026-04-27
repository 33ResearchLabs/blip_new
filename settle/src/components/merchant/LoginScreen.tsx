"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Loader2,
  Eye,
  EyeOff,
  Zap,
  Shield,
  TrendingUp,
  Check,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { MerchantWelcomePage } from "./MerchantWelcomePage";

interface LoginScreenProps {
  authTab: "signin" | "create";
  setAuthTab: (tab: "signin" | "create") => void;
  loginForm: { email: string; password: string };
  setLoginForm: React.Dispatch<React.SetStateAction<{ email: string; password: string }>>;
  registerForm: { email: string; password: string; confirmPassword: string; businessName: string };
  setRegisterForm: React.Dispatch<
    React.SetStateAction<{ email: string; password: string; confirmPassword: string; businessName: string }>
  >;
  loginError: string;
  setLoginError: (err: string) => void;
  isLoggingIn: boolean;
  isRegistering: boolean;
  isAuthenticating: boolean;
  onLogin: () => void;
  onRegister: () => void;
  onResendVerification?: () => void;
  isResendingVerification?: boolean;
  /** When true, skips the welcome page and goes straight to the login form. */
  skipWelcome?: boolean;
}

export function LoginScreen({
  authTab,
  setAuthTab,
  loginForm,
  setLoginForm,
  registerForm,
  setRegisterForm,
  loginError,
  setLoginError,
  isLoggingIn,
  isRegistering,
  isAuthenticating,
  onLogin,
  onRegister,
  onResendVerification,
  isResendingVerification,
  skipWelcome = false,
}: LoginScreenProps) {
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showWelcome] = useState(!skipWelcome);

  if (showWelcome) {
    return (
      <MerchantWelcomePage
        onGetStarted={() => {
          if (typeof window !== "undefined") {
            window.location.href = "/merchant/login?tab=register";
          }
        }}
        onSignIn={() => {
          if (typeof window !== "undefined") {
            window.location.href = "/merchant/login?tab=signin";
          }
        }}
      />
    );
  }

  const handleGoogle = () => {
    alert("Google sign-in is coming soon");
  };

  const pwd = registerForm.password;
  const pwdChecks = {
    length: pwd.length >= 8,
    upper: /[A-Z]/.test(pwd),
    number: /\d/.test(pwd),
    special: /[^A-Za-z0-9]/.test(pwd),
  };

  return (
    <div className="h-screen overflow-hidden bg-[#070708] text-white relative font-sans">
      {/* subtle grid pattern */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      {/* ambient orange glows */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[560px] h-[560px] rounded-full bg-orange-500/15 blur-[180px]" />
      <div className="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-orange-500/[0.06] blur-[200px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[560px] h-[560px] rounded-full bg-orange-500/15 blur-[180px]" />

      <div className="relative grid lg:grid-cols-2 h-full">
        {/* ─────────── LEFT PANEL — marketing ─────────── */}
        <LeftPanel mode={authTab} />

        {/* ─────────── RIGHT PANEL — form ─────────── */}
        <div className="flex items-center justify-center px-6 py-6 lg:px-10 xl:px-14 h-full overflow-y-auto lg:overflow-hidden">
          <div className="relative w-full max-w-[440px]">
            {/* glow halo behind card */}
            <div className="pointer-events-none absolute -inset-4 bg-gradient-to-br from-orange-500/20 via-orange-500/5 to-transparent rounded-3xl blur-2xl" />
            <div className="relative bg-[#0C0C0E]/80 backdrop-blur-xl border border-white/[0.08] rounded-2xl p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
            {/* MERCHANT PORTAL pill */}
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 mb-3">
              <span className="text-[10px] font-semibold tracking-[0.18em] text-orange-400">
                MERCHANT PORTAL
              </span>
            </div>

            {authTab === "signin" ? (
              <>
                <h1 className="text-2xl md:text-3xl font-bold text-white mb-1.5">Merchant Sign In</h1>
                <p className="text-white/50 mb-5 text-[13px] leading-relaxed">
                  Access your merchant dashboard and manage your business
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl md:text-[28px] font-bold text-white mb-1.5 leading-tight">
                  Create your merchant account
                </h1>
                <p className="text-white/50 mb-4 text-[13px] leading-relaxed">
                  Join Blip Money and start managing your business in minutes.
                </p>
              </>
            )}

            {/* Error banner */}
            {loginError && loginError === "EMAIL_NOT_VERIFIED" ? (
              <div className="mb-3 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 space-y-2">
                <p className="text-sm text-amber-400 font-medium">Email not verified</p>
                <p className="text-xs text-white/50">Check your inbox for a verification link.</p>
                {onResendVerification && (
                  <button
                    onClick={onResendVerification}
                    disabled={isResendingVerification}
                    className="w-full py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                  >
                    {isResendingVerification ? "Sending..." : "Resend Verification Email"}
                  </button>
                )}
              </div>
            ) : loginError ? (
              <div className="mb-3 bg-red-500/10 border border-red-500/25 rounded-xl p-2.5 text-sm text-red-400">
                {loginError}
              </div>
            ) : null}

            {isAuthenticating && (
              <div className="mb-3 bg-white/[0.04] border border-white/8 rounded-xl p-2.5 text-sm text-white/70 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Authenticating with wallet...
              </div>
            )}

            {/* ─── SIGN IN FORM ─── */}
            {authTab === "signin" && (
              <div className="space-y-3.5">
                <FieldEmail
                  label="Email Address"
                  value={loginForm.email}
                  placeholder="merchant@email.com"
                  onChange={(v) => setLoginForm((p) => ({ ...p, email: v }))}
                  onBlur={(v) => setLoginForm((p) => ({ ...p, email: v.trim() }))}
                />

                <FieldPassword
                  label="Password"
                  value={loginForm.password}
                  show={showLoginPassword}
                  setShow={setShowLoginPassword}
                  placeholder="••••••••••••"
                  onChange={(v) => setLoginForm((p) => ({ ...p, password: v }))}
                  onEnter={onLogin}
                  trailingLabel={
                    <Link
                      href="/merchant/forgot-password"
                      className="text-[12px] text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      Forgot password?
                    </Link>
                  }
                />

                <PrimaryButton
                  onClick={onLogin}
                  disabled={isLoggingIn || !loginForm.email || !loginForm.password}
                  loading={isLoggingIn}
                  loadingLabel="Signing in..."
                  label="Sign In as Merchant"
                />

                <OrDivider />

                <GoogleButton onClick={handleGoogle} />

                <p className="text-center text-[13px] text-white/40">
                  Don&apos;t have an account?{" "}
                  <button
                    onClick={() => {
                      setAuthTab("create");
                      setLoginError("");
                    }}
                    className="text-orange-400 font-medium hover:text-orange-300 transition-colors"
                  >
                    Register as Merchant
                  </button>
                </p>
              </div>
            )}

            {/* ─── CREATE ACCOUNT FORM ─── */}
            {authTab === "create" && (
              <div className="space-y-2.5">
                <FieldText
                  label="Full Name"
                  value={registerForm.businessName}
                  placeholder="Enter your full name"
                  maxLength={100}
                  onChange={(v) => setRegisterForm((p) => ({ ...p, businessName: v }))}
                  onBlur={(v) => setRegisterForm((p) => ({ ...p, businessName: v.trim() }))}
                />

                <FieldEmail
                  label="Email Address"
                  value={registerForm.email}
                  placeholder="Enter your email address"
                  onChange={(v) => setRegisterForm((p) => ({ ...p, email: v }))}
                  onBlur={(v) => setRegisterForm((p) => ({ ...p, email: v.trim() }))}
                />

                <div>
                  <FieldPassword
                    label="Password"
                    value={registerForm.password}
                    show={showRegisterPassword}
                    setShow={setShowRegisterPassword}
                    placeholder="Create a strong password"
                    onChange={(v) => setRegisterForm((p) => ({ ...p, password: v }))}
                  />
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1.5">
                    <PwdCheck ok={pwdChecks.length} label="8+ characters" />
                    <PwdCheck ok={pwdChecks.upper} label="Uppercase letter" />
                    <PwdCheck ok={pwdChecks.number} label="A number" />
                    <PwdCheck ok={pwdChecks.special} label="Special character" />
                  </div>
                </div>

                <FieldPassword
                  label="Confirm Password"
                  value={registerForm.confirmPassword}
                  show={showConfirmPassword}
                  setShow={setShowConfirmPassword}
                  placeholder="Confirm your password"
                  onChange={(v) => setRegisterForm((p) => ({ ...p, confirmPassword: v }))}
                  onEnter={onRegister}
                />

                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={agreeTerms}
                    onChange={(e) => setAgreeTerms(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/5 accent-orange-500"
                  />
                  <span className="text-[12px] text-white/60 leading-snug">
                    I agree to the{" "}
                    <a href="#" className="text-orange-400 hover:text-orange-300">
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a href="#" className="text-orange-400 hover:text-orange-300">
                      Privacy Policy
                    </a>
                  </span>
                </label>

                <PrimaryButton
                  onClick={onRegister}
                  disabled={
                    isRegistering ||
                    !registerForm.email ||
                    !registerForm.password ||
                    !registerForm.confirmPassword ||
                    !registerForm.businessName?.trim() ||
                    !agreeTerms
                  }
                  loading={isRegistering}
                  loadingLabel="Creating Account..."
                  label="Create Account"
                />

                <OrDivider />

                <GoogleButton onClick={handleGoogle} />

                <p className="text-center text-[13px] text-white/40">
                  Already have an account?{" "}
                  <button
                    onClick={() => {
                      setAuthTab("signin");
                      setLoginError("");
                    }}
                    className="text-orange-400 font-medium hover:text-orange-300 transition-colors"
                  >
                    Sign In
                  </button>
                </p>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── LEFT PANEL ───────────────────────────── */

function LeftPanel({ mode }: { mode: "signin" | "create" }) {
  return (
    <div className="hidden lg:flex flex-col px-10 xl:px-16 py-8 h-full overflow-hidden relative">
      {/* logo */}
      <div className="absolute top-8 left-10 xl:left-16 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-[0_0_16px_rgba(255,122,26,0.4)]">
          <Zap className="w-4 h-4 text-white fill-white" />
        </div>
        <span className="text-[18px] font-bold text-white">
          Blip <span className="font-light italic text-white/80">money</span>
        </span>
      </div>

      {/* footer trust line */}
      <div className="absolute bottom-8 left-10 xl:left-16 flex items-center gap-2 text-white/55 text-[12px]">
        <Shield className="w-3.5 h-3.5 text-orange-500" />
        <span>Secure. Encrypted. Built for your business.</span>
      </div>

      {mode === "signin" ? <SignInLeft /> : <CreateLeft />}
    </div>
  );
}

function SignInLeft() {
  return (
    <div className="flex-1 flex flex-col justify-center min-h-0 max-w-lg">
      <h2 className="text-[34px] xl:text-[42px] leading-[1.05] font-bold text-white flex-shrink-0">
        Built for Merchants.
        <br />
        Designed for <span className="text-orange-500">Growth.</span>
      </h2>
      <p className="text-white/50 mt-4 text-[14px] leading-relaxed flex-shrink-0">
        Everything you need to manage payments, earn rewards and scale your business.
      </p>

      <div className="grid grid-cols-1 gap-3 mt-7 flex-shrink-0">
        <Feature
          icon={<Zap className="w-4 h-4 text-orange-400" />}
          color="bg-orange-500/15"
          title="Fast Settlements"
          subtitle="Instant transfers, low fees"
        />
        <Feature
          icon={<Shield className="w-4 h-4 text-emerald-400" />}
          color="bg-emerald-500/15"
          title="Bank-grade Security"
          subtitle="Encrypted & secure infrastructure"
        />
        <Feature
          icon={<TrendingUp className="w-4 h-4 text-violet-400" />}
          color="bg-violet-500/15"
          title="Growth Rewards"
          subtitle="Earn more as you grow"
        />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-7 flex-shrink-0">
        <StatCard value="$2.4B+" label="Volume settled" />
        <StatCard value="100K+" label="Merchants" />
        <StatCard value="0.8s" label="Avg settle" highlight />
      </div>
    </div>
  );
}

function CreateLeft() {
  return (
    <div className="flex-1 flex flex-col justify-center min-h-0 max-w-lg">
      <h2 className="text-[34px] xl:text-[42px] leading-[1.05] font-bold text-white flex-shrink-0">
        Power your business
        <br />
        with <span className="text-orange-500">Blip Money</span>
      </h2>
      <p className="text-white/50 mt-4 text-[14px] leading-relaxed flex-shrink-0">
        Accept payments, manage funds, and grow your business with ease.
      </p>

      <div className="grid grid-cols-1 gap-3 mt-7 flex-shrink-0">
        <Feature
          icon={<Zap className="w-4 h-4 text-orange-400" />}
          color="bg-orange-500/15"
          title="Fast Settlements"
          subtitle="Instant transfers, low fees"
        />
        <Feature
          icon={<Shield className="w-4 h-4 text-emerald-400" />}
          color="bg-emerald-500/15"
          title="Bank-grade Security"
          subtitle="Encrypted & secure infrastructure"
        />
        <Feature
          icon={<TrendingUp className="w-4 h-4 text-violet-400" />}
          color="bg-violet-500/15"
          title="Growth Rewards"
          subtitle="Earn more as you grow"
        />
      </div>

      <div className="grid grid-cols-3 gap-3 mt-7 flex-shrink-0">
        <StatCard value="$2.4B+" label="Volume settled" />
        <StatCard value="100K+" label="Merchants" />
        <StatCard value="0.8s" label="Avg settle" highlight />
      </div>

      <div className="mt-6 flex items-center gap-3 text-white/60 text-[12px] flex-shrink-0">
        <div className="flex -space-x-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 ring-2 ring-[#070708]" />
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-400 to-violet-600 ring-2 ring-[#070708]" />
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 ring-2 ring-[#070708]" />
        </div>
        <span>
          Trusted by <span className="text-white font-semibold">100K+ merchants</span> across the globe
        </span>
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  highlight = false,
}: {
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        highlight
          ? "bg-orange-500/10 border-orange-500/25"
          : "bg-white/[0.03] border-white/[0.08]"
      }`}
    >
      <div
        className={`text-[20px] font-bold leading-tight ${
          highlight ? "text-orange-400" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-white/50 mt-0.5 leading-tight">{label}</div>
    </div>
  );
}

/* ───────────────────────── small building blocks ───────────────────────── */

function Feature({
  icon,
  color,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <div className="text-[13px] font-semibold text-white leading-tight">{title}</div>
        <div className="text-[11px] text-white/50 leading-tight mt-0.5">{subtitle}</div>
      </div>
    </div>
  );
}

/* ───────────────────────── form primitives ───────────────────────── */

function Label({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-white/75 font-medium">
      {icon}
      {children}
    </span>
  );
}

function FieldEmail({
  label,
  value,
  placeholder,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1">
        <Label icon={<MailIcon />}>{label}</Label>
      </div>
      <input
        type="email"
        value={value}
        maxLength={254}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
        placeholder={placeholder}
        className="w-full bg-white/[0.04] rounded-lg px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/25 border border-white/8 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition-all"
      />
    </div>
  );
}

function FieldText({
  label,
  value,
  placeholder,
  maxLength,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
}) {
  return (
    <div>
      <div className="mb-1">
        <Label>{label}</Label>
      </div>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
        placeholder={placeholder}
        className="w-full bg-white/[0.04] rounded-lg px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/25 border border-white/8 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition-all"
      />
    </div>
  );
}

function FieldPassword({
  label,
  value,
  show,
  setShow,
  placeholder,
  onChange,
  onEnter,
  trailingLabel,
}: {
  label: string;
  value: string;
  show: boolean;
  setShow: (v: boolean) => void;
  placeholder: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  trailingLabel?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label icon={<LockIcon />}>{label}</Label>
        {trailingLabel}
      </div>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          maxLength={100}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onEnter ? (e) => e.key === "Enter" && onEnter() : undefined}
          placeholder={placeholder}
          className="w-full bg-white/[0.04] rounded-lg px-3.5 py-2.5 pr-10 text-sm text-white outline-none placeholder:text-white/25 border border-white/8 focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/30 transition-all"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white transition-colors"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function PwdCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={`flex items-center gap-1.5 text-[12px] transition-colors ${
        ok ? "text-emerald-400" : "text-white/40"
      }`}
    >
      <Check className={`w-3.5 h-3.5 ${ok ? "opacity-100" : "opacity-50"}`} />
      <span>{label}</span>
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  loading,
  loadingLabel,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  loadingLabel: string;
  label: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={disabled}
      className="w-full py-2.5 rounded-lg text-[14px] font-bold bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white shadow-[0_8px_24px_-8px_rgba(255,122,26,0.6)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {loading ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        <>
          {label}
          <ArrowRight className="w-4 h-4" />
        </>
      )}
    </motion.button>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-px bg-white/8" />
      <span className="text-[11px] text-white/35 tracking-wider">OR</span>
      <div className="flex-1 h-px bg-white/8" />
    </div>
  );
}

function GoogleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full py-2.5 rounded-lg text-[13px] font-medium bg-white/[0.04] hover:bg-white/[0.07] border border-white/10 text-white transition-all flex items-center justify-center gap-2"
    >
      <GoogleIcon />
      Continue with Google
    </button>
  );
}

/* ───────────────────────── inline icons ───────────────────────── */

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.96h5.6c-.24 1.4-.96 2.6-2.04 3.4v2.84h3.28c1.92-1.76 3.04-4.36 3.04-7.44 0-.72-.08-1.44-.2-2.12H12z"
      />
      <path
        fill="#4285F4"
        d="M12 22c2.76 0 5.08-.92 6.76-2.48l-3.28-2.84c-.92.6-2.08.96-3.48.96-2.68 0-4.96-1.8-5.76-4.24H2.84v2.92C4.52 19.6 7.96 22 12 22z"
      />
      <path
        fill="#FBBC05"
        d="M6.24 13.4c-.2-.6-.32-1.24-.32-1.92s.12-1.32.32-1.92V6.64H2.84C2.32 7.92 2 9.32 2 10.84s.32 2.92.84 4.2l3.4-2.92z"
      />
      <path
        fill="#34A853"
        d="M12 5.68c1.52 0 2.88.52 3.96 1.56l2.96-2.96C17.08 2.6 14.76 1.68 12 1.68c-4.04 0-7.48 2.4-9.16 5.96l3.4 2.92c.8-2.44 3.08-4.24 5.76-4.24z"
      />
    </svg>
  );
}
