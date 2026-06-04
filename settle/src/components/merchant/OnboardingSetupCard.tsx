'use client';

import { Check, ArrowRight, X, Wallet, TrendingUp, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useOnboarding } from '@/contexts/OnboardingContext';

interface StepView {
  key: 'profile' | 'wallet' | 'inr-rate' | 'trade';
  label: string;
  description: string;
  icon: React.ElementType;
  done: boolean;
  optional?: boolean;
  cta: { label: string; onClick: () => void } | null;
  doneLabel?: string;
}

interface OnboardingSetupCardProps {
  onOpenPaymentMethods?: () => void;
  onOpenSettings?: () => void;
}

export function OnboardingSetupCard({
  onOpenSettings,
}: OnboardingSetupCardProps) {
  const { enabled, status, skip } = useOnboarding();
  const router = useRouter();

  if (!enabled || !status) return null;
  if (status.skipped_at) return null;

  const conditions = status.conditions;

  const allConditionsMet =
    conditions.usernameSet &&
    conditions.walletConnected &&
    conditions.inrRateSet &&
    conditions.hasTrade;
  if (allConditionsMet) return null;

  const requiredDone =
    conditions.walletConnected &&
    conditions.inrRateSet;

  const steps: StepView[] = [
    {
      key: 'wallet',
      label: 'Connect Wallet',
      description: 'Link your Solana wallet to secure your account.',
      icon: Wallet,
      done: conditions.walletConnected,
      doneLabel: 'Connected',
      cta: conditions.walletConnected
        ? null
        : { label: 'Connect', onClick: () => router.push('/market/wallet') },
    },
    {
      key: 'inr-rate',
      label: 'Set INR Rate',
      description: 'Set your buy/sell rate for the India corridor.',
      icon: TrendingUp,
      done: conditions.inrRateSet,
      doneLabel: 'Set',
      cta: conditions.inrRateSet
        ? null
        : { label: 'Set Rate', onClick: () => router.push('/market/settings?tab=rates') },
    },
    {
      key: 'trade',
      label: 'Accept First Trade',
      description: 'Accept your first order to complete setup.',
      icon: Zap,
      done: conditions.hasTrade,
      doneLabel: 'Done',
      optional: true,
      cta: null,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const totalRequired = steps.filter((s) => !s.optional).length;
  const requiredDoneCount = steps.filter((s) => !s.optional && s.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="mx-1.5 mt-1.5 rounded-2xl overflow-hidden border border-white/[0.08] bg-white/[0.03]">

      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[9.5px] font-mono font-bold uppercase tracking-widest text-white/30 mb-1">
              Getting Started
            </p>
            <h3 className="text-[13px] font-bold text-white leading-tight">
              Merchant Setup
            </h3>
            <p className="text-[10.5px] text-white/40 mt-0.5">
              {requiredDone
                ? "Required steps complete — you're live."
                : `${requiredDoneCount} of ${totalRequired} required steps done`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void skip()}
            aria-label="Dismiss"
            className="mt-0.5 p-1 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/[0.05] transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-[3px] w-full rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-white/50 transition-all duration-700"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] text-white/20 font-mono">{percent}% complete</span>
          <span className="text-[9px] text-white/20 font-mono">{doneCount} / {steps.length} steps</span>
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-white/[0.04]">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                step.done ? 'opacity-40' : 'hover:bg-white/[0.02]'
              }`}
            >
              {/* Icon */}
              <div
                className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
                  step.done
                    ? 'bg-white/[0.06] border border-white/10'
                    : 'bg-white/[0.05] border border-white/[0.08]'
                }`}
              >
                {step.done ? (
                  <Check className="w-3.5 h-3.5 text-white/60" strokeWidth={2.5} />
                ) : (
                  <Icon className="w-3.5 h-3.5 text-white/40" />
                )}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[12px] font-semibold leading-tight ${step.done ? 'text-white/30 line-through' : 'text-white/90'}`}>
                    {step.label}
                  </span>
                  {step.optional && !step.done && (
                    <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-px rounded bg-white/[0.05] text-white/25 border border-white/[0.06]">
                      Optional
                    </span>
                  )}
                </div>
                {!step.done && (
                  <p className="text-[10px] text-white/30 mt-0.5 leading-snug truncate">
                    {step.description}
                  </p>
                )}
              </div>

              {/* CTA */}
              <div className="shrink-0">
                {step.done ? (
                  <span className="text-[9.5px] text-white/30 font-mono">✓</span>
                ) : step.cta ? (
                  <div className="group relative">
                    <button
                      type="button"
                      onClick={step.cta.onClick}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.09] hover:border-white/20 px-2.5 py-1.5 text-[10.5px] font-semibold text-white/70 hover:text-white transition-all"
                    >
                      {step.cta.label}
                      <ArrowRight className="w-2.5 h-2.5" />
                    </button>
                    <span className="pointer-events-none absolute bottom-full right-0 mb-2 w-max max-w-[160px] opacity-0 group-hover:opacity-100 transition-opacity z-50">
                      <span className="block rounded-lg bg-white text-black text-[10.5px] font-medium px-2.5 py-1.5 leading-snug shadow-xl shadow-black/40">
                        {step.description}
                      </span>
                    </span>
                  </div>
                ) : (
                  <span className="text-[9px] font-mono text-white/15">{idx + 1}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer — only when live */}
      {requiredDone && (
        <div className="px-4 py-2.5 border-t border-white/[0.06]">
          <p className="text-[10px] text-white/40 flex items-center gap-1.5 font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/40 animate-pulse" />
            Live in marketplace
          </p>
        </div>
      )}
    </div>
  );
}
