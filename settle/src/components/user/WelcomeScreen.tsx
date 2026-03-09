"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, Loader2, Eye, EyeOff } from "lucide-react";
import AmbientGlow from "./shared/AmbientGlow";

interface WelcomeScreenProps {
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string) => Promise<void>;
  isLoggingIn: boolean;
  loginError: string;
  setLoginError: (err: string) => void;
}

export default function WelcomeScreen({ onLogin, onRegister, isLoggingIn, loginError, setLoginError }: WelcomeScreenProps) {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async () => {
    if (authMode === 'login') {
      await onLogin(username, password);
    } else {
      await onRegister(username, password);
    }
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-center relative overflow-hidden" style={{ background: '#060606' }}>
      <AmbientGlow />

      <div className="relative z-10 w-full max-w-sm px-6 flex flex-col items-center">
        {/* Logo */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 15, stiffness: 200 }}
          className="w-16 h-16 rounded-[22px] flex items-center justify-center mb-6"
          style={{
            background: 'linear-gradient(135deg, #059669, #7c3aed)',
            boxShadow: '0 0 40px rgba(16,185,129,0.25)',
          }}
        >
          <Zap size={28} className="fill-white text-white" />
        </motion.div>

        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-[28px] font-black tracking-tight text-white mb-1 text-center"
        >
          Blip Money
        </motion.h1>
        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
          style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', fontWeight: 600, marginBottom: 32, letterSpacing: '0.08em' }}
        >
          P2P SETTLEMENT NETWORK
        </motion.p>

        {loginError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full rounded-2xl p-3 text-sm text-red-400 mb-4"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}
          >
            {loginError}
          </motion.div>
        )}

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="w-full flex rounded-2xl p-1 mb-5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          {(['login', 'register'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => { setAuthMode(mode); setLoginError(''); }}
              className="flex-1 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-wider transition-all"
              style={authMode === mode
                ? { background: 'rgba(255,255,255,0.06)', color: '#fff' }
                : { color: 'rgba(255,255,255,0.25)' }
              }
            >
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="w-full space-y-3"
        >
          <div>
            <label className="text-[8px] font-black uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.2)' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={authMode === 'register' ? 'Choose a username' : 'Enter username'}
              className="w-full rounded-2xl px-4 py-3.5 text-[15px] text-white outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          <div>
            <label className="text-[8px] font-black uppercase tracking-widest mb-2 block" style={{ color: 'rgba(255,255,255,0.2)' }}>
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={authMode === 'register' ? 'Min 6 characters' : 'Enter password'}
                className="w-full rounded-2xl px-4 py-3.5 text-[15px] text-white outline-none pr-12 transition-all"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: 'rgba(255,255,255,0.2)' }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSubmit}
            disabled={isLoggingIn || !username || !password}
            className="w-full py-4 rounded-2xl text-[15px] font-black flex items-center justify-center gap-2 transition-all disabled:opacity-30"
            style={{
              background: username && password ? '#fff' : 'rgba(255,255,255,0.04)',
              color: username && password ? '#000' : 'rgba(255,255,255,0.2)',
              border: username && password ? 'none' : '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {isLoggingIn ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : authMode === 'login' ? (
              "Sign In"
            ) : (
              "Create Account"
            )}
          </motion.button>

          <p className="text-center mt-3" style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', fontWeight: 600 }}>
            Connect your wallet after signing in
          </p>
        </motion.div>
      </div>
    </div>
  );
}
