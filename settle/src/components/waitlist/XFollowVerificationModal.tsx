'use client';

// Two-step quest:
//   1. Open X profile (https://x.com/blip_money) in a new tab.
//   2. Confirm by entering the user's X username; server records proof.
//
// Verification is self-attested for the waitlist airdrop. Backend uses
// the existing /api/waitlist/tasks/:id/submit + /verify endpoints; the
// X handle is stored in proof_data so admin can audit later.

import { useState } from 'react';
import {
  Twitter, CheckCircle2, AlertCircle, Loader2, ExternalLink,
} from 'lucide-react';
import QuestModalShell, {
  QuestPrimaryCta,
  QuestSecondaryCta,
  QuestNoticePill,
  QuestSectionCard,
} from '@/components/waitlist/QuestModalShell';

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

  const showStepper = step === 'follow' || step === 'confirm';

  return (
    <QuestModalShell
      isOpen={isOpen}
      onClose={handleClose}
      icon={<Twitter className="w-5 h-5" />}
      eyebrow="Social quest"
      title="Follow on X"
      rewardPoints={rewardPoints}
    >
      {showStepper && (
        <div className="flex items-center gap-2 mb-5">
          {(['follow', 'confirm'] as Step[]).map((s, i) => {
            const order = ['follow', 'confirm'] as Step[];
            const idx = order.indexOf(step);
            const isActive = i === idx;
            const isDone = i < idx;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border transition-all ${
                    isDone
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : isActive
                        ? 'bg-[#cc785c] border-[#cc785c] text-white'
                        : 'bg-white border-black/[0.10] text-[#a0a0a4]'
                  }`}
                >
                  {isDone ? '✓' : i + 1}
                </div>
                {i < 1 && (
                  <div className={`flex-1 h-px ${isDone ? 'bg-emerald-500' : 'bg-black/[0.08]'}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {step === 'follow' && (
        <div className="space-y-4">
          <QuestSectionCard eyebrow="Step 1 · Follow @blip_money">
            <p className="text-[13px] text-[#3a3a3c] leading-[1.55]">
              Follow our official X (Twitter) account to stay updated on protocol
              announcements, rewards, and governance.
            </p>
          </QuestSectionCard>

          <QuestPrimaryCta onClick={handleFollowNow}>
            <Twitter className="w-4 h-4" /> Follow @blip_money{' '}
            <ExternalLink className="w-3.5 h-3.5" />
          </QuestPrimaryCta>

          <button
            type="button"
            onClick={() => setStep('confirm')}
            className="block w-full text-center text-[12px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors"
          >
            I already follow — continue
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <QuestSectionCard eyebrow="Step 2 · Confirm your follow">
            <p className="text-[13px] text-[#3a3a3c] leading-[1.55] mb-3">
              Enter your X (Twitter) username so we can verify you're following{' '}
              <strong className="text-[#1d1d1f]">@blip_money</strong>.
            </p>
            <label className="block text-[10px] font-bold tracking-[0.18em] uppercase text-[#6e6e73] mb-2">
              Your X Username
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a0a0a4] text-[14px]">@</span>
              <input
                type="text"
                value={xUsername}
                onChange={(e) => setXUsername(e.target.value)}
                placeholder="your_username"
                maxLength={15}
                className="w-full bg-white border border-black/[0.08] rounded-xl pl-8 pr-4 py-2.5 text-[13px] text-[#1d1d1f] placeholder:text-[#a0a0a4] outline-none focus:border-[#cc785c]/50 focus:ring-1 focus:ring-[#cc785c]/30"
              />
            </div>
          </QuestSectionCard>

          {error && (
            <QuestNoticePill tone="error" icon={<AlertCircle className="w-4 h-4" />} body={error} />
          )}

          <div className="flex gap-3">
            <QuestSecondaryCta onClick={() => setStep('follow')}>Back</QuestSecondaryCta>
            <QuestPrimaryCta onClick={handleVerify} disabled={!xUsername.trim()}>
              <CheckCircle2 className="w-4 h-4" /> Verify follow
            </QuestPrimaryCta>
          </div>
        </div>
      )}

      {step === 'verifying' && (
        <div className="py-10 flex flex-col items-center text-center">
          <Loader2 className="w-9 h-9 text-[#cc785c] animate-spin mb-4" />
          <p className="text-[14px] font-semibold text-[#1d1d1f] mb-1">Verifying your follow…</p>
          <p className="text-[12px] text-[#6e6e73]">This only takes a moment.</p>
        </div>
      )}

      {step === 'success' && (
        <div className="py-8 flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="text-[15.5px] font-semibold text-[#1d1d1f]">Follow verified</p>
          <p className="text-[12.5px] text-[#6e6e73]">
            You earned{' '}
            <strong className="text-[#1d1d1f]">{rewardPoints.toLocaleString('en-US')} points</strong>.
          </p>
        </div>
      )}

      {step === 'error' && (
        <div className="space-y-4">
          <div className="py-6 flex flex-col items-center text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-red-600" />
            </div>
            <p className="text-[15.5px] font-semibold text-[#1d1d1f]">Verification failed</p>
            <p className="text-[12.5px] text-[#6e6e73] max-w-sm">{error}</p>
          </div>
          <div className="flex gap-3">
            <QuestSecondaryCta onClick={handleClose}>Cancel</QuestSecondaryCta>
            <QuestPrimaryCta onClick={() => { setError(''); setStep('confirm'); }}>
              Try again
            </QuestPrimaryCta>
          </div>
        </div>
      )}
    </QuestModalShell>
  );
}
