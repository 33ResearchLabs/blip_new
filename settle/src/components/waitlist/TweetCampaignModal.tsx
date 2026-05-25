'use client';

// Two-step quest:
//   1. Tweet the campaign message (Twitter intent URL opens in a new tab).
//   2. Paste the resulting tweet URL; server records + credits.

import { useState } from 'react';
import {
  Twitter, CheckCircle2, AlertCircle, Loader2, ExternalLink, Copy, Check,
} from 'lucide-react';
import QuestModalShell, {
  QuestPrimaryCta,
  QuestSecondaryCta,
  QuestNoticePill,
  QuestSectionCard,
} from '@/components/waitlist/QuestModalShell';

type Step = 'tweet' | 'submit' | 'verifying' | 'success' | 'error';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  rewardPoints: number;
  taskId: string | null;
  ensureTaskId: () => Promise<string | null>;
}

function getCampaignMessage(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://blip.money';
  return `Just joined @blip_money, a global settlement market powered by stablecoins.

Blip Market connects users who need money moved with merchants who can settle locally.

Every transaction is protected by non-custodial Solana escrow, while the market finds the best available liquidity.

No banks holding funds.
No wire delays.
No fixed middleman rates.

Skip the line 👇
${origin}`;
}

function extractTweetId(url: string): string | null {
  const patterns = [/(?:twitter|x)\.com\/\w+\/status\/(\d+)/, /\/status\/(\d+)/];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export default function TweetCampaignModal({
  isOpen, onClose, onSuccess, rewardPoints, taskId, ensureTaskId,
}: Props) {
  const [step, setStep] = useState<Step>('tweet');
  const [tweetUrl, setTweetUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const message = getCampaignMessage();

  function handleClose() {
    setStep('tweet'); setTweetUrl(''); setError(''); setCopied(false);
    onClose();
  }

  async function handleCopyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {/* ignore */}
  }

  function handleTweetNow() {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'width=550,height=420,noopener,noreferrer');
    setStep('submit');
  }

  async function handleVerify() {
    setError('');
    const tweetId = extractTweetId(tweetUrl);
    if (!tweetId) {
      setError('Invalid tweet URL. Please paste the full URL from Twitter/X.');
      return;
    }
    setStep('verifying');
    try {
      const id = taskId ?? (await ensureTaskId());
      if (!id) { setStep('error'); setError('Could not create task.'); return; }

      await fetch(`/api/waitlist/tasks/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proof_data: { tweet_id: tweetId, tweet_url: tweetUrl } }),
      });
      const verifyRes = await fetch(`/api/waitlist/tasks/${id}/verify`, { method: 'POST' });
      const data = await verifyRes.json();
      if (!verifyRes.ok || !data.success) {
        setStep('error');
        setError(data?.error ?? 'Tweet verification failed.');
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
    <QuestModalShell
      isOpen={isOpen}
      onClose={handleClose}
      icon={<Twitter className="w-5 h-5" />}
      eyebrow="Social quest"
      title="Share on X (Twitter)"
      rewardPoints={rewardPoints}
    >
      {step === 'tweet' && (
        <div className="space-y-4">
          <QuestSectionCard
            eyebrow="Campaign message"
            action={
              <button
                type="button"
                onClick={handleCopyMessage}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6e6e73] hover:text-[#1d1d1f] transition-colors"
              >
                {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
              </button>
            }
          >
            <p className="text-[13px] text-[#3a3a3c] whitespace-pre-line leading-[1.55]">
              {message}
            </p>
          </QuestSectionCard>

          <QuestNoticePill
            icon={<AlertCircle className="w-4 h-4" />}
            title="Before you post"
            body={
              <ul className="space-y-1 mt-0.5">
                <li>• Your tweet must be public (not protected)</li>
                <li>• Must include <strong>@blip_money</strong> mention</li>
                <li>• Each tweet can only be verified once</li>
              </ul>
            }
          />

          <QuestPrimaryCta onClick={handleTweetNow}>
            <Twitter className="w-4 h-4" /> Tweet now <ExternalLink className="w-3.5 h-3.5" />
          </QuestPrimaryCta>
        </div>
      )}

      {step === 'submit' && (
        <div className="space-y-4">
          <QuestSectionCard eyebrow="Submit your tweet">
            <p className="text-[13px] text-[#3a3a3c] leading-[1.55] mb-3">
              After posting your tweet, paste the tweet URL below to verify and claim your reward.
            </p>
            <label className="block text-[10px] font-bold tracking-[0.18em] uppercase text-[#6e6e73] mb-2">
              Tweet URL
            </label>
            <input
              type="text"
              value={tweetUrl}
              onChange={(e) => setTweetUrl(e.target.value)}
              placeholder="https://x.com/username/status/…"
              maxLength={500}
              className="w-full bg-white border border-black/[0.08] rounded-xl px-3.5 py-2.5 text-[13px] text-[#1d1d1f] placeholder:text-[#a0a0a4] outline-none focus:border-[#cc785c]/50 focus:ring-1 focus:ring-[#cc785c]/30"
            />
          </QuestSectionCard>

          {error && (
            <QuestNoticePill tone="error" icon={<AlertCircle className="w-4 h-4" />} body={error} />
          )}

          <div className="flex gap-3">
            <QuestSecondaryCta onClick={() => setStep('tweet')}>Back</QuestSecondaryCta>
            <QuestPrimaryCta onClick={handleVerify} disabled={!tweetUrl.trim()}>
              Verify tweet →
            </QuestPrimaryCta>
          </div>
        </div>
      )}

      {step === 'verifying' && (
        <div className="py-10 flex flex-col items-center text-center">
          <Loader2 className="w-9 h-9 text-[#cc785c] animate-spin mb-4" />
          <p className="text-[14px] font-semibold text-[#1d1d1f] mb-1">Verifying your tweet…</p>
          <p className="text-[12px] text-[#6e6e73]">This only takes a moment.</p>
        </div>
      )}

      {step === 'success' && (
        <div className="py-8 flex flex-col items-center text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
          </div>
          <p className="text-[15.5px] font-semibold text-[#1d1d1f]">Verification successful</p>
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
            <QuestPrimaryCta onClick={() => { setError(''); setStep('submit'); }}>
              Try again
            </QuestPrimaryCta>
          </div>
        </div>
      )}
    </QuestModalShell>
  );
}
