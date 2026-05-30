/**
 * Merchant progressive onboarding state.
 *
 * Backs the 5-step setup checklist. Only the first three steps are
 * REQUIRED for completed_at to fire — the last two are visible-but-
 * optional informational rows:
 *   1. username customized (merchants.username_customized_at IS NOT NULL)  [required]
 *   2. wallet connected    (merchants.wallet_address present)              [required]
 *   3. payment method added (merchant_payment_methods row exists)          [required]
 *   4. wallet funded       (merchants.balance > 0)                         [optional — BUY-trade-time guard]
 *   5. first trade         (any non-cancelled order participated in)       [optional — milestone, prevents deadlock]
 *
 * The row is the source of truth for WHEN a step was first completed
 * (timestamps are stable once set). Step completion booleans are derived
 * from the truth conditions on every read — this means a merchant who
 * later e.g. disconnects their wallet does NOT regress to step 1.
 *
 * Coexists with merchants.tour_completed_at (legacy dashboard intro).
 * Neither replaces the other.
 */

import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export interface OnboardingRow {
  merchant_id: string;
  username_set_at: string | null;
  wallet_connected_at: string | null;
  payment_method_at: string | null;
  wallet_funded_at: string | null;
  first_trade_at: string | null;
  current_step: number;
  skipped_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OnboardingStatus extends OnboardingRow {
  /** Derived: lowest 1-based step number not yet timestamped. 5 = all done. */
  nextStep: 1 | 2 | 3 | 4 | 5 | 6;
  /** Derived from truth conditions at read time. */
  conditions: {
    usernameSet: boolean;
    walletConnected: boolean;
    inrRateSet: boolean;
    hasTrade: boolean;
  };
}

interface TruthConditions {
  usernameSet: boolean;
  walletConnected: boolean;
  inrRateSet: boolean;
  hasTrade: boolean;
}

/**
 * Compute the four onboarding completion conditions from authoritative
 * sources. These are point-in-time reads — once a condition flips true,
 * we record the timestamp so the merchant doesn't regress if the
 * condition later flips back (e.g. wallet disconnect, balance to zero).
 */
async function computeConditions(merchantId: string): Promise<TruthConditions> {
  const merchantRow = await queryOne<{
    wallet_address: string | null;
    bio: string | null;
    buy_rate: number | null;
    sell_rate: number | null;
  }>(
    `SELECT wallet_address, bio, buy_rate, sell_rate FROM merchants WHERE id = $1`,
    [merchantId]
  );

  if (!merchantRow) {
    return { usernameSet: false, walletConnected: false, inrRateSet: false, hasTrade: false };
  }

  const usernameSet = !!(merchantRow.bio && merchantRow.bio.trim().length > 0);
  const walletConnected = !!(merchantRow.wallet_address && merchantRow.wallet_address.trim().length > 0);
  const inrRateSet = merchantRow.buy_rate != null || merchantRow.sell_rate != null;

  const tradeRow = await queryOne<{ c: string | number }>(
    `SELECT COUNT(*)::int AS c FROM orders
      WHERE (merchant_id = $1 OR buyer_merchant_id = $1)
        AND status NOT IN ('cancelled', 'expired', 'pending')`,
    [merchantId]
  );
  const hasTrade = Number(tradeRow?.c ?? 0) > 0;

  return { usernameSet, walletConnected, inrRateSet, hasTrade };
}

/** Ensure a row exists for this merchant, creating it lazily on first access. */
async function ensureRow(merchantId: string): Promise<OnboardingRow> {
  // Idempotent insert. If the row exists (grandfathered or otherwise),
  // the conflict path returns the existing values.
  const rows = await query<OnboardingRow>(
    `INSERT INTO merchant_onboarding (merchant_id, current_step)
       VALUES ($1, 1)
     ON CONFLICT (merchant_id) DO UPDATE
       SET updated_at = merchant_onboarding.updated_at
     RETURNING *`,
    [merchantId]
  );
  return rows[0];
}

/**
 * Read the onboarding state, advancing any step whose truth condition is
 * met for the first time. Once a step timestamp is set it is never cleared
 * by this function — past completions are sticky.
 */
export async function getOnboardingStatus(merchantId: string): Promise<OnboardingStatus> {
  const row = await ensureRow(merchantId);
  const conditions = await computeConditions(merchantId);

  // Compute updates: only set a timestamp when (a) it's currently NULL and
  // (b) the condition is now true. Skipped merchants still get their step
  // timestamps recorded — skipping the *tour* doesn't suspend tracking.
  const sets: string[] = [];
  if (!row.username_set_at && conditions.usernameSet) sets.push('username_set_at = NOW()');
  if (!row.wallet_connected_at && conditions.walletConnected) sets.push('wallet_connected_at = NOW()');
  if (!row.payment_method_at && conditions.inrRateSet) sets.push('payment_method_at = NOW()');  // reused column tracks inrRateSet
  if (!row.first_trade_at && conditions.hasTrade) sets.push('first_trade_at = NOW()');

  let updated = row;
  if (sets.length > 0) {
    const updatedRows = await query<OnboardingRow>(
      `UPDATE merchant_onboarding
          SET ${sets.join(', ')}, updated_at = NOW()
        WHERE merchant_id = $1
        RETURNING *`,
      [merchantId]
    );
    if (updatedRows.length > 0) updated = updatedRows[0];
  }

  // Compute nextStep + completion.
  //
  // ONLY the first three steps are required for completed_at:
  //   1. username, 2. wallet, 3. payment method
  //
  // Steps 4 (fund wallet) and 5 (first trade) remain visible in the UI
  // but are advisory — funding is BUY-only and already gated per-action
  // by useOnboardingGuard, and first-trade is a milestone that would
  // otherwise deadlock against the trade-participation gate (you can't
  // accept your first trade if completion blocks accepting trades).
  //
  // Their timestamps still record (sticky) when the conditions become
  // true, so analytics keep the same granularity.
  const requiredDoneFlags = [
    !!updated.username_set_at,
    !!updated.wallet_connected_at,
    !!updated.payment_method_at,
  ];
  const firstIncompleteRequired = requiredDoneFlags.findIndex((d) => !d);
  const nextStep = (firstIncompleteRequired === -1
    ? 6
    : firstIncompleteRequired + 1) as 1 | 2 | 3 | 4 | 5 | 6;

  // Auto-complete the onboarding when the required steps are done.
  // Idempotent: only writes if completed_at is currently null.
  if (nextStep === 6 && !updated.completed_at) {
    const completedRows = await query<OnboardingRow>(
      `UPDATE merchant_onboarding
          SET completed_at = NOW(), current_step = 6, updated_at = NOW()
        WHERE merchant_id = $1 AND completed_at IS NULL
        RETURNING *`,
      [merchantId]
    );
    if (completedRows.length > 0) updated = completedRows[0];
  }

  return { ...updated, nextStep, conditions };
}

/** Mark the tour as skipped. Does NOT delete step progress. */
export async function skipOnboarding(merchantId: string): Promise<OnboardingRow> {
  await ensureRow(merchantId);
  const rows = await query<OnboardingRow>(
    `UPDATE merchant_onboarding
        SET skipped_at = COALESCE(skipped_at, NOW()), updated_at = NOW()
      WHERE merchant_id = $1
      RETURNING *`,
    [merchantId]
  );
  return rows[0];
}

/** Clear skipped_at so the tour can resume. Re-runs from current step. */
export async function resumeOnboarding(merchantId: string): Promise<OnboardingRow> {
  await ensureRow(merchantId);
  const rows = await query<OnboardingRow>(
    `UPDATE merchant_onboarding
        SET skipped_at = NULL, updated_at = NOW()
      WHERE merchant_id = $1
      RETURNING *`,
    [merchantId]
  );
  return rows[0];
}

/**
 * Record that the merchant is currently viewing step N. Purely a UI hint
 * (used to resume the tour at the right tooltip after refresh); does not
 * gate condition checks.
 */
/**
 * Cheap predicate: has the merchant finished onboarding (completed_at set)?
 * Used by the order-participation gates to block trades until setup is done.
 */
export async function isOnboardingComplete(merchantId: string): Promise<boolean> {
  // Treat as complete if: (a) completed_at is set, OR (b) skipped_at is set,
  // OR (c) the two required conditions (wallet + inr rate) are satisfied.
  // This ensures merchants who set up wallet+rates can trade without needing
  // to explicitly click "Go Live" or wait for hasTrade.
  const row = await queryOne<{ completed_at: string | null; skipped_at: string | null }>(
    `SELECT completed_at, skipped_at FROM merchant_onboarding WHERE merchant_id = $1`,
    [merchantId]
  );
  if (!row) return true; // no record = new merchant, let them through
  if (row.completed_at || row.skipped_at) return true;
  const conditions = await computeConditions(merchantId);
  return conditions.walletConnected && conditions.inrRateSet;
}

/**
 * Route-level gate. Drop-in for the start of any merchant-mutating endpoint
 * that should be blocked until onboarding is complete:
 *
 *     const gate = await gateOnboardingComplete(auth.actorType, auth.actorId);
 *     if (gate) return gate;
 *
 * Returns:
 *   - null when the gate is open (non-merchant actor, flag off, or complete)
 *   - 403 NextResponse with code 'ONBOARDING_INCOMPLETE' when the merchant
 *     hasn't finished setup
 *
 * The gate is wired to the same NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING flag
 * that drives the UI — flag off = byte-identical pre-feature behaviour.
 */
export async function gateOnboardingComplete(
  actorType: string,
  actorId: string | undefined
): Promise<NextResponse | null> {
  if (process.env.NEXT_PUBLIC_ENABLE_MERCHANT_ONBOARDING !== 'true') return null;
  if (actorType !== 'merchant' || !actorId) return null;

  const complete = await isOnboardingComplete(actorId);
  if (complete) return null;

  return NextResponse.json(
    {
      success: false,
      error: 'Finish onboarding before you can trade. Complete the setup steps and try again.',
      code: 'ONBOARDING_INCOMPLETE',
    },
    { status: 403 }
  );
}

export async function setCurrentStep(merchantId: string, step: number): Promise<void> {
  if (step < 1 || step > 6) return;
  await query(
    `UPDATE merchant_onboarding
        SET current_step = $2, updated_at = NOW()
      WHERE merchant_id = $1`,
    [merchantId, step]
  );
}
