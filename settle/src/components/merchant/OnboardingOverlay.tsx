'use client';

/**
 * Full-screen onboarding overlay — blocks the merchant dashboard until
 * the 5-step setup is completed or explicitly skipped. Replaces the
 * inline SetupProgress widget as the primary surface.
 *
 * Visibility rules:
 *   - Renders nothing if the feature flag is off (NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING)
 *   - Renders nothing if status is still loading on first mount
 *   - Renders nothing if completed_at is set (covers grandfathered merchants)
 *   - Renders nothing if skipped_at is set (the persistent banner takes over;
 *     merchant can resume from there)
 *
 * Skip behaviour: optimistically marks the row skipped, closes the
 * overlay, and the OnboardingReminder banner becomes the persistent
 * "complete your setup" surface until the merchant resumes or finishes.
 *
 * Step-completion detection is condition-driven server-side — opening
 * a side-flow modal (e.g. payment methods) and finishing there will
 * advance the step once status refreshes, even without clicking the
 * overlay's CTAs.
 */

import { useState } from 'react';
import { Check, CircleDashed, ArrowRight, X, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface StepView {
  key: 'username' | 'wallet' | 'payment' | 'fund' | 'trade';
  label: string;
  hint: string;
  done: boolean;
  cta: { label: string; onClick: () => void } | null;
}

interface OnboardingOverlayProps {
  /** Opens the dashboard PaymentMethodModal — keeps overlay open so the
   *  merchant returns to the checklist after the side flow closes. */
  onOpenPaymentMethods?: () => void;
}

export function OnboardingOverlay({ onOpenPaymentMethods }: OnboardingOverlayProps) {
  const { enabled, status, skip, refresh } = useOnboarding();
  const router = useRouter();
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);

  if (!enabled || !status) return null;
  if (status.completed_at) return null;
  if (status.skipped_at) return null;

  const { conditions } = status;

  const steps: StepView[] = [
    {
      key: 'username',
      label: 'Set Username',
      hint: 'Pick a username traders will recognize you by.',
      done: conditions.usernameSet,
      cta: conditions.usernameSet
        ? null
        : { label: 'Set', onClick: () => setUsernameModalOpen(true) },
    },
    {
      key: 'wallet',
      label: 'Connect Wallet',
      hint: 'Connect your wallet to start trading securely.',
      done: conditions.walletConnected,
      cta: conditions.walletConnected
        ? null
        : { label: 'Connect', onClick: () => router.push('/merchant/wallet') },
    },
    {
      key: 'payment',
      label: 'Add Payment Method',
      hint: 'Add a payment method so buyers and sellers can trade with you.',
      done: conditions.hasPaymentMethod,
      cta: conditions.hasPaymentMethod
        ? null
        : onOpenPaymentMethods
        ? { label: 'Add', onClick: onOpenPaymentMethods }
        : { label: 'Add', onClick: () => router.push('/merchant/settings') },
    },
    {
      key: 'fund',
      label: 'Fund Wallet with USDT',
      hint: 'Fund your wallet with USDT if you want to accept BUY trades.',
      done: conditions.walletFunded,
      cta: conditions.walletFunded
        ? null
        : { label: 'Fund', onClick: () => router.push('/merchant/wallet') },
    },
    {
      key: 'trade',
      label: 'Accept First Trade',
      hint: 'Accept your first trade to start using the platform.',
      done: conditions.hasTrade,
      cta: null,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const percent = Math.round((doneCount / totalCount) * 100);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-tour="setup-overlay"
      className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0e0e0e] p-5 sm:p-6 shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Welcome to Blip Money</h2>
            <p className="text-xs text-white/60 mt-1">
              Finish setup to start trading. Other merchants only see you online once you&apos;re done.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[#ff8a4c] transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-xs font-mono text-white/60 tabular-nums">
            {doneCount}/{totalCount}
          </span>
        </div>

        <ul className="space-y-2 mb-5">
          {steps.map((step) => (
            <li
              key={step.key}
              data-tour={step.key === 'username' ? 'customize-username' : undefined}
              className="flex items-start gap-3 py-1"
            >
              <span className="mt-0.5 shrink-0">
                {step.done ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <CircleDashed className="h-4 w-4 text-white/40" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-medium ${
                      step.done ? 'text-white/50 line-through' : 'text-white'
                    }`}
                  >
                    {step.label}
                  </span>
                  {step.cta && (
                    <button
                      type="button"
                      onClick={step.cta.onClick}
                      className="text-xs font-semibold text-black bg-[#ff8a4c] hover:bg-[#ff9a60] rounded-lg px-3 py-1 inline-flex items-center gap-1 shrink-0"
                    >
                      {step.cta.label}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {!step.done && (
                  <p className="text-xs text-white/50 mt-0.5">{step.hint}</p>
                )}
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <button
            type="button"
            onClick={() => void skip()}
            className="text-xs text-white/50 hover:text-white/80"
          >
            Skip for now
          </button>
          <span className="text-[11px] text-white/30">
            We&apos;ll keep your progress for next time.
          </span>
        </div>
      </div>

      {usernameModalOpen && (
        <UsernameModal
          onClose={() => setUsernameModalOpen(false)}
          onSaved={() => {
            setUsernameModalOpen(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Username sub-modal — shared between overlay and (future) settings flows.   */
/* -------------------------------------------------------------------------- */

type Availability =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'unavailable'; reason: string };

interface UsernameModalProps {
  onClose: () => void;
  onSaved: () => void;
}

function UsernameModal({ onClose, onSaved }: UsernameModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ kind: 'idle' });

  // Debounced live availability check — discards stale responses.
  useStateDebounce(value, async (trimmed, cancelled) => {
    if (trimmed.length === 0) {
      setAvailability({ kind: 'idle' });
      return;
    }
    setAvailability({ kind: 'checking' });
    try {
      const res = await fetchWithAuth(
        `/api/merchant/username?check=${encodeURIComponent(trimmed)}`
      );
      if (cancelled()) return;
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setAvailability({ kind: 'unavailable', reason: json?.error || 'Could not verify' });
        return;
      }
      if (json.data?.available) {
        setAvailability({ kind: 'available' });
      } else {
        setAvailability({
          kind: 'unavailable',
          reason: json.data?.reason || 'Username already taken',
        });
      }
    } catch {
      if (!cancelled()) setAvailability({ kind: 'unavailable', reason: 'Network error' });
    }
  });

  const canSubmit =
    !saving && availability.kind === 'available' && value.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetchWithAuth('/api/merchant/username', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: value.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || json?.errors?.[0] || 'Failed to update username');
        return;
      }
      onSaved();
    } catch {
      setError('Network error — try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#1a1a1a] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-white">Set Your Username</h3>
            <p className="text-xs text-white/60 mt-1">
              Letters, numbers and underscores. 3–20 characters.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/5 text-white/40 hover:text-white/80"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <input
              type="text"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="new_username"
              maxLength={20}
              className={`w-full bg-black/40 border rounded-lg px-3 py-2 pr-9 text-sm text-white placeholder-white/30 focus:outline-none transition-colors ${
                availability.kind === 'available'
                  ? 'border-emerald-500/60'
                  : availability.kind === 'unavailable'
                  ? 'border-red-500/60'
                  : 'border-white/10 focus:border-[#ff8a4c]/60'
              }`}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {availability.kind === 'checking' && (
                <Loader2 className="w-3.5 h-3.5 text-white/40 animate-spin" />
              )}
              {availability.kind === 'available' && (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              )}
              {availability.kind === 'unavailable' && (
                <X className="w-3.5 h-3.5 text-red-400" />
              )}
            </span>
          </div>
          {availability.kind === 'unavailable' && (
            <p className="text-xs text-red-400">{availability.reason}</p>
          )}
          {availability.kind === 'available' && (
            <p className="text-xs text-emerald-400">Available</p>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-white/60 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#ff8a4c] text-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving && <Loader2 className="w-3 h-3 animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Local helper: debounce a value through an async effect, with cancellation. */
/* -------------------------------------------------------------------------- */

import { useEffect } from 'react';

function useStateDebounce(
  value: string,
  effect: (trimmed: string, cancelled: () => boolean) => void | Promise<void>,
  delayMs = 350
) {
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      void effect(value.trim(), () => cancelled);
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
