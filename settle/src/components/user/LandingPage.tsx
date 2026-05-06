"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Loader2, Eye, EyeOff, Mail } from "lucide-react";
import Link from "next/link";
import { UserWelcomePage } from "./UserWelcomePage";
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

  // Welcome page — full user landing
  if (showWelcome) {
    return (
      <UserWelcomePage
        onGetStarted={() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/login?tab=register';
          }
        }}
        onSignIn={() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/login?tab=signin';
          }
        }}
      />
    );
  }

  return (
    <div className="flex-1 w-full max-w-[440px] mx-auto flex flex-col bg-surface-base text-text-primary relative overflow-hidden">
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-warning/[0.05] rounded-full blur-[120px]" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 relative z-10">
        <div className="w-full">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2.5 mb-4">
              <Zap className="w-7 h-7 text-text-primary fill-current" />
              <span className="text-[22px] leading-none">
                <span className="font-bold text-text-primary">Blip</span>{' '}
                <span className="italic text-text-primary/90">money</span>
              </span>
            </div>
            <h1 className="text-xl font-bold mb-2 text-text-primary">Welcome</h1>
            <p className="text-sm text-text-secondary">P2P trading, powered by crypto</p>
          </div>

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

          <div className="rounded-2xl p-6 space-y-4 bg-surface-card border border-border-subtle shadow-2xl">
            {loginError && (
              <div className="rounded-xl p-3 text-sm bg-error-dim border border-error-border text-error">
                {loginError}
              </div>
            )}

            <div>
              <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">Username</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
                onBlur={e => {
                  setLoginForm({ ...loginForm, username: e.target.value.trim() });
                  setTouched(t => ({ ...t, username: true }));
                }}
                placeholder={authMode === 'register' ? '3–20 chars · letters, numbers, _' : 'Your username'}
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={20}
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
                : authMode === 'login' ? 'Sign In' : 'Create Account'}
            </motion.button>

            <p className="text-center text-[11px] text-text-secondary">
              Connect your wallet after signing in to enable on-chain trading
            </p>
          </div>

          <div className="mt-8 text-center space-y-2">
            <p className="text-[10px] text-text-tertiary font-mono">Blip Money v1.0</p>
            <div className="flex items-center justify-center gap-3 text-[10px] text-text-tertiary">
              <Link href="/merchant" className="hover:text-text-primary transition-colors">Merchant Portal</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
