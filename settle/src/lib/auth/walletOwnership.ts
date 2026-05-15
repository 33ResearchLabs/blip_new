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
 * STRICT MODE IS THE ONLY MODE.
 *   The previous lax/dual-mode rollout (`WALLET_OWNERSHIP_STRICT=false`) was
 *   a temporary on-ramp. It is now removed: a wallet that fails BOTH Option A
 *   and Option B is ALWAYS rejected with a 403. There is no warn-only path.
 *   This eliminates the bypass where an attacker could supply an arbitrary
 *   payout wallet by simply not providing a signature and relying on the
 *   default-off env var.
 *
 * Pure-ish module: only side effects are DB reads (wallet lookups) and
 * structured error logs. No writes, no transactions.
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
  /**
   * - 'auth_match'      : Option A succeeded (wallet matches actor wallet on file)
   * - 'signature'       : Option B succeeded (or signature was rejected — see ok)
   * - 'no_check_needed' : caller passed no wallet to validate
   *
   * Note: 'lax_allowed' was removed — there is no warn-only acceptance path.
   */
  source: 'auth_match' | 'signature' | 'no_check_needed';
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
   * The order's already-recorded acceptor wallet, when known. If the
   * caller's supplied `walletAddress` matches this value, ownership is
   * accepted — this is the wallet that was already vouched for at accept
   * time. Closes the bug where Option A compared against the merchant's
   * profile wallet (`merchants.wallet_address`), which is stale by design
   * and unrelated to which wallet the user actually controls right now.
   */
  orderAcceptorWallet?: string | null;
  /**
   * Historically forced strict at sensitive sites (escrow release) when the
   * env-var-controlled default was lax. Now that strict is the only mode,
   * this flag is a no-op kept for caller backward-compatibility — it does
   * not relax or tighten anything. Will be removed in a follow-up after
   * call sites are updated to drop it.
   *
   * @deprecated strict is the default and only mode
   */
  alwaysStrict?: boolean;
}

/**
 * Decide whether to allow `walletAddress` to be associated with an order
 * mutation by `auth`. Centralises the Option A / Option B logic so the
 * routes don't replicate it.
 *
 * Routes call this BEFORE persisting the wallet or proxying to core-api.
 * On `ok: false`, return 403 to the caller.
 *
 * Failure modes (all 403-mappable, none allowed-through):
 *   - walletAddress provided but doesn't match actor and no signature →
 *     reject with reason "wallet differs from authenticated actor wallet"
 *   - actor has no wallet on file and no signature → reject
 *   - signature provided but invalid → reject
 */
export async function assertWalletOwnership(
  input: AssertWalletOwnershipInput
): Promise<OwnershipVerification> {
  const { auth, walletAddress, orderId, signature, signatureAction, orderAcceptorWallet } = input;

  // Empty/absent wallet: nothing to verify. Caller decides whether the
  // wallet was required at all.
  if (!walletAddress) {
    return { ok: true, source: 'no_check_needed' };
  }

  // ── Option A (preferred): wallet matches the wallet ALREADY RECORDED
  // on this order at accept time. That wallet was vouched for then; the
  // user proving they still control it now (it's still the wallet they're
  // signing with) is the strongest live signal we have. This is the
  // correct source of truth — not the merchant's profile wallet column
  // which is independent and frequently stale.
  if (orderAcceptorWallet && walletEq(orderAcceptorWallet, walletAddress)) {
    return { ok: true, source: 'auth_match' };
  }

  const actorWallet = await getActorWallet(auth);

  // ── Option A (fallback): wallet matches the actor's profile wallet.
  // Useful for first-time actions on a fresh order where no acceptor
  // wallet has been recorded yet.
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

  // ── No Option A match, no valid Option B signature: REJECT ─────────
  // (formerly: "lax mode allow with warning" — removed)
  const reason =
    actorWallet === null
      ? 'actor has no wallet on file and no signature provided'
      : 'wallet differs from authenticated actor wallet and no signature provided';

  logger.error('[security][wallet_inject] wallet ownership not verified — REJECTING', {
    orderId,
    actorId: auth.actorId,
    actorType: auth.actorType,
    providedWallet: walletAddress,
    actorWallet: actorWallet ?? null,
  });
  return { ok: false, source: 'auth_match', reason };
}
