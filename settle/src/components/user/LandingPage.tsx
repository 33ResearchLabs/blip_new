"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Loader2, Eye, EyeOff } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
  const submit = () => authMode === 'login' ? handleUserLogin() : handleUserRegister();

  return (
    <div className="min-h-screen bg-white text-black flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-orange-500/[0.05] rounded-full blur-[150px]" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-black/[0.02] rounded-full blur-[200px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <Zap className="w-7 h-7 text-black fill-black" />
            <span className="text-[22px] leading-none">
              <span className="font-bold text-black">Blip</span>{' '}
              <span className="italic text-black/90">money</span>
            </span>
          </div>
          <h1 className="text-xl font-bold mb-2">Welcome</h1>
          <p className="text-sm text-gray-500">P2P trading, powered by crypto</p>
        </div>

        {/* Tabs */}
        <div className="flex mb-4 bg-black/[0.04] rounded-xl p-1">
          <button
            onClick={() => { setAuthMode('login'); setLoginError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              authMode === 'login' ? 'bg-white text-black' : 'text-gray-400 hover:text-black'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setAuthMode('register'); setLoginError(''); }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              authMode === 'register' ? 'bg-white text-black' : 'text-gray-400 hover:text-black'
            }`}
          >
            Create Account
          </button>
        </div>

        <div className="rounded-2xl p-6 space-y-4" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)', boxShadow: '0 8px 40px rgba(0,0,0,0.3)' }}>
          {loginError && (
            <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.15)', color: '#dc2626' }}>
              {loginError}
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: 8 }}>Username</label>
            <input
              type="text"
              value={loginForm.username}
              onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
              placeholder={authMode === 'register' ? 'Choose a username' : 'Your username'}
              autoCapitalize="none"
              autoCorrect="off"
              onKeyDown={e => e.key === 'Enter' && submit()}
              style={{
                width: '100%', background: '#f4f4f4', border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 12, padding: '12px 16px', fontSize: 14, fontWeight: 500,
                color: '#000000', outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: 8 }}>Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={loginForm.password}
                onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                placeholder={authMode === 'register' ? 'Min. 6 characters' : '••••••••'}
                onKeyDown={e => e.key === 'Enter' && submit()}
                style={{
                  width: '100%', background: '#f4f4f4', border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 12, padding: '12px 44px 12px 16px', fontSize: 14, fontWeight: 500,
                  color: '#000000', outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                style={{ color: 'rgba(0,0,0,0.3)' }}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={submit}
            disabled={isLoggingIn || !loginForm.username || !loginForm.password}
            className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-colors"
            style={{
              background: (isLoggingIn || !loginForm.username || !loginForm.password) ? 'rgba(0,0,0,0.06)' : '#000000',
              color: (isLoggingIn || !loginForm.username || !loginForm.password) ? 'rgba(0,0,0,0.25)' : '#ffffff',
              letterSpacing: '-0.01em',
            }}
          >
            {isLoggingIn
              ? <><Loader2 className="w-4 h-4 animate-spin" />{authMode === 'login' ? 'Signing in...' : 'Creating...'}</>
              : authMode === 'login' ? 'Sign In' : 'Create Account'}
          </motion.button>

          <p className="text-center" style={{ fontSize: 11, color: 'rgba(0,0,0,0.7)' }}>
            Connect your wallet after signing in to enable on-chain trading
          </p>
        </div>

        <div className="mt-8 text-center space-y-2">
          <p className="text-[10px] text-black/50 font-mono">Blip Money v1.0</p>
          <div className="flex items-center justify-center gap-3 text-[10px] text-black/50">
            <Link href="/merchant" className="hover:text-black transition-colors">Merchant Portal</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
