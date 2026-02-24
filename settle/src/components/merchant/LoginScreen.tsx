"use client";

import { motion } from "framer-motion";
import { Zap, Loader2 } from "lucide-react";
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
}

export function LoginScreen({
  authTab, setAuthTab,
  loginForm, setLoginForm,
  registerForm, setRegisterForm,
  loginError, setLoginError,
  isLoggingIn, isRegistering, isAuthenticating,
  onLogin, onRegister,
}: LoginScreenProps) {
  return (
    <div className="min-h-screen bg-[#060606] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-orange-500/[0.03] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-white/[0.01] rounded-full blur-[200px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <Zap className="w-7 h-7 text-white fill-white" />
            <span className="text-[22px] leading-none">
              <span className="font-bold text-white">Blip</span>{' '}
              <span className="italic text-white/90">money</span>
            </span>
          </div>
          <h1 className="text-xl font-bold mb-2">Merchant Portal</h1>
          <p className="text-sm text-gray-500">P2P trading, powered by crypto</p>
        </div>

        {/* Tabs */}
        <div className="flex mb-4 bg-white/[0.03] rounded-xl p-1">
          <button
            onClick={() => { setAuthTab('signin'); setLoginError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              authTab === 'signin'
                ? 'bg-white text-black'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setAuthTab('create'); setLoginError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              authTab === 'create'
                ? 'bg-white text-black'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Create Account
          </button>
        </div>

        <div className="bg-white/[0.02] rounded-2xl border border-white/[0.04] p-6 space-y-4">
          {loginError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
              {loginError}
            </div>
          )}

          {isAuthenticating && (
            <div className="bg-white/5 border border-white/6 rounded-xl p-3 text-sm text-white/70 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Authenticating with wallet...
            </div>
          )}

          {/* Sign In Tab */}
          {authTab === 'signin' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Email</label>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="merchant@email.com"
                  className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Password</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  onKeyDown={(e) => e.key === "Enter" && onLogin()}
                />
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onLogin}
                disabled={isLoggingIn || !loginForm.email || !loginForm.password}
                className="w-full py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {isLoggingIn ? "Signing in..." : "Sign In"}
              </motion.button>

              <p className="text-[11px] text-gray-500 text-center">
                You can connect your wallet after signing in to enable on-chain transactions
              </p>
            </div>
          )}

          {/* Create Account Tab */}
          {authTab === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Email</label>
                <input
                  type="email"
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="your@email.com"
                  className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Business Name (Optional)</label>
                <input
                  type="text"
                  value={registerForm.businessName}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, businessName: e.target.value }))}
                  placeholder="Your Business"
                  className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Password</label>
                <input
                  type="password"
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Min. 6 characters"
                  className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Confirm Password</label>
                <input
                  type="password"
                  value={registerForm.confirmPassword}
                  onChange={(e) => setRegisterForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                  onKeyDown={(e) => e.key === "Enter" && onRegister()}
                />
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onRegister}
                disabled={isRegistering || !registerForm.email || !registerForm.password || !registerForm.confirmPassword}
                className="w-full py-3.5 rounded-xl text-sm font-bold bg-white/10 border border-white/10 text-white hover:bg-white/20 transition-all disabled:opacity-50"
              >
                {isRegistering ? "Creating Account..." : "Create Account"}
              </motion.button>

              <p className="text-[11px] text-gray-500 text-center">
                After creating your account, you can connect your wallet to enable on-chain transactions
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center space-y-2">
          <p className="text-[10px] text-white/15 font-mono">Blip Money v1.0</p>
          <div className="flex items-center justify-center gap-3 text-[10px] text-white/20">
            <Link href="/" className="hover:text-white/40 transition-colors">Home</Link>
            <span className="text-white/10">·</span>
            <Link href="/merchant" className="hover:text-white/40 transition-colors">Merchant</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
