'use client';

/**
 * Progressive merchant onboarding — context + hooks.
 *
 * Owns the 4-step setup state for first-time merchants:
 *   1. Connect wallet
 *   2. Add payment method
 *   3. Fund wallet with USDT
 *   4. Accept first trade
 *
 * Source of truth lives in the DB (table: merchant_onboarding). The
 * server validates conditions against authoritative state (wallet
 * address, payment method count, balance, order participation), so
 * the client cannot lie about completion.
 *
 * Feature flag: NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING. When false
 * (default), the provider is a transparent passthrough — no fetches,
 * no UI, no behavioral change. This is the zero-regression contract.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

export interface OnboardingConditions {
  usernameSet: boolean;
  walletConnected: boolean;
  hasPaymentMethod: boolean;
  walletFunded: boolean;
  hasTrade: boolean;
}

export interface OnboardingStatus {
  merchant_id: string;
  username_set_at: string | null;
  wallet_connected_at: string | null;
  payment_method_at: string | null;
  wallet_funded_at: string | null;
  first_trade_at: string | null;
  current_step: number;
  skipped_at: string | null;
  completed_at: string | null;
  nextStep: 1 | 2 | 3 | 4 | 5 | 6;
  conditions: OnboardingConditions;
}

interface OnboardingContextValue {
  /** Whether the feature is enabled at all (kill switch). */
  enabled: boolean;
  /** Latest server state, or null while loading / when disabled. */
  status: OnboardingStatus | null;
  /** True while the first fetch is in flight. */
  loading: boolean;
  /** Re-fetch the status (used after a step-completing user action). */
  refresh: () => Promise<void>;
  /** Hide the tour, keep progress. */
  skip: () => Promise<void>;
  /** Re-show the tour from the current incomplete step. */
  resume: () => Promise<void>;
  /** Record which step the merchant is currently viewing in the tour. */
  setStep: (step: number) => Promise<void>;
}

const FLAG_ENABLED = process.env.NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING === 'true';

const OnboardingContext = createContext<OnboardingContextValue>({
  enabled: false,
  status: null,
  loading: false,
  refresh: async () => {},
  skip: async () => {},
  resume: async () => {},
  setStep: async () => {},
});

interface OnboardingProviderProps {
  /** Authenticated merchant id. Null = not logged in / not a merchant. */
  merchantId: string | null;
  children: ReactNode;
}

export function OnboardingProvider({ merchantId, children }: OnboardingProviderProps) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(false);

  // Guard against state updates after unmount or merchant switch. A change
  // of merchantId discards in-flight responses for the previous merchant.
  const merchantIdRef = useRef(merchantId);
  useEffect(() => {
    merchantIdRef.current = merchantId;
  }, [merchantId]);

  const refresh = useCallback(async () => {
    if (!FLAG_ENABLED || !merchantId) return;
    const requestedFor = merchantId;
    setLoading(true);
    try {
      const res = await fetchWithAuth('/api/onboarding/status');
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      if (!json?.success || !json.data) return;
      // Discard if the merchant changed mid-flight.
      if (merchantIdRef.current !== requestedFor) return;
      setStatus(json.data as OnboardingStatus);
    } catch {
      // best-effort — onboarding is non-critical telemetry on every load
    } finally {
      if (merchantIdRef.current === requestedFor) setLoading(false);
    }
  }, [merchantId]);

  // Initial load + reload when the merchant changes (e.g. logout/login).
  useEffect(() => {
    if (!FLAG_ENABLED) return;
    if (!merchantId) {
      setStatus(null);
      return;
    }
    void refresh();
  }, [merchantId, refresh]);

  // Auto-refresh strategy — catches side-flow completions the user
  // performed without clicking an onboarding CTA (e.g. opening the
  // payment-methods modal directly, connecting a wallet via the
  // dashboard's existing flow, funding their balance).
  //
  // - Window focus / visibility change → user came back to the tab
  // - 20s poll while status is loaded AND onboarding is incomplete →
  //   bounded interval, stops the moment completed_at is set
  const isIncomplete = !!status && !status.completed_at;
  useEffect(() => {
    if (!FLAG_ENABLED || !merchantId || !isIncomplete) return;

    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    const interval = setInterval(() => { void refresh(); }, 20_000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(interval);
    };
  }, [merchantId, isIncomplete, refresh]);

  const skip = useCallback(async () => {
    if (!FLAG_ENABLED || !merchantId) return;
    // Optimistic update so the tour disappears instantly.
    setStatus((prev) => (prev ? { ...prev, skipped_at: new Date().toISOString() } : prev));
    try {
      await fetchWithAuth('/api/onboarding/skip', { method: 'POST' });
    } catch {
      // Server reconciliation on next refresh.
    }
  }, [merchantId]);

  const resume = useCallback(async () => {
    if (!FLAG_ENABLED || !merchantId) return;
    setStatus((prev) => (prev ? { ...prev, skipped_at: null } : prev));
    try {
      await fetchWithAuth('/api/onboarding/resume', { method: 'POST' });
    } catch {
      // ignore
    }
  }, [merchantId]);

  const setStep = useCallback(async (step: number) => {
    if (!FLAG_ENABLED || !merchantId) return;
    try {
      await fetchWithAuth('/api/onboarding/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step }),
      });
    } catch {
      // ignore — purely a UI hint
    }
  }, [merchantId]);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      enabled: FLAG_ENABLED,
      status,
      loading,
      refresh,
      skip,
      resume,
      setStep,
    }),
    [status, loading, refresh, skip, resume, setStep]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  return useContext(OnboardingContext);
}

/**
 * Guard hook for trade-action UI. Returns whether the requested action
 * is allowed given current onboarding state, plus a user-facing reason
 * when blocked. Does NOT itself prevent the action — callers wire
 * `allowed` to button `disabled` and `reason` to a tooltip.
 *
 * The authoritative gate lives on the server (gateOnboardingComplete in
 * the merchantOnboarding repository); this hook is a fast UI mirror so
 * buttons can disable before the user fires off a doomed request.
 *
 * When the feature flag is OFF, all actions are allowed (zero regression).
 */
export type GuardedAction = 'trade' | 'create-buy-order' | 'create-sell-order';

export function useOnboardingGuard(action: GuardedAction): {
  allowed: boolean;
  reason: string | null;
} {
  const { enabled, status } = useOnboarding();

  if (!enabled || !status) {
    return { allowed: true, reason: null };
  }

  // Primary gate: until the 5-step setup is fully complete, the merchant
  // cannot place or accept trades. Grandfathered merchants pass because
  // their completed_at is set via migration 121's backfill.
  if (!status.completed_at) {
    return {
      allowed: false,
      reason: 'Finish onboarding before you can trade. Complete the setup steps to unlock.',
    };
  }

  const { conditions } = status;

  // Post-completion fall-throughs: catch regressions (wallet disconnected,
  // balance drained) so the UI still surfaces the right reason rather than
  // letting the server return a generic balance error.
  if (!conditions.walletConnected) {
    return { allowed: false, reason: 'Reconnect your wallet to keep trading.' };
  }

  if (action === 'create-buy-order' && !conditions.walletFunded) {
    return {
      allowed: false,
      reason: 'Fund your wallet with USDT to accept BUY trades.',
    };
  }

  return { allowed: true, reason: null };
}
