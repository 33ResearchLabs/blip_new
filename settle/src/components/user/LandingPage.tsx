"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Loader2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { UserWelcomePage } from "./UserWelcomePage";

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
  const submit = () => authMode === 'login' ? handleUserLogin() : handleUserRegister();

  const isDisabled = isLoggingIn || !loginForm.username || !loginForm.password;

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
                placeholder={authMode === 'register' ? 'Choose a username' : 'Your username'}
                autoCapitalize="none"
                autoCorrect="off"
                onKeyDown={e => e.key === 'Enter' && submit()}
                className="w-full rounded-xl px-4 py-3 text-sm font-medium outline-none bg-surface-hover border border-border-subtle text-text-primary placeholder:text-text-tertiary"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold tracking-[0.2em] uppercase text-text-tertiary mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={loginForm.password}
                  onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                  placeholder={authMode === 'register' ? 'Min. 6 characters' : '••••••••'}
                  onKeyDown={e => e.key === 'Enter' && submit()}
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
