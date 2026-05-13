'use client';

/**
 * Rich 5-step onboarding checklist that lives at the top of the
 * merchant NotificationsPanel.
 *
 * Replaces the OnboardingOverlay (blocking modal) and the bridged
 * "Setup incomplete" notification entry — the panel is now the
 * single surface for the merchant's setup state.
 *
 * Visibility:
 *   - Renders nothing if feature flag is off
 *   - Renders nothing if status is still loading
 *   - Renders nothing once completed_at is set (3 required steps done)
 *
 * Palette is intentionally neutral — borders + foreground-opacity
 * tones — to avoid the screen feeling like a marketing banner. The
 * navbar chip remains the amber accent that draws attention; the
 * card itself is calm.
 */

import { Check, Circle, ArrowRight, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/contexts/OnboardingContext';

interface StepView {
  key: 'profile' | 'wallet' | 'payment' | 'fund' | 'trade';
  label: string;
  description: string;
  done: boolean;
  /** Optional steps are shown but don't gate completed_at. */
  optional?: boolean;
  /** Right-hand affordance: either a done badge ("Connected") or a CTA. */
  cta: { label: string; onClick: () => void } | null;
  /** Tag shown in place of CTA when the step is done. */
  doneLabel?: string;
}

interface OnboardingSetupCardProps {
  /**
   * Opens the dashboard PaymentMethodModal — same handler that the
   * navbar's "+" button uses. Wired through NotificationsPanel.
   */
  onOpenPaymentMethods?: () => void;
  /** Opens the merchant settings overlay (for the username step). */
  onOpenSettings?: () => void;
}

export function OnboardingSetupCard({
  onOpenPaymentMethods,
  onOpenSettings,
}: OnboardingSetupCardProps) {
  const { enabled, status, skip } = useOnboarding();
  const router = useRouter();

  if (!enabled || !status) return null;
  if (status.completed_at) return null;

  const conditions = status.conditions;

  const steps: StepView[] = [
    {
      key: 'profile',
      label: 'Profile Setup',
      description: 'Set your merchant username and profile details.',
      done: conditions.usernameSet,
      doneLabel: 'Completed',
      cta: conditions.usernameSet
        ? null
        : {
            label: 'Set',
            onClick: onOpenSettings ?? (() => router.push('/merchant/settings')),
          },
    },
    {
      key: 'wallet',
      label: 'Connect Wallet',
      description: 'Connect your Solana wallet to secure your account.',
      done: conditions.walletConnected,
      doneLabel: 'Connected',
      cta: conditions.walletConnected
        ? null
        : { label: 'Connect', onClick: () => router.push('/merchant/wallet') },
    },
    {
      key: 'payment',
      label: 'Add Payment Method',
      description: 'Add UPI / Bank / Local payout method.',
      done: conditions.hasPaymentMethod,
      doneLabel: 'Added',
      cta: conditions.hasPaymentMethod
        ? null
        : onOpenPaymentMethods
        ? { label: 'Add', onClick: onOpenPaymentMethods }
        : { label: 'Add', onClick: () => router.push('/merchant/settings') },
    },
    {
      key: 'fund',
      label: 'Fund Wallet',
      description: 'Deposit USDT to start accepting BUY orders.',
      done: conditions.walletFunded,
      doneLabel: 'Funded',
      optional: true,
      cta: conditions.walletFunded
        ? null
        : { label: 'Fund', onClick: () => router.push('/merchant/wallet') },
    },
    {
      key: 'trade',
      label: 'Start Trading',
      description: 'Accept your first order to go live.',
      done: conditions.hasTrade,
      doneLabel: 'Done',
      optional: true,
      cta: null, // Triggered organically by accepting an order
    },
  ];

  // Visible counter mirrors the screenshot reference ("X/5 completed").
  // Required-step gating remains 3 — see merchantOnboarding repository.
  const doneCount = steps.filter((s) => s.done).length;
  const totalCount = steps.length;
  const percent = Math.round((doneCount / totalCount) * 100);

  return (
    <div className="m-2 rounded-xl border border-foreground/10 bg-foreground/[0.02] p-3 sm:p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="text-[12px] font-bold text-foreground tracking-wide">
            Merchant Setup
          </h3>
          <p className="text-[10.5px] text-foreground/55 mt-0.5 leading-snug">
            Complete onboarding to appear live on the marketplace.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono font-bold tabular-nums text-foreground/70">
            {doneCount}/{totalCount}
          </span>
          <button
            type="button"
            onClick={() => void skip()}
            aria-label="Dismiss setup checklist"
            title="Dismiss for now"
            className="p-0.5 rounded text-foreground/30 hover:text-foreground/60 hover:bg-foreground/[0.04]"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Progress bar — neutral foreground tint */}
      <div className="h-1 w-full rounded-full bg-foreground/[0.06] overflow-hidden mb-3">
        <div
          className="h-full bg-foreground/40 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Steps */}
      <ul className="space-y-2">
        {steps.map((step, idx) => (
          <li key={step.key} className="flex items-start gap-2.5">
            {/* Numbered marker — emerald for done, neutral outline for pending */}
            <span className="mt-0.5 shrink-0">
              {step.done ? (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 border border-emerald-500/40">
                  <Check className="w-3 h-3 text-emerald-400" strokeWidth={3} />
                </span>
              ) : (
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-foreground/[0.04] border border-foreground/15 text-[10px] font-mono font-bold text-foreground/50">
                  {idx + 1}
                </span>
              )}
            </span>

            {/* Body */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span
                  className={`text-[12px] font-semibold ${
                    step.done ? 'text-foreground/50 line-through' : 'text-foreground'
                  }`}
                >
                  {step.label}
                </span>
                {step.optional && !step.done && (
                  <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-px rounded bg-foreground/[0.06] text-foreground/50">
                    Optional
                  </span>
                )}
              </div>
              {!step.done && (
                <p className="text-[10.5px] text-foreground/50 mt-0.5 leading-snug">
                  {step.description}
                </p>
              )}
            </div>

            {/* Right affordance */}
            <div className="shrink-0">
              {step.done && step.doneLabel && (
                <span className="text-[10px] text-emerald-400/80 font-medium">
                  {step.doneLabel}
                </span>
              )}
              {!step.done && step.cta && (
                <button
                  type="button"
                  onClick={step.cta.onClick}
                  className="inline-flex items-center gap-1 rounded-md border border-foreground/15 bg-foreground/[0.04] px-2 py-1 text-[10.5px] font-semibold text-foreground hover:bg-foreground/[0.08] hover:border-foreground/25 transition-colors"
                >
                  {step.cta.label}
                  <ArrowRight className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Footer hint — neutral, single line. Visible while any REQUIRED
          step (Profile, Wallet, Payment) is incomplete. Once all three
          required are done, completed_at fires and the whole card hides,
          so we never need to show "you're done but missing optional". */}
      <div className="mt-3 pt-2 border-t border-foreground/[0.06]">
        <p className="text-[10.5px] text-foreground/55 leading-snug">
          Complete all required steps to appear in the marketplace and unlock trading.
        </p>
      </div>
    </div>
  );
}
