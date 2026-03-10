'use client';

import { Loader2, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

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
  const submit = () => {
    setLoginError('');
    authMode === 'login' ? handleUserLogin() : handleUserRegister();
  };

  return (
    <div className="flex flex-col h-full w-full items-center justify-center relative"
      style={{ background: '#080810' }}>

      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute rounded-full" style={{
          top: '-15%', left: '-10%', width: '65%', height: '55%',
          background: 'radial-gradient(ellipse, rgba(124,58,237,0.13) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
        <div className="absolute rounded-full" style={{
          bottom: '-20%', right: '-10%', width: '60%', height: '55%',
          background: 'radial-gradient(ellipse, rgba(16,185,129,0.09) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
        className="relative z-10 w-full px-6"
        style={{ maxWidth: 400 }}
      >
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, #059669, #7c3aed)', boxShadow: '0 0 32px rgba(124,58,237,0.35)' }}>
            <Zap size={26} className="fill-white text-white" />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff', marginBottom: 4 }}>Blip Money</h1>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', fontWeight: 500 }}>P2P Settlement Network</p>
        </div>

        {/* Toggle */}
        <div className="flex rounded-[14px] p-1 mb-6"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {(['login', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setAuthMode(m); setLoginError(''); }}
              className="flex-1 py-2 rounded-[10px] text-[13px] font-black uppercase tracking-wider transition-all"
              style={{
                background: authMode === m ? 'rgba(255,255,255,0.09)' : 'transparent',
                color: authMode === m ? '#fff' : 'rgba(255,255,255,0.3)',
                border: 'none', cursor: 'pointer',
              }}>
              {m === 'login' ? 'Sign In' : 'Register'}
            </button>
          ))}
        </div>

        {/* Error */}
        {loginError && (
          <div className="rounded-[14px] px-4 py-3 mb-4 text-sm"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
            {loginError}
          </div>
        )}

        {/* Fields */}
        <div className="flex flex-col gap-3 mb-4">
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Username</label>
            <input
              type="text"
              value={loginForm.username}
              onChange={e => setLoginForm({ ...loginForm, username: e.target.value })}
              placeholder={authMode === 'register' ? 'Choose a username' : 'Your username'}
              autoCapitalize="none"
              autoCorrect="off"
              onKeyDown={e => e.key === 'Enter' && submit()}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14, padding: '13px 16px', color: '#fff', fontSize: 15, outline: 'none',
                boxSizing: 'border-box', fontFamily: 'inherit',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 6 }}>Password</label>
            <input
              type="password"
              value={loginForm.password}
              onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
              placeholder={authMode === 'register' ? 'Min 6 characters' : 'Your password'}
              onKeyDown={e => e.key === 'Enter' && submit()}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14, padding: '13px 16px', color: '#fff', fontSize: 15, outline: 'none',
                boxSizing: 'border-box', fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        {/* Submit */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={submit}
          disabled={isLoggingIn}
          className="w-full flex items-center justify-center gap-2"
          style={{
            height: 54, borderRadius: 16, fontSize: 15, fontWeight: 900, border: 'none',
            background: isLoggingIn ? 'rgba(255,255,255,0.08)' : '#fff',
            color: isLoggingIn ? 'rgba(255,255,255,0.3)' : '#090909',
            cursor: isLoggingIn ? 'not-allowed' : 'pointer',
          }}>
          {isLoggingIn
            ? <Loader2 size={18} className="animate-spin" />
            : authMode === 'login' ? 'Sign In' : 'Create Account'}
        </motion.button>

        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', textAlign: 'center', marginTop: 20, lineHeight: 1.5 }}>
          Connect your Solana wallet after signing in to enable trading
        </p>
      </motion.div>
    </div>
  );
}
