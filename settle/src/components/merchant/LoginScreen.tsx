"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Eye, EyeOff, Mail, Lock } from "lucide-react";
import Link from "next/link";
import { MerchantWelcomePage } from "./MerchantWelcomePage";
import AuthPageLayout from "@/components/auth/AuthPageLayout";

interface LoginScreenProps {
  authTab: 'signin' | 'create';
  setAuthTab: (tab: 'signin' | 'create') => void;
  loginForm: { email: string; password: string };
  setLoginForm: React.Dispatch<React.SetStateAction<{ email: string; password: string }>>;
  registerForm: { email: string; password: string; confirmPassword: string; businessName: string };
  setRegisterForm: React.Dispatch<React.SetStateAction<{ email: string; password: string; confirmPassword: string; businessName: string }>>;
  loginError: string;
  setLoginError: (err: string) => void;
  isLoggingIn: boolean;
  isRegistering: boolean;
  isAuthenticating: boolean;
  onLogin: () => void;
  onRegister: () => void;
  onResendVerification?: () => void;
  isResendingVerification?: boolean;
  /** When true, skips the welcome page and goes straight to the login form.
   *  Used by the /merchant/login route. */
  skipWelcome?: boolean;
}

export function LoginScreen({
  authTab, setAuthTab,
  loginForm, setLoginForm,
  registerForm, setRegisterForm,
  loginError, setLoginError,
  isLoggingIn, isRegistering, isAuthenticating,
  onLogin, onRegister, onResendVerification, isResendingVerification,
  skipWelcome = false,
}: LoginScreenProps) {
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  // When skipWelcome is true, the welcome page is bypassed (used by /merchant/login route).
  // Setter unused — navigation to the form happens via /merchant/login URL, not state toggle.
  const [showWelcome] = useState(!skipWelcome);

  if (showWelcome) {
    return (
      <MerchantWelcomePage
        onGetStarted={() => {
          // Navigate to /merchant/login?tab=register for a clean URL
          if (typeof window !== 'undefined') {
            window.location.href = '/merchant/login?tab=register';
          }
        }}
        onSignIn={() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/merchant/login?tab=signin';
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <AuthPageLayout
        variant="merchant"
        badge="Merchant Portal"
        heading={authTab === 'signin' ? 'Merchant Sign In' : 'Create Account'}
        description={authTab === 'signin'
          ? 'Access your merchant dashboard and manage your business'
          : 'Start trading on Blip Money'}
      >
        {/* Error states */}
        {loginError && loginError === 'EMAIL_NOT_VERIFIED' ? (
          <div className="mb-4 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 space-y-3">
            <p className="text-sm text-amber-400 font-medium">Email not verified</p>
            <p className="text-xs text-foreground/50">Check your inbox for a verification link.</p>
            {onResendVerification && (
              <button
                onClick={onResendVerification}
                disabled={isResendingVerification}
                className="w-full py-2 rounded-lg text-xs font-medium bg-amber-500/15 border border-amber-500/25 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
              >
                {isResendingVerification ? 'Sending...' : 'Resend Verification Email'}
              </button>
            )}
          </div>
        ) : loginError ? (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
            {loginError}
          </div>
        ) : null}

        {isAuthenticating && (
          <div className="mb-4 bg-foreground/5 border border-foreground/6 rounded-xl p-3 text-sm text-foreground/70 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Authenticating with wallet...
          </div>
        )}

        {/* ─── SIGN IN FORM ─── */}
        {authTab === 'signin' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-foreground/50 font-medium mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Email Address
              </label>
              <input
                type="email"
                value={loginForm.email}
                onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="merchant@email.com"
                className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-foreground/25 border border-foreground/[0.06] focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Password
                </label>
                <Link href="/merchant/forgot-password" className="text-[11px] text-foreground/40 hover:text-primary transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showLoginPassword ? "text" : "password"}
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="••••••••••••"
                  className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3.5 pr-11 text-sm text-foreground outline-none placeholder:text-foreground/25 border border-foreground/[0.06] focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
                  onKeyDown={(e) => e.key === "Enter" && onLogin()}
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword(!showLoginPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground transition-colors"
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onLogin}
              disabled={isLoggingIn || !loginForm.email || !loginForm.password}
              className="w-full py-3.5 rounded-xl text-sm font-bold bg-foreground text-background hover:bg-foreground/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoggingIn ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</>
              ) : (
                'Sign In as Merchant'
              )}
            </motion.button>

            <p className="text-center text-[12px] text-foreground/30">
              Don&apos;t have an account?{' '}
              <button onClick={() => { setAuthTab('create'); setLoginError(''); }} className="text-primary font-medium hover:underline">
                Register as Merchant
              </button>
            </p>
          </div>
        )}

        {/* ─── CREATE ACCOUNT FORM ─── */}
        {authTab === 'create' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-foreground/50 font-medium mb-1.5 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Email Address
              </label>
              <input
                type="email"
                value={registerForm.email}
                onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                placeholder="your@email.com"
                className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-foreground/25 border border-foreground/[0.06] focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>

            <div>
              <label className="text-xs text-foreground/50 font-medium mb-1.5 block">Business Name</label>
              <input
                type="text"
                value={registerForm.businessName}
                onChange={(e) => setRegisterForm(prev => ({ ...prev, businessName: e.target.value }))}
                placeholder="Your Business"
                className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-foreground/25 border border-foreground/[0.06] focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
              />
            </div>

            <div>
              <label className="text-xs text-foreground/50 font-medium mb-1.5 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Password
              </label>
              <div className="relative">
                <input
                  type={showRegisterPassword ? "text" : "password"}
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Min. 6 characters"
                  className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3.5 pr-11 text-sm text-foreground outline-none placeholder:text-foreground/25 border border-foreground/[0.06] focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground transition-colors"
                >
                  {showRegisterPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-foreground/50 font-medium mb-1.5 block">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={registerForm.confirmPassword}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="••••••••••••"
                  className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3.5 pr-11 text-sm text-foreground outline-none placeholder:text-foreground/25 border border-foreground/[0.06] focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all"
                  onKeyDown={(e) => e.key === "Enter" && onRegister()}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/30 hover:text-foreground transition-colors"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onRegister}
              disabled={isRegistering || !registerForm.email || !registerForm.password || !registerForm.confirmPassword || !registerForm.businessName?.trim()}
              className="w-full py-3.5 rounded-xl text-sm font-bold bg-foreground text-background hover:bg-foreground/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isRegistering ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating Account...</>
              ) : (
                'Create Account'
              )}
            </motion.button>

            <p className="text-center text-[12px] text-foreground/30">
              Already have an account?{' '}
              <button onClick={() => { setAuthTab('signin'); setLoginError(''); }} className="text-primary font-medium hover:underline">
                Sign In
              </button>
            </p>
          </div>
        )}
      </AuthPageLayout>
    </div>
  );
}
