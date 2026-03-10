"use client";

import { motion } from "framer-motion";
import { Zap, Loader2 } from "lucide-react";
import Link from "next/link";

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
}

export function LandingPage({
  loginForm, setLoginForm, authMode, setAuthMode,
  handleUserLogin, handleUserRegister, isLoggingIn, loginError, setLoginError,
}: LandingPageProps) {
  const submit = () => authMode === 'login' ? handleUserLogin() : handleUserRegister();

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
          <h1 className="text-xl font-bold mb-2">Welcome</h1>
          <p className="text-sm text-gray-500">P2P trading, powered by crypto</p>
        </div>

        {/* Tabs */}
        <div className="flex mb-4 bg-white/[0.03] rounded-xl p-1">
          <button
            onClick={() => { setAuthMode('login'); setLoginError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              authMode === 'login' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setAuthMode('register'); setLoginError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              authMode === 'register' ? 'bg-white text-black' : 'text-gray-400 hover:text-white'
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

          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Username</label>
            <input
              type="text"
              value={loginForm.username}
              onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
              placeholder={authMode === 'register' ? 'Choose a username' : 'Your username'}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">Password</label>
            <input
              type="password"
              value={loginForm.password}
              onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
              placeholder={authMode === 'register' ? 'Min. 6 characters' : '••••••••'}
              className="w-full bg-white/[0.04] rounded-xl px-4 py-3 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
              onKeyDown={e => e.key === 'Enter' && submit()}
            />
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={submit}
            disabled={isLoggingIn || !loginForm.username || !loginForm.password}
            className={`w-full py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 ${
              authMode === 'login'
                ? 'bg-white text-black hover:bg-white/90'
                : 'bg-white/10 border border-white/10 text-white hover:bg-white/20'
            }`}
          >
            {isLoggingIn
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />{authMode === 'login' ? 'Signing in...' : 'Creating...'}</span>
              : authMode === 'login' ? 'Sign In' : 'Create Account'}
          </motion.button>

          <p className="text-[11px] text-gray-500 text-center">
            Connect your wallet after signing in to enable on-chain trading
          </p>
        </div>

        <div className="mt-8 text-center space-y-2">
          <p className="text-[10px] text-white/15 font-mono">Blip Money v1.0</p>
          <div className="flex items-center justify-center gap-3 text-[10px] text-white/20">
            <Link href="/merchant" className="hover:text-white/40 transition-colors">Merchant Portal</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
