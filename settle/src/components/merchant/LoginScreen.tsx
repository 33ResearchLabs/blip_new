"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Loader2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";

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
}

export function LoginScreen({
  authTab, setAuthTab,
  loginForm, setLoginForm,
  registerForm, setRegisterForm,
  loginError, setLoginError,
  isLoggingIn, isRegistering, isAuthenticating,
  onLogin, onRegister, onResendVerification, isResendingVerification,
}: LoginScreenProps) {
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);

  // Welcome splash screen
  if (showWelcome) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4 relative overflow-hidden">
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/[0.04] rounded-full blur-[150px]" />
          <div className="absolute bottom-1/4 right-1/3 w-[400px] h-[400px] bg-primary/[0.02] rounded-full blur-[120px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-sm relative z-10 flex flex-col items-center text-center"
        >
          {/* Logo */}
          <div className="w-20 h-20 rounded-3xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
            <Zap className="w-10 h-10 text-primary fill-primary" />
          </div>

          {/* Title */}
          <span className="text-[28px] leading-none mb-2">
            <span className="font-bold text-foreground">Blip</span>{' '}
            <span className="italic text-foreground/90">money</span>
          </span>
          <h1 className="text-2xl font-bold mt-4 mb-2 text-foreground">Merchant Portal</h1>
          <p className="text-sm text-foreground/40 max-w-[280px]">
            Accept payments, manage orders, and grow your P2P trading business
          </p>

          {/* Feature highlights */}
          <div className="mt-8 w-full space-y-3">
            {[
              { icon: '💰', label: 'Accept crypto payments instantly' },
              { icon: '📊', label: 'Real-time order management' },
              { icon: '🔒', label: 'Secure escrow protection' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 px-4 py-3 bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl">
                <span className="text-lg">{item.icon}</span>
                <span className="text-sm text-foreground/60">{item.label}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowWelcome(false)}
            className="mt-8 w-full py-3.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            Get Started
          </motion.button>

          <p className="mt-4 text-[10px] text-foreground/20">
            Already have an account? <button onClick={() => setShowWelcome(false)} className="text-primary/60 hover:text-primary transition-colors">Sign In</button>
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/[0.03] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-foreground/[0.01] rounded-full blur-[200px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <Zap className="w-7 h-7 text-foreground fill-foreground" />
            <span className="text-[22px] leading-none">
              <span className="font-bold text-foreground">Blip</span>{' '}
              <span className="italic text-foreground/90">money</span>
            </span>
          </div>
          <h1 className="text-xl font-bold mb-2">Merchant Portal</h1>
          <p className="text-sm text-foreground/40">P2P trading, powered by crypto</p>
        </div>

        {/* Tabs */}
        <div className="flex mb-4 bg-foreground/[0.03] rounded-xl p-1">
          <button
            onClick={() => { setAuthTab('signin'); setLoginError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              authTab === 'signin'
                ? 'bg-primary text-white'
                : 'text-foreground/40 hover:text-foreground'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setAuthTab('create'); setLoginError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              authTab === 'create'
                ? 'bg-primary text-white'
                : 'text-foreground/40 hover:text-foreground'
            }`}
          >
            Create Account
          </button>
        </div>

        <div className="bg-foreground/[0.02] rounded-2xl border border-foreground/[0.04] p-6 space-y-4">
          {loginError && loginError === 'EMAIL_NOT_VERIFIED' ? (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 space-y-3">
              <p className="text-sm text-amber-400 font-medium">Email not verified</p>
              <p className="text-xs text-foreground/50">Please check your inbox for a verification link. Click it to activate your account.</p>
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
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
              {loginError}
            </div>
          ) : null}

          {isAuthenticating && (
            <div className="bg-foreground/5 border border-foreground/6 rounded-xl p-3 text-sm text-foreground/70 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Authenticating with wallet...
            </div>
          )}

          {/* Sign In Tab */}
          {authTab === 'signin' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-foreground/40 uppercase tracking-wide mb-2 block">Email</label>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="merchant@email.com"
                  className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="text-xs text-foreground/40 uppercase tracking-wide mb-2 block">Password</label>
                <div className="relative">
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    value={loginForm.password}
                    onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3 pr-11 text-sm text-foreground outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-primary/30"
                    onKeyDown={(e) => e.key === "Enter" && onLogin()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground transition-colors"
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onLogin}
                disabled={isLoggingIn || !loginForm.email || !loginForm.password}
                className="w-full py-3 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isLoggingIn ? "Signing in..." : "Sign In"}
              </motion.button>

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-foreground/40">
                  Connect wallet after sign in
                </p>
                <Link href="/merchant/forgot-password" className="text-[11px] text-foreground/50 hover:text-foreground transition-colors">
                  Forgot password?
                </Link>
              </div>
            </div>
          )}

          {/* Create Account Tab */}
          {authTab === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-foreground/40 uppercase tracking-wide mb-2 block">Email</label>
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="your@email.com"
                  className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="text-xs text-foreground/40 uppercase tracking-wide mb-2 block">Business Name</label>
                <input
                  type="text"
                  value={registerForm.businessName}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, businessName: e.target.value }))}
                  placeholder="Your Business"
                  className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3 text-sm text-foreground outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="text-xs text-foreground/40 uppercase tracking-wide mb-2 block">Password</label>
                <div className="relative">
                  <input
                    type={showRegisterPassword ? "text" : "password"}
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="Min. 6 characters"
                    className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3 pr-11 text-sm text-foreground outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-primary/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground transition-colors"
                  >
                    {showRegisterPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-foreground/40 uppercase tracking-wide mb-2 block">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={registerForm.confirmPassword}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full bg-foreground/[0.04] rounded-xl px-4 py-3 pr-11 text-sm text-foreground outline-none placeholder:text-foreground/30 focus:ring-1 focus:ring-primary/30"
                    onKeyDown={(e) => e.key === "Enter" && onRegister()}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onRegister}
                disabled={isRegistering || !registerForm.email || !registerForm.password || !registerForm.confirmPassword || !registerForm.businessName?.trim()}
                className="w-full py-3.5 rounded-xl text-sm font-bold bg-foreground/10 border border-foreground/10 text-foreground hover:bg-foreground/20 transition-all disabled:opacity-50"
              >
                {isRegistering ? "Creating Account..." : "Create Account"}
              </motion.button>

              <p className="text-[11px] text-foreground/40 text-center">
                After creating your account, you can connect your wallet to enable on-chain transactions
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center space-y-2">
          <p className="text-[10px] text-foreground/15 font-mono">Blip Money v1.0</p>
          <div className="flex items-center justify-center gap-3 text-[10px] text-foreground/20">
            <Link href="/" className="hover:text-foreground/40 transition-colors">Home</Link>
            <span className="text-foreground/10">·</span>
            <Link href="/merchant" className="hover:text-foreground/40 transition-colors">Merchant</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
