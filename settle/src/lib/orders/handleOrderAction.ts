/**
 * ═══════════════════════════════════════════════════════════════════════════
 * handleOrderAction — Unified Action Handler (Single Entry Point)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ARCHITECTURE:
 *   Frontend sends: { action: "ACCEPT" | "LOCK_ESCROW" | ... }
 *   Backend resolves the target status, validates role + state, executes atomically.
 *
 * This replaces scattered PATCH { status } calls with a single deterministic handler.
 * The backend is the SOLE authority over status transitions.
 *
 * INVARIANTS:
 *   - Escrow MUST be locked before payment_sent
 *   - Only seller can lock escrow and confirm payment
 *   - Only buyer can accept and mark payment sent
 *   - Cancel only allowed in pre-completion stages
 *   - Dispute allowed once escrow is locked
 *   - All updates are atomic (optimistic locking via order_version)
 *   - No direct status writes — only actions
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Order, ActorType, MinimalOrderStatus } from '../types/database';
import {
  validateTypedTransition,
  MINIMAL_TERMINAL_STATUSES,
} from './stateMachineMinimal';
import { normalizeStatus } from './statusNormalizer';

// ── Actions the frontend can send ──────────────────────────────────────

export const ORDER_ACTIONS = [
  'ACCEPT',
  'CLAIM',
  'LOCK_ESCROW',
  'SEND_PAYMENT',
  'CONFIRM_PAYMENT',
  'CANCEL',
  'DISPUTE',
] as const;

export type OrderAction = (typeof ORDER_ACTIONS)[number];

// ── Role types ─────────────────────────────────────────────────────────

export type TradeRole = 'buyer' | 'seller';

// ── Action → target status mapping ─────────────────────────────────────
//
// NOTE: CLAIM does NOT change status for SELL orders (stays 'escrowed').
// The target status is resolved dynamically in handleOrderAction for CLAIM.

const ACTION_TARGET_STATUS: Record<OrderAction, MinimalOrderStatus> = {
  ACCEPT: 'accepted',
  CLAIM: 'escrowed',   // SELL/M2M claim: stays escrowed (merchant_id + accepted_at set, no status change)
  LOCK_ESCROW: 'escrowed',
  SEND_PAYMENT: 'payment_sent',
  CONFIRM_PAYMENT: 'completed',
  CANCEL: 'cancelled',
  DISPUTE: 'disputed',
};

// ── Action rules: which role can perform, from which statuses ──────────

interface ActionRule {
  allowedRole: TradeRole | 'any';
  allowedFromStatuses: MinimalOrderStatus[];
  requiresEscrow?: boolean; // Must have escrow locked before this action
}

const ACTION_RULES: Record<OrderAction, ActionRule> = {
  ACCEPT: {
    // BUY flow only: merchant accepts → open → accepted
    // SELL orders use CLAIM instead (no status change)
    allowedRole: 'buyer',
    allowedFromStatuses: ['open'],
  },
  CLAIM: {
    // SELL/M2M flow: merchant claims escrowed order → stays escrowed
    // Sets merchant_id + accepted_at WITHOUT changing status
    allowedRole: 'buyer',
    allowedFromStatuses: ['escrowed'],
    requiresEscrow: true,
  },
  LOCK_ESCROW: {
    // BUY flow only: seller locks escrow after acceptance
    // SELL orders have escrow locked at creation (never hits this)
    allowedRole: 'seller',
    allowedFromStatuses: ['accepted'],
  },
  SEND_PAYMENT: {
    allowedRole: 'buyer',
    allowedFromStatuses: ['escrowed'],
    requiresEscrow: true,
  },
  CONFIRM_PAYMENT: {
    allowedRole: 'seller',
    allowedFromStatuses: ['payment_sent'],
    requiresEscrow: true,
  },
  CANCEL: {
    allowedRole: 'any',
    allowedFromStatuses: ['open', 'accepted', 'escrowed'],
  },
  DISPUTE: {
    allowedRole: 'any',
    allowedFromStatuses: ['escrowed', 'payment_sent'],
  },
};

// ── Result type ────────────────────────────────────────────────────────

export interface ActionResult {
  success: boolean;
  targetStatus?: MinimalOrderStatus;
  error?: string;
  code?: string;
}

// ── Role resolution ────────────────────────────────────────────────────

/**
 * Determine if currentUser is buyer or seller for this order.
 *
 * Rules:
 *   - Seller ALWAYS locks crypto. Buyer ALWAYS sends fiat.
 *   - M2M: buyer_merchant_id = ALWAYS buyer, merchant_id = ALWAYS seller.
 *     This is type-agnostic — matches the SQL role resolution and field semantics.
 *   - For non-M2M:
 *       BUY order (user buys) → merchant = seller, user = buyer
 *       SELL order (user sells) → merchant = buyer, user = seller
 */
