'use client';

// Two-step quest:
//   1. Open t.me channel link in a new tab.
//   2. User submits their Telegram User ID (from @userinfobot) — recorded
//      as proof_data and credited.

import React, { useState } from 'react';
import {
  CheckCircle2, AlertCircle, Loader2, ExternalLink, MessageCircle,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import QuestModalShell, {
  QuestPrimaryCta,
  QuestSecondaryCta,
  QuestNoticePill,
  QuestSectionCard,
} from '@/components/waitlist/QuestModalShell';

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

  const showStepper = step === 'join' || step === 'verify';

  return (
    <QuestModalShell
      isOpen={isOpen}
      onClose={handleClose}
      icon={<MessageCircle className="w-5 h-5" />}
      eyebrow="Community quest"
      title="Join Telegram"
      rewardPoints={rewardPoints}
    >
      {showStepper && (
        <div className="flex items-center gap-2 mb-5">
          {(['join', 'verify'] as Step[]).map((s, i) => {
            const order = ['join', 'verify'] as Step[];
            const idx = order.indexOf(step);
            const isActive = i === idx;
            const isDone = i < idx;
            return (
              <React.Fragment key={s}>
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
                  <div
                    className={`flex-1 h-px ${isDone ? 'bg-emerald-500' : 'bg-black/[0.08]'}`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {step === 'join' && (
        <div className="space-y-4">
          <QuestSectionCard eyebrow="Step 1 · Join our channel">
            <p className="text-[13px] text-[#3a3a3c] leading-[1.55]">
              Join our official Telegram channel to stay updated and earn rewards.
            </p>
          </QuestSectionCard>

          <QuestPrimaryCta onClick={() => { handleJoinChannel(); setStep('verify'); }}>
            <MessageCircle className="w-4 h-4" /> Join Telegram channel{' '}
            <ExternalLink className="w-3.5 h-3.5" />
          </QuestPrimaryCta>

          <button
            type="button"
            onClick={() => setStep('verify')}
            className="block w-full text-center text-[12px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors"
          >
            I already joined — continue
          </button>
        </div>
      )}

      {step === 'verify' && (
        <div className="space-y-4">
          <QuestSectionCard eyebrow="Step 2 · Verify membership">
            <p className="text-[13px] text-[#3a3a3c] leading-[1.55] mb-3">
              Enter your Telegram User ID and tap verify to confirm membership and
              claim your{' '}
              <strong className="text-[#1d1d1f]">{rewardPoints.toLocaleString('en-US')}</strong>{' '}
              points.
            </p>

            <QuestNoticePill
              icon={<AlertCircle className="w-4 h-4" />}
              title="How to find your Telegram User ID"
              body={
                <>
                  <ol className="space-y-1.5 mt-1">
                    <li>1. Open Telegram and search for <strong>@userinfobot</strong></li>
                    <li>2. Tap the bot and press <strong>Start</strong></li>
                    <li>
                      3. Copy the <strong>Id</strong> number (e.g.{' '}
                      <code className="bg-black/[0.06] px-1 rounded text-[11px]">123456789</code>)
                    </li>
                    <li>4. Paste it below</li>
                  </ol>
                  <div className="mt-3 flex items-center gap-3">
                    <a
                      href="https://t.me/userinfobot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#cc785c] hover:underline"
                    >
                      Open @userinfobot <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-black/20">|</span>
                    <button
                      type="button"
                      onClick={() => setShowExample(!showExample)}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#cc785c] hover:underline"
                    >
                      {showExample ? 'Hide' : 'See'} example
                      {showExample ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>
                  </div>

                  {showExample && (
                    <div className="mt-3 rounded-xl overflow-hidden border border-black/[0.08]">
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
                          </div>
                        </div>
                        <div className="flex justify-start">
                          <div className="bg-[#182533] rounded-lg px-3 py-2 max-w-[85%] shadow-sm">
                            <p className="text-[11px] text-white leading-relaxed">
                              <span className="text-white/50">@your_username</span>{'\n'}
                              <span className="font-bold text-white">Id: </span>
                              <span className="font-mono bg-yellow-500/30 px-1 rounded text-yellow-300">
                                123456789
                              </span>
                              {'\n'}
                              <span className="text-white/50">First: John</span>
                            </p>
                          </div>
                        </div>
                        <p className="text-[10px] font-semibold text-[#cc785c] pl-1">
                          👆 Copy that number — that's your User ID
                        </p>
                      </div>
                    </div>
                  )}
                </>
              }
            />
          </QuestSectionCard>

          <input
            type="text"
            value={telegramId}
            onChange={(e) => setTelegramId(e.target.value)}
            placeholder="Enter your Telegram User ID (e.g. 123456789)"
            maxLength={20}
            className="w-full bg-white border border-black/[0.08] rounded-xl px-4 py-3 text-[13px] text-[#1d1d1f] placeholder:text-[#a0a0a4] outline-none focus:border-[#cc785c]/50 focus:ring-1 focus:ring-[#cc785c]/30"
          />

          {error && (
            <QuestNoticePill tone="error" icon={<AlertCircle className="w-4 h-4" />} body={error} />
          )}

          <div className="flex gap-3">
            <QuestSecondaryCta onClick={() => setStep('join')}>Back</QuestSecondaryCta>
            <QuestPrimaryCta onClick={handleVerify}>
              <CheckCircle2 className="w-4 h-4" /> Verify membership
            </QuestPrimaryCta>
          </div>
        </div>
      )}

      {step === 'verifying' && (
        <div className="py-10 flex flex-col items-center text-center">
          <Loader2 className="w-9 h-9 text-[#cc785c] animate-spin mb-4" />
          <p className="text-[14px] font-semibold text-[#1d1d1f] mb-1">Verifying membership…</p>
          <p className="text-[12px] text-[#6e6e73]">Checking your Telegram channel membership.</p>
        </div>
      )}

      {step === 'success' && (
        <div className="py-8 flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="text-[15.5px] font-semibold text-[#1d1d1f]">Membership verified</p>
          <p className="text-[12.5px] text-[#6e6e73]">
            You earned <strong className="text-[#1d1d1f]">{rewardPoints.toLocaleString('en-US')} points</strong>.
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
            <QuestPrimaryCta onClick={() => { setError(''); setStep('verify'); }}>
              Try again
            </QuestPrimaryCta>
          </div>
        </div>
      )}
    </QuestModalShell>
  );
}
