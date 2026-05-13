'use client';

/**
 * Glanceable "Setup incomplete" chip for the merchant navbar.
 *
 * Sits next to the notification bell so the reminder is always in the
 * merchant's peripheral vision. Tapping it reopens the OnboardingOverlay
 * — works whether the merchant has skipped or just dismissed it.
 *
 * Renders nothing when:
 *   - Feature flag disabled
 *   - Status not loaded
 *   - Onboarding completed (completed_at set)
 *
 * Required-step accounting matches the rest of the system: 3 required
 * (username + wallet + payment), 2 optional (fund + first trade).
 */

import { Sparkles } from 'lucide-react';
import { useOnboarding } from '@/contexts/OnboardingContext';

interface OnboardingSetupChipProps {
  /**
   * Compact variant collapses the label to just the counter on narrow
   * screens / cramped layouts (the mobile navbar). Default false.
   */
  compact?: boolean;
}

export function OnboardingSetupChip({ compact = false }: OnboardingSetupChipProps) {
  const { enabled, status, resume } = useOnboarding();

  if (!enabled || !status) return null;
  if (status.completed_at) return null;

  const doneCount = [
    status.conditions.usernameSet,
    status.conditions.walletConnected,
    status.conditions.hasPaymentMethod,
  ].filter(Boolean).length;

  // Clicking calls resume() unconditionally: when skipped, this clears
  // skipped_at and the overlay returns. When not skipped, the overlay
  // is already visible but resume() is a no-op (skipped_at already null),
  // so the call is safe.
  const handleClick = () => {
    void resume();
  };

  const totalRequired = 3;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Setup incomplete — ${doneCount} of ${totalRequired} steps done. Tap to finish.`}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[#ff8a4c]/40 bg-[#ff8a4c]/[0.08] text-[#ff8a4c] hover:bg-[#ff8a4c]/[0.15] hover:border-[#ff8a4c]/60 transition-colors ${
        compact ? 'px-2 py-1' : 'px-2.5 py-1'
      }`}
    >
      <Sparkles className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {!compact && (
        <span className="text-[11px] font-semibold tracking-wide">Setup</span>
      )}
      <span className="text-[11px] font-mono font-bold tabular-nums">
        {doneCount}/{totalRequired}
      </span>
    </button>
  );
}
