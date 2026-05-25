'use client';

// Ported from futureStick TwitterVerificationModal.tsx — two-step:
//   1. Tweet the campaign message (Twitter intent URL opens in a new tab).
//   2. Paste the resulting tweet URL; server records + credits.

import { useState } from 'react';
import { X, Twitter, CheckCircle, AlertCircle, Loader2, ExternalLink, Copy, Check } from 'lucide-react';

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
  // Copy describes the actual product (Pay with Crypto, Settle in Cash
  // via non-custodial escrow on Solana) rather than the generic "DeFi
  // protocol" pitch. Uses the real handle @blip_money — the dashboard
  // already standardised on this; only the old campaign string was
  // pinning @BlipMoney.
  return `🪙 Just joined @blip_money — pay with crypto, settle in cash.

Non-custodial escrow on Solana. No KYC, no banks, no waiting on wires. Borderless P2P settlement in under 60 seconds.

Skip the line 👇
${origin}

#BlipMoney #Crypto #Stablecoins`;
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

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-lg bg-[#0A0A0A] border border-neutral-800 shadow-2xl rounded-sm">
        <div className="p-8">
          <button onClick={handleClose}
            className="absolute top-4 right-4 text-neutral-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4 mb-8">
            <div className="p-4 bg-neutral-900 border border-neutral-800 text-white rounded-sm">
              <Twitter className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white uppercase">Share on X (Twitter)</h3>
              <span className="text-xs text-neutral-500">REWARD: {rewardPoints} PTS</span>
            </div>
          </div>

          {step === 'tweet' && (
            <>
              <div className="p-5 bg-neutral-900/30 border border-neutral-800 rounded-sm mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[10px] uppercase tracking-widest text-neutral-500">Campaign Message</h4>
                  <button onClick={handleCopyMessage}
                    className="text-xs flex items-center gap-1 text-neutral-400 hover:text-white transition-colors">
                    {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </button>
                </div>
                <p className="text-sm text-neutral-300 whitespace-pre-line leading-relaxed">{message}</p>
              </div>

              <div className="mb-6 p-4 bg-blue-950/20 border border-blue-900/30 rounded-sm">
                <div className="flex gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-300">
                    <p className="font-semibold mb-1">Important:</p>
                    <ul className="space-y-1 text-blue-400">
                      <li>• Your tweet must be public (not protected)</li>
                      <li>• Must include @blip_money mention</li>
                      <li>• Each tweet can only be verified once</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button onClick={handleTweetNow}
                className="w-full py-3 px-4 bg-white text-black border border-black/10 text-xs font-bold uppercase tracking-wider hover:bg-gray-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <Twitter className="w-4 h-4" /> Tweet Now <ExternalLink className="w-3 h-3" />
              </button>
            </>
          )}

          {step === 'submit' && (
            <>
              <div className="p-5 bg-neutral-900/30 border border-neutral-800 rounded-sm mb-6">
                <h4 className="text-[10px] uppercase tracking-widest text-neutral-500 mb-3">Submit Your Tweet</h4>
                <p className="text-sm text-neutral-300 mb-4">
                  After posting your tweet, paste the tweet URL below to verify and claim your reward.
                </p>
                <div className="mb-4">
                  <label className="text-xs text-neutral-400 mb-2 block">Tweet URL</label>
                  <input type="text" value={tweetUrl} onChange={(e) => setTweetUrl(e.target.value)}
                    placeholder="https://twitter.com/username/status/..." maxLength={500}
                    className="w-full px-3 py-2 bg-black border border-neutral-700 text-white text-sm focus:border-white outline-none transition-colors" />
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/20 border border-red-900/30 p-3 rounded-sm">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep('tweet')}
                  className="flex-1 py-3 text-xs uppercase tracking-wider border border-neutral-800 text-neutral-400 hover:bg-neutral-900 transition-colors">
                  Back
                </button>
                <button onClick={handleVerify} disabled={!tweetUrl.trim()}
                  className="flex-1 py-3 text-xs font-bold uppercase tracking-wider bg-white text-black border border-black/10 hover:bg-gray-50 active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-not-allowed">
                  Verify Tweet
                </button>
              </div>
            </>
          )}

          {step === 'verifying' && (
            <div className="py-12 flex flex-col items-center justify-center">
              <Loader2 className="w-12 h-12 text-white animate-spin mb-4" />
              <p className="text-sm text-white font-semibold mb-2">Verifying your tweet…</p>
              <p className="text-xs text-neutral-500">This may take a few seconds</p>
            </div>
          )}

          {step === 'success' && (
            <div className="py-12 flex flex-col items-center justify-center">
              <div className="w-16 h-16 bg-green-950/30 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-green-400" />
              </div>
              <p className="text-lg font-bold text-white mb-2">Verification Successful!</p>
              <p className="text-sm text-neutral-400 mb-4">You earned {rewardPoints} points</p>
              <div className="text-xs text-neutral-500 bg-neutral-900/30 border border-neutral-800 px-4 py-2 rounded-sm">
                Points will be added to your account
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
                <button onClick={() => { setError(''); setStep('submit'); }}
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
