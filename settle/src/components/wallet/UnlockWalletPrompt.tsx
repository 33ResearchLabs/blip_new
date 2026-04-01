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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#111111' }}>
            <Lock className="w-4 h-4" style={{ color: '#fff' }} />
          </div>
          <h2 className="text-lg font-bold font-mono" style={{ color: '#000' }}>Unlock Wallet</h2>
        </div>

        {error && (
          <div className="p-2 rounded-lg text-xs font-mono" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.15)', color: '#dc2626' }}>
            {error}
          </div>
        )}

        <div>
          <label className="text-[10px] font-mono uppercase mb-1 block" style={{ color: 'rgba(0,0,0,0.4)', fontWeight: 700, letterSpacing: '0.2em' }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter your wallet password"
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg text-sm font-mono outline-none"
            style={{ background: '#f4f4f4', border: '1px solid rgba(0,0,0,0.08)', color: '#000' }}
          />
        </div>

        <button
          onClick={handleUnlock}
          disabled={isUnlocking || !password}
          className="w-full py-3 rounded-lg font-bold font-mono transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          style={{ background: '#111111', color: '#fff' }}
        >
          {isUnlocking ? <><Loader2 className="w-4 h-4 animate-spin" /> Unlocking...</> : 'Unlock'}
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {onForgotPassword && (
              <button
                onClick={onForgotPassword}
                className="text-[11px] font-mono transition-colors flex items-center gap-1"
                style={{ color: 'rgba(0,0,0,0.5)' }}
              >
                <Key className="w-3 h-3" />
                Import key
              </button>
            )}
            {onCreateNew && (
              <button
                onClick={onCreateNew}
                className="text-[11px] font-mono transition-colors flex items-center gap-1"
                style={{ color: 'rgba(0,0,0,0.4)' }}
              >
                <Lock className="w-3 h-3" />
                New wallet
              </button>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-[11px] font-mono transition-colors"
              style={{ color: 'rgba(0,0,0,0.4)' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
