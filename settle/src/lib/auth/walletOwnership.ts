/**
 * Wallet-ownership verification for order mutations.
 *
 * Closes the buyer/acceptor wallet-address injection vulnerability: any route
 * that accepts a wallet address from the request body and later uses it as
 * a crypto payout destination MUST run one of these checks first.
 *
 * Two paths, in priority order:
 *   Option A (preferred) — wallet equals the authenticated actor's wallet on
 *     file (users.wallet_address / merchants.wallet_address). This is the
 *     happy path; no extra signing required from the caller.
 *   Option B (escape hatch) — caller signs
 *     `${action} order ${orderId} - I will send fiat payment. Wallet: ${walletAddr}`
 *     and submits the signature in `acceptor_wallet_signature`. The format
 *     matches what the existing frontend at useOrderActions.ts already
 *     produces, so this isn't a new client contract — just turning on the
 *     verification that was already supposed to happen.
 *
 * Backward compatibility: WALLET_OWNERSHIP_STRICT controls the failure mode.
 *   strict=false (default during rollout) → mismatch logs WARN and is
 *     allowed through, so existing in-flight orders and old clients don't
 *     break the day this ships.
 *   strict=true → mismatch is a hard 403. Flip after the warn-rate trends
 *     to zero.
 *
 * Pure-ish module: only side effects are DB reads (wallet lookups) and
 * structured warn-logs. No writes, no transactions.
 */

import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { verifyWalletSignature } from '@/lib/solana/verifySignature';

export type ActorType = 'user' | 'merchant' | 'compliance' | 'system';

export interface AuthLike {
  actorType: ActorType | string;
  actorId: string;
}

/**
 * Strict mode. Default OFF during the dual-mode rollout — flip to `true`
 * after the [security][wallet_inject] warn-rate falls to zero in prod.
 */
export function isWalletOwnershipStrict(): boolean {
  return process.env.WALLET_OWNERSHIP_STRICT === 'true';
}

/**
 * Look up the verified wallet on file for the authenticated actor.
 * Returns null when the actor has no wallet (e.g. email-only login users)
 * or the actor type can't own a wallet (`system`, `compliance`).
 */
export async function getActorWallet(auth: AuthLike): Promise<string | null> {
  if (auth.actorType === 'user') {
    const rows = await query<{ wallet_address: string | null }>(
      'SELECT wallet_address FROM users WHERE id = $1',
      [auth.actorId]
    );
    return rows[0]?.wallet_address ?? null;
  }
  if (auth.actorType === 'merchant') {
    const rows = await query<{ wallet_address: string | null }>(
      'SELECT wallet_address FROM merchants WHERE id = $1',
      [auth.actorId]
    );
    return rows[0]?.wallet_address ?? null;
  }
  return null;
}

/** Constant-time-friendly equality on base58 wallet strings. */
function walletEq(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a === b;
}

/**
 * Canonical message format for Option B order-binding signatures.
 * Matches the frontend's existing message format (see useOrderActions.ts:382)
 * so we don't need a separate signing pass on the client.
 */
export function buildOrderBindingMessage(
  action: 'Claim' | 'Confirm',
  orderId: string,
  walletAddress: string
): string {
  return `${action} order ${orderId} - I will send fiat payment. Wallet: ${walletAddress}`;
}

export interface OwnershipVerification {
  ok: boolean;
  source: 'auth_match' | 'signature' | 'no_check_needed' | 'lax_allowed';
  reason?: string;
}

export interface AssertWalletOwnershipInput {
  auth: AuthLike;
  /** The wallet supplied in the request body. */
  walletAddress: string | null | undefined;
  /** Order id, when known (required for Option B signature path). */
  orderId?: string;
  /** Optional signature for Option B (over the canonical binding message). */
  signature?: string | null;
  /** Which action is being signed — affects message format. */
  signatureAction?: 'Claim' | 'Confirm';
  /**
   * If true, this call is happening for a sensitive operation (release,
   * payout, accept-with-funds) and the strict-mode failure should be 403
   * regardless of WALLET_OWNERSHIP_STRICT. Used at escrow release to
   * never let unverified wallets past the final gate.
   */
  alwaysStrict?: boolean;
}

/**
 * Decide whether to allow `walletAddress` to be associated with an order
 * mutation by `auth`. Centralises the Option A / Option B / lax-mode logic
 * so the routes don't replicate it.
 *
 * Routes call this BEFORE persisting the wallet or proxying to core-api.
 * On `ok: false`, return 403 to the caller; on `ok: true` with
 * `source === 'lax_allowed'`, the warn log has already been emitted.
 */
export async function assertWalletOwnership(
  input: AssertWalletOwnershipInput
): Promise<OwnershipVerification> {
  const { auth, walletAddress, orderId, signature, signatureAction, alwaysStrict } = input;

  // Empty/absent wallet: nothing to verify. Caller decides whether the
  // wallet was required at all.
  if (!walletAddress) {
    return { ok: true, source: 'no_check_needed' };
  }

  const actorWallet = await getActorWallet(auth);

  // ── Option A: wallet matches the actor's verified wallet on file ────
  if (walletEq(actorWallet, walletAddress)) {
    return { ok: true, source: 'auth_match' };
  }

  // ── Option B: signature over canonical binding message ─────────────
  if (signature && orderId && signatureAction) {
    const msg = buildOrderBindingMessage(signatureAction, orderId, walletAddress);
    const valid = await verifyWalletSignature(walletAddress, signature, msg);
    if (valid) {
      logger.info('[security][wallet_inject] Option B signature verified — non-auth wallet allowed', {
        orderId,
        actorId: auth.actorId,
        actorType: auth.actorType,
        walletAddress,
      });
      return { ok: true, source: 'signature' };
    }
    // Signature provided but invalid — treat as a hard reject regardless
    // of strict mode. A bad signature is never legitimate.
    logger.error('[security][wallet_inject] Option B signature INVALID — rejecting', {
      orderId,
      actorId: auth.actorId,
      actorType: auth.actorType,
      walletAddress,
    });
    return {
      ok: false,
      source: 'signature',
      reason: 'invalid signature for wallet ownership',
    };
  }

  // ── No Option A match, no valid Option B signature ─────────────────
  const reason =
    actorWallet === null
      ? 'actor has no wallet on file and no signature provided'
      : 'wallet differs from authenticated actor wallet and no signature provided';

  if (alwaysStrict || isWalletOwnershipStrict()) {
    logger.error('[security][wallet_inject] wallet ownership not verified — REJECTING', {
      orderId,
      actorId: auth.actorId,
      actorType: auth.actorType,
      providedWallet: walletAddress,
      actorWallet: actorWallet ?? null,
      strict: true,
      alwaysStrict: !!alwaysStrict,
    });
    return { ok: false, source: 'auth_match', reason };
  }

  // Lax mode — log loudly so we can track legacy traffic during rollout.
  logger.warn('[security][wallet_inject] wallet ownership unverified — allowing in lax mode', {
    orderId,
    actorId: auth.actorId,
    actorType: auth.actorType,
    providedWallet: walletAddress,
    actorWallet: actorWallet ?? null,
    reason,
  });
  return { ok: true, source: 'lax_allowed', reason };
}
