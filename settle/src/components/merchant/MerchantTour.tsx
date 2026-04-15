'use client';

/**
 * Merchant onboarding tour — guided walkthrough of the dashboard.
 *
 * Triggered by useMerchantTour hook when NEXT_PUBLIC_ENABLE_APP_TOUR=true
 * and the merchant hasn't completed the tour yet.
 *
 * Target elements are selected via `data-tour="..."` attributes.
 */

import { useEffect, useState } from 'react';
import type { EventData, Step } from 'react-joyride';

interface MerchantTourProps {
  run: boolean;
  onComplete: () => void;
}

const TOUR_STEPS: Step[] = [
  {
    target: 'body',
    placement: 'center',
    title: 'Welcome to Blip Money 👋',
    content: "Let's take a quick 30-second tour so you know where everything is. You can skip anytime.",
  },
  {
    target: '[data-tour="status-card"]',
    title: 'Your Balance',
    content: 'Your available USDT balance and 24h earnings. Funds locked in active escrow are tracked separately.',
    placement: 'auto',
  },
  {
    target: '[data-tour="corridor-pair"]',
    title: 'Corridor Pair',
    content: 'Pick the market — USDT/AED for UAE Dirham or USDT/INR for Indian Rupee.',
    placement: 'auto',
  },
  {
    target: '[data-tour="spread"]',
    title: 'Spread (Profit Margin)',
    content: 'Fast = quick match, less profit. Cheap = highest profit, slower match.',
    placement: 'auto',
  },
  {
    target: '[data-tour="boost"]',
    title: 'Boost (Priority Fee)',
    content: 'Pushes your order ahead of other merchants. Higher boost = faster match in busy markets.',
    placement: 'auto',
  },
  {
    target: '[data-tour="pending-panel"]',
    title: 'Pending Orders',
    content: 'Orders waiting to be accepted. Click one to see details or accept it.',
    placement: 'auto',
  },
  {
    target: '[data-tour="inprogress-panel"]',
    title: 'Active Trades',
    content: "Orders you're currently handling — lock escrow, send payment, or confirm receipt here.",
    placement: 'auto',
  },
  {
    target: '[data-tour="leaderboard"]',
    title: 'Leaderboard',
    content: 'Top merchants by volume. Competitive spreads and fast responses help you climb.',
    placement: 'auto',
  },
  {
    target: 'body',
    placement: 'center',
    title: "You're all set! 🎉",
    content: 'Good luck trading!',
  },
];

const TOUR_STYLES = {
  options: {
    primaryColor: '#ff8a4c',
    backgroundColor: '#1a1a1a',
    textColor: '#ffffff',
    arrowColor: '#1a1a1a',
    overlayColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 10000,
    width: 300,
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
    fontSize: 15,
    fontWeight: 700,
    marginBottom: 8,
    color: '#ffffff',
  },
  tooltipContent: {
    padding: 0,
    fontSize: 13,
    lineHeight: '1.5',
    color: 'rgba(255,255,255,0.8)',
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
  last: 'Finish',
  next: 'Next',
  skip: 'Skip tour',
};

export function MerchantTour({ run, onComplete }: MerchantTourProps) {
  // Load Joyride lazily on the client only (window access required)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [JoyrideCmp, setJoyrideCmp] = useState<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    import('react-joyride').then((mod) => {
      if (!cancelled) setJoyrideCmp(() => mod.Joyride);
    }).catch((err) => {
      console.warn('[MerchantTour] Failed to load react-joyride:', err);
    });
    return () => { cancelled = true; };
  }, []);

  const handleCallback = (data: EventData) => {
    const status = data.status;
    // STATUS.FINISHED = 'finished', STATUS.SKIPPED = 'skipped'
    if (status === 'finished' || status === 'skipped') {
      onComplete();
    }
  };

  if (!JoyrideCmp) return null;

  return (
    <JoyrideCmp
      steps={TOUR_STEPS}
      run={run}
      continuous
      showProgress
      showSkipButton
      disableScrolling={false}
      scrollToFirstStep
      scrollOffset={80}
      spotlightPadding={6}
      floaterProps={{
        disableAnimation: false,
        offset: 16,
        styles: {
          floater: {
            filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.4))',
          },
        },
      }}
      callback={handleCallback}
      styles={TOUR_STYLES}
      locale={TOUR_LOCALE}
    />
  );
}