export function resolveTradeRole(
  order: Pick<Order, 'type' | 'user_id' | 'merchant_id' | 'buyer_merchant_id'>,
  currentUserId: string
): TradeRole | null {
  const isM2M = !!order.buyer_merchant_id;

  if (isM2M) {
    // M2M rule (matches SQL): buyer_merchant_id is ALWAYS buyer, merchant_id is ALWAYS seller.
    // The stored type does NOT affect M2M role assignment — the field name is authoritative.
    if (currentUserId === order.buyer_merchant_id) return 'buyer';
    if (currentUserId === order.merchant_id) return 'seller';
    // Placeholder user fallback
    if (currentUserId === order.user_id) {
      return order.type === 'sell' ? 'seller' : 'buyer';
    }
    return null;
  }

  if (order.type === 'sell') {
    // SELL order: user sells crypto (seller), merchant buys (buyer)
    if (currentUserId === order.user_id) return 'seller';
    if (currentUserId === order.merchant_id) return 'buyer';
  } else {
    // BUY order: user buys (buyer), merchant sells (seller)
    if (currentUserId === order.user_id) return 'buyer';
    if (currentUserId === order.merchant_id) return 'seller';
  }

  return null; // Not a participant
}

// ── Main handler ───────────────────────────────────────────────────────

/**
 * handleOrderAction — validate and resolve an action to a target status.
 *
 * This function performs ALL validation but does NOT execute the DB update.
 * The caller (API route) is responsible for atomic execution.
 *
 * Returns:
 *   - { success: true, targetStatus } if the action is valid
 *   - { success: false, error, code } if rejected
 */
