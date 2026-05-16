"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Loader2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { UserWelcomePage } from "./UserWelcomePage";
import {
  validateUserUsername,
  validateUserPassword,
  validateUserPin,
  USER_PIN_LENGTH,
} from "@/lib/validation/userAuth";

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
  const [touched, setTouched] = useState<{ username?: boolean; password?: boolean }>({});
  const submit = () => authMode === 'login' ? handleUserLogin() : handleUserRegister();

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

  const isDisabled =
    isLoggingIn ||
    !loginForm.username ||
    !loginForm.password ||
    (authMode === 'register' && (
      !!validateUserUsername(loginForm.username) ||
      !!validateUserPin(loginForm.password)
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
              <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">
                Username
              </label>
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

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary">
                  {authMode === 'register' ? `Set a ${USER_PIN_LENGTH}-digit PIN` : 'Password'}
                </label>
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
