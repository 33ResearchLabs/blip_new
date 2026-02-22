'use client';

import { useState } from 'react';
import { Loader2, Lock, Key } from 'lucide-react';

interface UnlockWalletPromptProps {
  onUnlock: (password: string) => Promise<boolean>;
  onForgotPassword?: () => void;
  onCreateNew?: () => void;
  onClose?: () => void;
}

export function UnlockWalletPrompt({ onUnlock, onForgotPassword, onCreateNew, onClose }: UnlockWalletPromptProps) {
  const [password, setPassword] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState('');

  const handleUnlock = async () => {
    if (!password) return;
    setError('');
    setIsUnlocking(true);

    try {
      const success = await onUnlock(password);
      if (!success) {
        setError('Wrong password');
        setPassword('');
      }
    } catch {
      setError('Failed to decrypt wallet');
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleUnlock();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-orange-500" />
          <h2 className="text-lg font-bold text-white font-mono">Unlock Wallet</h2>
        </div>

        {error && (
          <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
            {error}
          </div>
        )}

        <div>
          <label className="text-[10px] text-white/40 font-mono uppercase mb-1 block">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your wallet password"
            autoFocus
            className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg
                       text-sm text-white font-mono placeholder:text-white/20
                       focus:outline-none focus:border-orange-500/50"
          />
        </div>

        <button
          onClick={handleUnlock}
          disabled={isUnlocking || !password}
          className="w-full py-3 rounded-lg bg-orange-500 text-black font-bold font-mono
                     hover:bg-orange-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isUnlocking ? <><Loader2 className="w-4 h-4 animate-spin" /> Unlocking...</> : 'Unlock'}
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onForgotPassword && (
              <button
                onClick={onForgotPassword}
                className="text-[10px] text-orange-500/70 hover:text-orange-500 font-mono transition-colors flex items-center gap-1"
              >
                <Key className="w-3 h-3" />
                Import key
              </button>
            )}
            {onCreateNew && (
              <button
                onClick={onCreateNew}
                className="text-[10px] text-white/30 hover:text-white/50 font-mono transition-colors flex items-center gap-1"
              >
                <Lock className="w-3 h-3" />
                New wallet
              </button>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-[10px] text-white/30 hover:text-white/50 font-mono transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
