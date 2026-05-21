'use client';

// Ported from futureStick TelegramVerificationModal.tsx — two-step:
//   1. Open t.me channel link in a new tab.
//   2. User submits their Telegram User ID (from @userinfobot) — recorded as
//      proof_data and credited.

import React, { useState } from 'react';
import { X, CheckCircle, AlertCircle, Loader2, ExternalLink, MessageCircle, ChevronDown, ChevronUp } from 'lucide-react';

const CHANNEL_URL = 'https://t.me/blipmoney';

type Step = 'join' | 'verify' | 'verifying' | 'success' | 'error';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  rewardPoints: number;
  taskId: string | null;
  ensureTaskId: () => Promise<string | null>;
}

export default function TelegramVerificationModal({
  isOpen, onClose, onSuccess, rewardPoints, taskId, ensureTaskId,
}: Props) {
  const [step, setStep] = useState<Step>('join');
  const [telegramId, setTelegramId] = useState('');
  const [error, setError] = useState('');
  const [showExample, setShowExample] = useState(false);

  if (!isOpen) return null;

  function handleClose() {
    setStep('join'); setTelegramId(''); setError(''); setShowExample(false);
    onClose();
  }

  function handleJoinChannel() {
    window.open(CHANNEL_URL, '_blank', 'noopener,noreferrer');
  }

  async function handleVerify() {
    const trimmed = telegramId.trim();
    if (!trimmed) { setError('Please enter your Telegram User ID.'); return; }
    if (!/^\d+$/.test(trimmed)) {
      setError('Telegram User ID must be a number. Use @userinfobot to get it.');
      return;
    }
    setError(''); setStep('verifying');
    try {
      const id = taskId ?? (await ensureTaskId());
      if (!id) { setStep('error'); setError('Could not create task.'); return; }

      await fetch(`/api/waitlist/tasks/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof_data: { telegram_user_id: trimmed } }),
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

          <div className="flex items-center gap-4 mb-8">
            <div className="p-4 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-sm">
              <MessageCircle className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white uppercase">Join Telegram</h3>
              <span className="text-xs text-neutral-500">REWARD: {rewardPoints} PTS</span>
            </div>
          </div>

          {step !== 'success' && step !== 'error' && step !== 'verifying' && (
            <div className="flex items-center gap-2 mb-6">
              {(['join', 'verify'] as Step[]).map((s, i) => {
                const order = ['join', 'verify'] as Step[];
                const idx = order.indexOf(step);
                const isActive = i === idx;
                const isDone = i < idx;
                return (
                  <React.Fragment key={s}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border transition-all ${
                      isDone ? 'bg-green-500 border-green-500 text-white'
                        : isActive ? 'bg-white text-black border-white'
                          : 'bg-transparent border-neutral-700 text-neutral-600'
                    }`}>{isDone ? '✓' : i + 1}</div>
                    {i < 1 && <div className={`flex-1 h-px ${isDone ? 'bg-green-500' : 'bg-neutral-800'}`} />}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          {step === 'join' && (
            <>
              <div className="p-5 bg-neutral-900/30 border border-neutral-800 rounded-sm mb-6">
                <h4 className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Step 1: Join Our Channel</h4>
                <p className="text-sm text-neutral-300">
                  Join our official Telegram channel to stay updated and earn rewards.
                </p>
              </div>
              <button onClick={() => { handleJoinChannel(); setStep('verify'); }}
                className="w-full py-3 px-4 bg-[#0088cc] text-white text-xs font-bold uppercase tracking-wider hover:bg-[#0077b5] transition-all flex items-center justify-center gap-2">
                <MessageCircle className="w-4 h-4" /> Join Telegram Channel <ExternalLink className="w-3 h-3" />
              </button>
              <button onClick={() => setStep('verify')}
                className="w-full mt-3 py-2 text-xs text-neutral-500 hover:text-white transition-colors">
                I already joined, continue
              </button>
            </>
          )}

          {step === 'verify' && (
            <>
              <div className="p-5 bg-neutral-900/30 border border-neutral-800 rounded-sm mb-6">
                <h4 className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Step 2: Verify Membership</h4>
                <p className="text-sm text-neutral-300 mb-3">
                  Enter your Telegram User ID and click verify to confirm your channel membership and claim {rewardPoints} points.
                </p>
                <div className="bg-blue-950/20 border border-blue-900/30 p-4 rounded-sm">
                  <div className="flex gap-2 mb-3">
                    <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs font-semibold text-blue-300">How to find your Telegram User ID:</p>
                  </div>
                  <ol className="space-y-2 ml-6 text-xs text-blue-300">
                    <li className="flex items-start gap-2"><span className="font-bold min-w-[16px]">1.</span><span>Open Telegram and search for <strong>@userinfobot</strong></span></li>
                    <li className="flex items-start gap-2"><span className="font-bold min-w-[16px]">2.</span><span>Tap on the bot and press <strong>Start</strong></span></li>
                    <li className="flex items-start gap-2"><span className="font-bold min-w-[16px]">3.</span><span>The bot will reply with your info — copy the <strong>Id</strong> number (e.g. <code className="bg-blue-900/40 px-1 rounded">123456789</code>)</span></li>
                    <li className="flex items-start gap-2"><span className="font-bold min-w-[16px]">4.</span><span>Paste that number below</span></li>
                  </ol>

                  <div className="ml-6 mt-3 flex items-center gap-3">
                    <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:underline">
                      Open @userinfobot <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-blue-700">|</span>
                    <button type="button" onClick={() => setShowExample(!showExample)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:underline">
                      {showExample ? 'Hide' : 'See'} example
                      {showExample ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>

                  {showExample && (
                    <div className="mt-3 ml-6 rounded-lg overflow-hidden border border-blue-900/40">
                      <div className="bg-[#2b5278] px-3 py-2 flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#5cacee] flex items-center justify-center">
                          <span className="text-white text-[10px] font-bold">UI</span>
                        </div>
                        <div>
                          <p className="text-white text-[11px] font-semibold leading-tight">UserInfoBot</p>
                          <p className="text-white/60 text-[9px] leading-tight">bot</p>
                        </div>
                      </div>
                      <div className="bg-[#0e1621] px-3 py-3 space-y-2">
                        <div className="flex justify-end">
                          <div className="bg-[#2b5278] rounded-lg px-3 py-1.5 max-w-[70%]">
                            <p className="text-[11px] text-white">/start</p>
                            <p className="text-[8px] text-white/40 text-right">12:00</p>
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="bg-[#182533] rounded-lg px-3 py-2 max-w-[85%] shadow-sm">
                            <p className="text-[11px] text-white leading-relaxed">
                              <span className="text-white/50">@your_username</span>{'\n'}
                              <span className="font-bold text-white">Id: </span>
                              <span className="font-mono bg-yellow-500/30 px-1 rounded text-yellow-300">123456789</span>{'\n'}
                              <span className="text-white/50">First: John</span>{'\n'}
                              <span className="text-white/50">Lang: en</span>
                            </p>
                            <p className="text-[8px] text-white/40 text-right mt-1">12:00</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 pl-1">
                          <span className="text-[10px]">👆</span>
                          <span className="text-[10px] font-semibold text-blue-400">Copy this number — that&apos;s your User ID</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <input type="text" value={telegramId} onChange={(e) => setTelegramId(e.target.value)}
                placeholder="Enter your Telegram User ID (e.g. 123456789)" maxLength={20}
                className="w-full px-4 py-3 mb-4 bg-neutral-900 border border-neutral-800 text-white text-sm placeholder:text-neutral-600 rounded-sm focus:outline-none focus:border-neutral-500 transition-colors" />

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/20 border border-red-900/30 p-3 rounded-sm mb-4">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                </div>
              )}

              <button onClick={handleVerify}
                className="w-full py-3 px-4 bg-white text-black border border-black/10 text-xs font-bold uppercase tracking-wider hover:bg-gray-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <CheckCircle className="w-4 h-4" /> Verify Membership
              </button>
              <button onClick={() => setStep('join')}
                className="w-full mt-3 py-2 text-xs text-neutral-500 hover:text-white transition-colors">
                Back
              </button>
            </>
          )}

          {step === 'verifying' && (
            <div className="py-12 flex flex-col items-center justify-center">
              <Loader2 className="w-12 h-12 text-white animate-spin mb-4" />
              <p className="text-sm text-white font-semibold mb-2">Verifying membership…</p>
              <p className="text-xs text-neutral-500">Checking your Telegram channel membership</p>
            </div>
          )}

          {step === 'success' && (
            <div className="py-12 flex flex-col items-center justify-center">
              <div className="w-16 h-16 bg-green-950/30 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <p className="text-lg font-bold text-white mb-2">Membership Verified!</p>
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
                <button onClick={() => { setError(''); setStep('verify'); }}
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
