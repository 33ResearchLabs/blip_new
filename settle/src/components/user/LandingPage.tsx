"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Loader2, Eye, EyeOff, Mail, ChevronLeft, User, Store, ArrowRight } from "lucide-react";
import Link from "next/link";
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
  /** When true, skips the welcome page and goes straight to the login form.
   *  Used by the /login route. */
  skipWelcome?: boolean;
}

export function LandingPage({
  loginForm, setLoginForm, authMode, setAuthMode,
  handleUserLogin, handleUserRegister, isLoggingIn, loginError, setLoginError,
  skipWelcome = false,
}: LandingPageProps) {
  const [showPassword, setShowPassword] = useState(false);
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

  const isDisabled =
    isLoggingIn ||
    !loginForm.username ||
    !loginForm.password ||
    (authMode === 'register' && (
      !loginForm.email ||
      !!validateUserUsername(loginForm.username) ||
      !!validateUserEmail(loginForm.email) ||
      !!validateUserPassword(loginForm.password)
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

        <div className="relative z-10 w-full max-w-[720px] grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            {
              href: "/login?tab=signin",
              label: "User",
              sub: "Buy & sell crypto",
              Icon: User,
              glow: "rgba(168,247,98,0.55)",
              delay: 0.35,
            },
            {
              href: "/merchant/login?tab=signin",
              label: "Merchant",
              sub: "Run a P2P desk",
              Icon: Store,
              glow: "rgba(120,119,198,0.55)",
              delay: 0.45,
            },
          ].map(({ href, label, sub, Icon, glow, delay }) => (
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
          className="relative z-10 mt-8 sm:mt-14 text-[10px] font-mono tracking-[0.2em] text-white/40 flex items-center gap-3"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
          ESCROW-PROTECTED · ON-CHAIN SETTLEMENT
        </motion.p>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full mx-auto flex flex-col bg-surface-base text-text-primary relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] md:w-[700px] h-[300px] md:h-[500px] bg-warning/[0.05] rounded-full blur-[120px]" />
      </div>

      <div className="flex min-h-dvh flex-col items-center px-5 py-5 relative z-10">
        <div className="w-full max-w-[440px] flex-1 flex flex-col self-stretch mx-auto">
          {/* Top bar: home link + role switch — proper visible buttons */}
          <div className="flex items-center justify-between mb-3 gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-text-primary bg-surface-card hover:bg-surface-hover border border-border-medium hover:border-text-tertiary transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Home
            </Link>
            <Link
              href="/merchant/login"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-text-primary bg-surface-card hover:bg-surface-hover border border-border-medium hover:border-text-tertiary transition-all"
            >
              Are you a merchant?
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="flex-1 flex flex-col pt-[50px] pb-2">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mb-10"
          >
            {/* Big number-style hero, like the "0.00 USDT" on home */}
            <div className="text-center mb-1">
              <p className="text-[10px] font-semibold tracking-[0.3em] uppercase text-text-tertiary mb-2">
                {authMode === 'login' ? 'Welcome back' : 'Get started'}
              </p>
              <h1 className="text-[32px] font-bold text-text-primary tracking-[-0.03em] leading-[1.05]">
                {authMode === 'login' ? (
                  <>Login <span className="text-text-tertiary font-light">as</span> User</>
                ) : (
                  <>Create <span className="text-text-tertiary font-light">an</span> Account</>
                )}
              </h1>
            </div>
          </motion.div>

          {/* Tabs */}
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

          <div className="flex-1 rounded-2xl p-6 flex flex-col gap-4 bg-surface-card border border-border-subtle shadow-2xl">
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
                  usernameError ? 'border-error' : 'border-border-subtle'
                } text-text-primary placeholder:text-text-tertiary`}
              />
              {usernameError && (
                <p className="mt-1.5 text-[11px] text-error">{usernameError}</p>
              )}
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

            <p className="text-center text-[11px] text-text-secondary">
              Connect your wallet after signing in to enable on-chain trading
            </p>

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
          </div>
          </div>

        </div>
      </div>
    </div>
  );
}