export function handleOrderAction(
  order: Pick<
    Order,
    | 'id'
    | 'status'
    | 'type'
    | 'user_id'
    | 'merchant_id'
    | 'buyer_merchant_id'
    | 'escrow_debited_entity_id'
    | 'order_version'
  >,
  action: OrderAction,
  currentUserId: string
): ActionResult {
  // 1. Validate action is known
  if (!ORDER_ACTIONS.includes(action)) {
    return {
      success: false,
      error: `Unknown action '${action}'. Valid actions: ${ORDER_ACTIONS.join(', ')}`,
      code: 'UNKNOWN_ACTION',
    };
  }

  // NOTE: No type-based guards here. Status-based rules are sufficient:
  //   - Real user SELL orders start at 'escrowed' → ACCEPT (requires 'open') is impossible
  //   - Merchant broadcast orders (placeholder user, stored type='sell') start at 'pending' → ACCEPT works
  //   - CLAIM requires 'escrowed' → only works on orders with escrow already locked
  //   - LOCK_ESCROW requires 'accepted' → only works after acceptance (BUY flow)

  const rule = ACTION_RULES[action];
  const targetStatus = ACTION_TARGET_STATUS[action];

  // 2. Normalize current DB status to minimal 8-state
  const currentMinimal = normalizeStatus(order.status);

  // 3. Reject if order is in terminal state
  if (MINIMAL_TERMINAL_STATUSES.includes(currentMinimal)) {
    return {
      success: false,
      error: `Order is in terminal state '${currentMinimal}'. No further actions allowed.`,
      code: 'TERMINAL_STATE',
    };
  }

  // 4. Validate current status is allowed for this action
  if (!rule.allowedFromStatuses.includes(currentMinimal)) {
    return {
      success: false,
      error: `Action '${action}' is not allowed from status '${currentMinimal}'. Allowed from: ${rule.allowedFromStatuses.join(', ')}`,
      code: 'INVALID_STATUS_FOR_ACTION',
    };
  }

  // 5. Resolve role (buyer/seller)
  //    For ACCEPT, the user may not yet be a participant (observer accepting).
  //    Handle this special case.
  let role: TradeRole | null;

  // For ACCEPT, CLAIM, or SEND_PAYMENT on unclaimed escrowed orders:
  // The observer is not yet a participant, so resolveTradeRole returns null.
  // We assign 'buyer' directly and let the route handler do the atomic claim.
  const isClaimingAction = action === 'ACCEPT' || action === 'CLAIM';
  // Auto-claim+pay: only for OBSERVERS (merchants not yet in the order) who want to
  // claim an unclaimed escrowed order and mark payment in one step.
  // The original user_id and merchant_id are already participants — they use the normal path.
  const isAlreadyParticipant = currentUserId === order.user_id || currentUserId === order.merchant_id;
  const isAutoClaimPayment = action === 'SEND_PAYMENT'
    && currentMinimal === 'escrowed'
    && !order.buyer_merchant_id
    && !isAlreadyParticipant;

  if (isClaimingAction || isAutoClaimPayment) {
    // Self-accept guard: the ORDER CREATOR cannot accept/claim their own order.
    // - user_id is always the creator for user-created orders
    // - merchant_id is the PRE-ASSIGNED counterparty (matched merchant), NOT the creator
    //   → they SHOULD be able to accept
    if (currentUserId === order.user_id) {
      return {
        success: false,
        error: 'You cannot accept your own order.',
        code: 'SELF_ACCEPT',
      };
    }
    role = 'buyer';
  } else {
    role = resolveTradeRole(order, currentUserId);
  }

  if (!role) {
    return {
      success: false,
      error: 'You are not a participant in this order.',
      code: 'NOT_PARTICIPANT',
    };
  }

  // 6. Validate role permission
  if (rule.allowedRole !== 'any' && role !== rule.allowedRole) {
    return {
      success: false,
      error: `Action '${action}' requires role '${rule.allowedRole}', but you are the '${role}'.`,
      code: 'ROLE_MISMATCH',
    };
  }

  // 7. Escrow invariant: ensure escrow is locked where required
  //    If the order is already in 'escrowed' status, escrow IS locked by definition
  //    (the state machine enforced this on entry). The escrow_debited_entity_id field
  //    may be NULL due to on-chain escrow data inconsistency — trust the status.
  if (rule.requiresEscrow && !order.escrow_debited_entity_id && currentMinimal !== 'escrowed') {
    return {
      success: false,
      error: `Action '${action}' requires escrow to be locked first.`,
      code: 'ESCROW_REQUIRED',
    };
  }

  // 8. CLAIM/MINE: field-only update — no status transition.
  //    Sets merchant_id + accepted_at on an escrowed order without changing status.
  //    Skip state machine validation (same-status "transition" would be rejected as no-op).
  if (action === 'CLAIM') {
    return {
      success: true,
      targetStatus: 'escrowed', // Status stays the same
    };
  }

  // 9. Validate via state machine (actor type mapping for state machine)
  //    State machine uses ActorType ('user' | 'merchant' | 'system'),
  //    so we map from the resolved role context.
  //    Uses type-aware validation to enforce BUY/SELL flow rules.
  const actorType: ActorType = resolveActorType(order, currentUserId);
  const smValidation = validateTypedTransition(currentMinimal, targetStatus, actorType, order.type);
  if (!smValidation.valid) {
    return {
      success: false,
      error: smValidation.error || 'State machine rejected this transition.',
      code: 'STATE_MACHINE_REJECTED',
    };
  }

  // All checks passed
  return {
    success: true,
    targetStatus,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Map a user ID to ActorType based on order context.
 */
function resolveActorType(
  order: Pick<Order, 'user_id' | 'merchant_id' | 'buyer_merchant_id'>,
  currentUserId: string
): ActorType {
  if (currentUserId === order.user_id) return 'user';
  if (currentUserId === order.merchant_id) return 'merchant';
  if (currentUserId === order.buyer_merchant_id) return 'merchant';
  // Observer accepting — treated as merchant (they become buyer_merchant_id)
  return 'merchant';
}

/**
 * Get allowed actions for a user given the current order state.
 * Useful for the frontend to know what buttons to show.
 */
export function getAllowedActions(
  order: Pick<
    Order,
    | 'id'
    | 'status'
    | 'type'
    | 'user_id'
    | 'merchant_id'
    | 'buyer_merchant_id'
    | 'escrow_debited_entity_id'
    | 'order_version'
  >,
  currentUserId: string
): OrderAction[] {
  return ORDER_ACTIONS.filter(
    (action) => handleOrderAction(order, action, currentUserId).success
  );
}

// ── Role Resolver (MANDATORY per spec) ──────────────────────────────

export interface ResolvedRoles {
  /** The entity ID who is the buyer (sends fiat) */
  buyer_id: string | null;
  /** The entity ID who is the seller (locks/releases crypto) */
  seller_id: string | null;
  /** Check if a given user is the buyer */
  isBuyer: (userId: string) => boolean;
  /** Check if a given user is the seller */
  isSeller: (userId: string) => boolean;
}

/**
 * resolveRoles — Determine buyer and seller IDs for any order.
 *
 * Escrow ownership (STRICT):
 *   SELLER = locks crypto, releases crypto
 *   - SELL → seller = user_id (order creator)
 *   - BUY  → seller = merchant_id (after accept)
 *   - M2M  → seller = merchant_id ALWAYS
 *
 * Payment ownership:
 *   BUYER = sends fiat
 *   - BUY  → buyer = user_id or buyer_merchant_id
 *   - SELL → buyer = merchant_id or buyer_merchant_id
 */
export function resolveRoles(
  order: Pick<Order, 'type' | 'user_id' | 'merchant_id' | 'buyer_merchant_id'>,
): ResolvedRoles {
  const isM2M = !!order.buyer_merchant_id;

  let buyer_id: string | null;
  let seller_id: string | null;

  if (isM2M) {
    // M2M: field names are authoritative, type-agnostic
    buyer_id = order.buyer_merchant_id;
    seller_id = order.merchant_id;
  } else if (order.type === 'sell') {
    // SELL: user sells crypto (seller), merchant buys (buyer)
    seller_id = order.user_id;
    buyer_id = order.merchant_id; // may be null until claimed
  } else {
    // BUY: user buys (buyer), merchant sells (seller)
    buyer_id = order.user_id;
    seller_id = order.merchant_id; // may be null until accepted
  }

  return {
    buyer_id,
    seller_id,
    isBuyer: (userId: string) => !!buyer_id && userId === buyer_id,
    isSeller: (userId: string) => !!seller_id && userId === seller_id,
  };
}
