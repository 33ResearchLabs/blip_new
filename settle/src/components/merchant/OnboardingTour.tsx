'use client';

/**
 * Progressive 4-step setup tour for first-time merchants.
 *
 * Reads state from OnboardingContext; renders react-joyride tooltips
 * attached to real dashboard elements via data-tour anchors.
 *
 * The step list is built dynamically so the tour only shows tooltips
 * for steps whose truth conditions are NOT YET met. A merchant who
 * connected their wallet before this feature shipped won't see the
 * "connect your wallet" tooltip — they jump straight to step 2.
 *
 * Coexists with the legacy MerchantTour (one-shot dashboard intro):
 * the progressive setup tour gates on its own flag and won't conflict
 * with the welcome tour's data-tour targets.
 */

import { useEffect, useMemo, useState } from 'react';
import type { EventData, Step } from 'react-joyride';
import { useOnboarding } from '@/contexts/OnboardingContext';

interface StepDef {
  key: 'customize-username' | 'connect-wallet' | 'accept-trade';
  target: string;
  title: string;
  content: string;
}

// INR rate is an optional onboarding step with no setup UI (the rates tab was
// removed), so it's omitted from the guided tour — its target no longer exists.
const ALL_STEPS: StepDef[] = [
  {
    key: 'customize-username',
    target: '[data-tour="customize-username"]',
    title: 'Step 1 of 3 — Set Your Username',
    content: 'Pick a username — this is how traders will recognize you in the marketplace.',
  },
  {
    key: 'connect-wallet',
    target: '[data-tour="connect-wallet"]',
    title: 'Step 2 of 3 — Connect Wallet',
    content: 'Connect your wallet to start trading securely.',
  },
  {
    key: 'accept-trade',
    target: '[data-tour="pending-panel"]',
    title: 'Step 3 of 3 — Accept First Trade',
    content: 'Accept your first trade to start using the platform.',
  },
];

const TOUR_STYLES = {
  options: {
    primaryColor: '#ff8a4c',
    backgroundColor: '#1a1a1a',
    textColor: '#ffffff',
    arrowColor: '#1a1a1a',
    overlayColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 9999,
    width: 320,
  },
  tooltip: {
    borderRadius: 12,
    fontSize: 13,
    padding: 16,
    backgroundColor: '#1a1a1a',
    color: '#ffffff',
  },
  tooltipContainer: {
    textAlign: 'left' as const,
  },
  tooltipTitle: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 8,
    color: '#ffffff',
  },
  tooltipContent: {
    padding: 0,
    fontSize: 13,
    lineHeight: '1.5',
    color: 'rgba(255,255,255,0.85)',
  },
  buttonNext: {
    borderRadius: 8,
    fontSize: 13,
    padding: '8px 16px',
    backgroundColor: '#ff8a4c',
    color: '#000',
    fontWeight: 600,
  },
  buttonBack: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    marginRight: 8,
  },
  buttonSkip: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },
  buttonClose: {
    color: 'rgba(255,255,255,0.4)',
  },
};

const TOUR_LOCALE = {
  back: 'Back',
  close: 'Close',
  last: 'Done',
  next: 'Next',
  skip: 'Skip for now',
};

export function OnboardingTour() {
  const { enabled, status, skip, refresh, setStep } = useOnboarding();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [JoyrideCmp, setJoyrideCmp] = useState<any>(null);

  // Lazy-load react-joyride client-side only.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    let cancelled = false;
    import('react-joyride')
      .then((mod) => {
        if (!cancelled) setJoyrideCmp(() => mod.Joyride);
      })
      .catch((err) => {
        console.warn('[OnboardingTour] Failed to load react-joyride:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Build the active step list: only steps whose condition is NOT YET
  // met. Already-done steps are skipped entirely (no tooltip), so a
  // returning merchant resumes at the right spot.
  const activeSteps = useMemo<Step[]>(() => {
    if (!status) return [];
    const conditions = status.conditions;
    const conditionFor: Record<StepDef['key'], boolean> = {
      'customize-username': conditions.usernameSet,
      'connect-wallet': conditions.walletConnected,
      'accept-trade': conditions.hasTrade,
    };
    return ALL_STEPS.filter((s) => !conditionFor[s.key]).map((s) => ({
      target: s.target,
      title: s.title,
      content: s.content,
      placement: 'auto' as const,
      disableBeacon: true,
    }));
  }, [status]);

  // Decide whether the tour should run right now. Conditions to start:
  //   - Feature flag enabled
  //   - Status loaded
  //   - Not skipped, not completed
  //   - At least one incomplete step
  const shouldRun =
    enabled &&
    !!status &&
    !status.skipped_at &&
    !status.completed_at &&
    activeSteps.length > 0;

  const handleCallback = (data: EventData) => {
    const { status: joyStatus, action, index, type } = data;

    // Record which step the user is currently viewing so a refresh
    // restores the tour at the correct tooltip.
    if (type === 'step:after' || type === 'tour:start') {
      void setStep(index + 1);
    }

    // STATUS.FINISHED / STATUS.SKIPPED — both flagged 'skipped' in our
    // model since "finished" just means the user closed the tour without
    // necessarily completing every condition. Completion is condition-
    // driven and tracked separately on every status refresh.
    if (joyStatus === 'finished' || joyStatus === 'skipped' || action === 'close') {
      void skip();
    }

    // After any visible step transition, re-fetch in case the merchant
    // satisfied a condition mid-tour (e.g. connected wallet in another
    // tab). Cheap — one indexed read.
    if (type === 'step:after') {
      void refresh();
    }
  };

  // Tour is disabled — onboarding is handled via the setup card tooltips.
  return null;
}
