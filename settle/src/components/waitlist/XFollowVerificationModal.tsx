'use client';

// Ported from futureStick's XFollowVerificationModal.tsx — two-step flow:
//   1. Open X profile (https://x.com/blip_money) in a new tab.
//   2. Confirm by entering the user's X username; server records proof + verifies.
//
// Verification is self-attested for the waitlist airdrop (matches how
// futureStick's /twitter/verify-follow worked when the backend was offline —
// it returns success on a well-formed username). Backend uses the existing
// /api/waitlist/tasks/:id/submit + /verify endpoints; the X handle is stored
// in proof_data so admin can audit later.

import { useState } from 'react';
import { X, Twitter, CheckCircle, AlertCircle, Loader2, ExternalLink } from 'lucide-react';

const X_PROFILE_URL = 'https://x.com/blip_money';

type Step = 'follow' | 'confirm' | 'verifying' | 'success' | 'error';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  rewardPoints: number;
  taskId: string | null;
  ensureTaskId: () => Promise<string | null>;
}

export default function XFollowVerificationModal({
  isOpen, onClose, onSuccess, rewardPoints, taskId, ensureTaskId,
}: Props) {
  const [step, setStep] = useState<Step>('follow');
  const [xUsername, setXUsername] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  function handleClose() {
    setStep('follow'); setXUsername(''); setError('');
    onClose();
  }

  function handleFollowNow() {
    window.open(X_PROFILE_URL, '_blank', 'noopener,noreferrer');
    setStep('confirm');
  }

  async function handleVerify() {
    const trimmed = xUsername.trim().replace(/^@/, '');
    if (!trimmed) { setError('Please enter your X/Twitter username.'); return; }
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(trimmed)) {
      setError('Invalid username format. Enter your X handle without @.');
      return;
    }
    setError('');
    setStep('verifying');

    try {
      const id = taskId ?? (await ensureTaskId());
      if (!id) { setStep('error'); setError('Could not create task.'); return; }

      // Save the handle as proof_data, then credit.
      await fetch(`/api/waitlist/tasks/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof_data: { x_username: trimmed } }),
      });
      const verifyRes = await fetch(`/api/waitlist/tasks/${id}/verify`, { method: 'POST' });
      const data = await verifyRes.json();
      if (!verifyRes.ok || !data.success) {
        setStep('error');
        setError(data?.error ?? 'Verification failed.');
        return;
      }
      setStep('success');
      setTimeout(() => { onSuccess(); handleClose(); }, 1600);
    } catch (err) {
      console.error(err);
      setStep('error');
      setError('Network error. Please try again.');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-lg bg-[#0A0A0A] border border-neutral-800 shadow-2xl rounded-sm">
        <div className="p-8">
          <button onClick={handleClose}
            className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>

          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="p-4 bg-neutral-900 border border-neutral-800 text-white rounded-sm">
              <Twitter className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white uppercase">Follow on X</h3>
              <span className="text-xs text-neutral-500">REWARD: {rewardPoints} PTS</span>
            </div>
          </div>

          {/* Step indicator */}
          {step !== 'success' && step !== 'error' && step !== 'verifying' && (
            <div className="flex items-center gap-2 mb-6">
              {(['follow', 'confirm'] as Step[]).map((s, i) => {
                const order = ['follow', 'confirm'] as Step[];
                const idx = order.indexOf(step);
                const isActive = i === idx;
                const isDone = i < idx;
                return (
                  <div key={s} className="flex items-center gap-2 flex-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition-all ${
                      isDone ? 'bg-green-500 border-green-500 text-white'
                        : isActive ? 'bg-white text-black border-white'
                          : 'bg-transparent border-neutral-700 text-neutral-600'
                    }`}>{isDone ? '✓' : i + 1}</div>
                    {i < 1 && <div className={`flex-1 h-px ${isDone ? 'bg-green-500' : 'bg-neutral-800'}`} />}
                  </div>
                );
              })}
            </div>
          )}

          {step === 'follow' && (
            <>
              <div className="p-5 bg-neutral-900/30 border border-neutral-800 rounded-sm mb-6">
                <h4 className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">
                  Step 1: Follow @blip_money
                </h4>
                <p className="text-sm text-neutral-300">
                  Follow our official X (Twitter) account to stay updated on protocol announcements, rewards, and governance.
                </p>
              </div>
              <button onClick={handleFollowNow}
                className="w-full py-3 px-4 bg-white text-black border border-black/10 text-xs font-bold uppercase tracking-wider hover:bg-gray-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <Twitter className="w-4 h-4" /> Follow @blip_money <ExternalLink className="w-3 h-3" />
              </button>
              <button onClick={() => setStep('confirm')}
                className="w-full mt-3 py-2 text-xs text-neutral-500 hover:text-white transition-colors">
                I already follow, continue
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <div className="p-5 bg-neutral-900/30 border border-neutral-800 rounded-sm mb-6">
                <h4 className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">
                  Step 2: Confirm Your Follow
                </h4>
                <p className="text-sm text-neutral-300 mb-4">
                  Enter your X (Twitter) username so we can verify you&apos;re following @blip_money.
                </p>
                <div className="mb-4">
                  <label className="text-xs text-neutral-400 mb-2 block">Your X Username</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-sm">@</span>
                    <input type="text" value={xUsername}
                      onChange={(e) => setXUsername(e.target.value)} placeholder="your_username" maxLength={15}
                      className="w-full pl-8 pr-3 py-2 bg-black border border-neutral-700 text-white text-sm focus:border-white outline-none transition-colors" />
                  </div>
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/20 border border-red-900/30 p-3 rounded-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep('follow')}
                  className="flex-1 py-3 text-xs uppercase tracking-wider border border-neutral-800 text-neutral-400 hover:bg-neutral-900 transition-colors">
                  Back
                </button>
                <button onClick={handleVerify} disabled={!xUsername.trim()}
                  className="flex-1 py-3 text-xs font-bold uppercase tracking-wider bg-white text-black border border-black/10 hover:bg-gray-50 active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-not-allowed">
                  Verify Follow
                </button>
              </div>
            </>
          )}

          {step === 'verifying' && (
            <div className="py-12 flex flex-col items-center justify-center">
              <Loader2 className="w-12 h-12 text-white animate-spin mb-4" />
              <p className="text-sm text-white font-semibold mb-2">Verifying your follow…</p>
              <p className="text-xs text-neutral-500">This may take a few seconds</p>
            </div>
          )}

          {step === 'success' && (
            <div className="py-12 flex flex-col items-center justify-center">
              <div className="w-16 h-16 bg-green-950/30 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <p className="text-lg font-bold text-white mb-2">Follow Verified!</p>
              <p className="text-sm text-neutral-400 mb-4">You earned {rewardPoints} points</p>
              <div className="text-xs text-neutral-500 bg-neutral-900/30 border border-neutral-800 px-4 py-2 rounded-sm">
                Points added to your account
              </div>
            </div>
          )}

          {step === 'error' && (
            <>
              <div className="py-8 flex flex-col items-center justify-center mb-6">
                <div className="w-16 h-16 bg-red-950/30 rounded-full flex items-center justify-center mb-4">
                  <AlertCircle className="w-8 h-8 text-red-400" />
                </div>
                <p className="text-lg font-bold text-white mb-2">Verification Failed</p>
                <p className="text-sm text-neutral-400 text-center max-w-md">{error}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handleClose}
                  className="flex-1 py-3 text-xs uppercase tracking-wider border border-neutral-800 text-neutral-400 hover:bg-neutral-900 transition-colors">
                  Cancel
                </button>
                <button onClick={() => { setError(''); setStep('confirm'); }}
                  className="flex-1 py-3 text-xs font-bold uppercase tracking-wider bg-white text-black border border-black/10 hover:bg-gray-50 active:scale-[0.98] transition">
                  Try Again
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
