/**
 * Backend-Driven Order Types — STRICT CONTRACT
 *
 * These types represent the contract between backend and frontend.
 * The frontend MUST NOT compute roles, actions, or state transitions.
 * All UI logic comes from these backend-provided fields.
 *
 * INVARIANTS:
 *   - primaryAction is ALWAYS present (never null/undefined)
 *   - secondaryAction is explicitly null when absent
 *   - All fields have defined values, never undefined
 */

// ── Status ────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'open'
  | 'accepted'
  | 'escrowed'
  | 'payment_sent'
  | 'completed'
  | 'cancelled'
  | 'disputed'
  | 'expired';

// ── Role ──────────────────────────────────────────────────────────────

export type OrderRole = 'buyer' | 'seller' | 'observer';

// ── Actions (exactly 7, no combined/ambiguous types) ─────────────────

export type ActionType =
  | 'ACCEPT'
  | 'CLAIM'
  | 'LOCK_ESCROW'
  | 'SEND_PAYMENT'
  | 'CONFIRM_PAYMENT'
  | 'CANCEL'
  | 'DISPUTE';

/** Financial actions that REQUIRE idempotency keys */
export const FINANCIAL_ACTIONS: readonly ActionType[] = [
  'SEND_PAYMENT',
  'CONFIRM_PAYMENT',
  'LOCK_ESCROW',
] as const;

export interface PrimaryAction {
  /** Action type to send to POST /orders/{id}/action. null = informational only (disabled). */
  type: ActionType | null;
  /** Button label */
  label: string;
  /** Whether the button is clickable. false = disabled. */
  enabled: boolean;
  /** Explanation shown when button is disabled */
  disabledReason?: string;
}

export interface SecondaryAction {
  /** Action type. null = informational only. */
  type: ActionType | null;
  /** Button label */
  label: string;
}

// ── Order Response ────────────────────────────────────────────────────

export interface BackendOrder {
  // Identity
  id: string;
  order_number?: string;

  // Backend-driven UI fields (NEVER compute these on frontend)
  /** Normalized 8-state status */
  status: OrderStatus;
  /** Human-readable status label (e.g. "PAYMENT SENT") */
  statusLabel: string;
  /** Caller's role in this order */
  my_role: OrderRole;
  /** Primary CTA button. ALWAYS present, never null. */
  primaryAction: PrimaryAction;
  /** Secondary action (Cancel/Dispute). Explicitly null when absent. */
  secondaryAction: SecondaryAction | null;
  /** User guidance text. ALWAYS present. */
  nextStepText: string;
  /** Whether order is in a terminal state (no more actions possible) */
  isTerminal: boolean;
  /** Whether chat UI should be shown */
  showChat: boolean;

  // Order data
  type: 'buy' | 'sell';
  crypto_amount: number;
  fiat_amount: number;
  rate: number;
  payment_method: 'bank' | 'cash';
  created_at: string;
  expires_at?: string;
  order_version?: number;

  // Participants
  user_id: string;
  merchant_id: string;
  buyer_merchant_id?: string;

  // Escrow
  escrow_tx_hash?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
  refund_tx_hash?: string;

  // Payment details
  payment_details?: {
    bank_name?: string;
    bank_account_name?: string;
    bank_iban?: string;
    user_bank_account?: string | { bank_name: string; account_name: string; iban: string };
    location_name?: string;
    location_address?: string;
  };

  // Nested relations (from DB joins)
  user?: {
    id: string;
    name: string;
    username?: string;
    rating: number;
    total_trades: number;
    wallet_address?: string;
  };
  merchant?: {
    id: string;
    display_name?: string;
    business_name?: string;
    rating?: number;
    total_trades?: number;
    wallet_address?: string;
  };
  buyer_merchant?: {
    id: string;
    display_name: string;
    wallet_address?: string;
  };

  // Locked payment method
  locked_payment_method?: {
    id: string;
    type: 'bank' | 'upi' | 'cash' | 'other';
    label: string;
    details: Record<string, string>;
  } | null;

  // Messages
  unread_count?: number;
  has_manual_message?: boolean;
  message_count?: number;
  last_human_message?: string;

  // Cancellation
  cancel_requested_by?: string | null;
  cancel_request_reason?: string | null;

  // Fees
  spread_preference?: string;
  protocol_fee_percentage?: number;
  protocol_fee_amount?: number;
}

// ── Action Request ────────────────────────────────────────────────────

export interface OrderActionRequest {
  action: ActionType;
  actor_id: string;
  actor_type: 'user' | 'merchant';
  reason?: string;
  tx_hash?: string;
  acceptor_wallet_address?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
}

// ── Action Response ───────────────────────────────────────────────────

export interface OrderActionResponse {
  success: boolean;
  order?: BackendOrder;
  action?: string;
  previousStatus?: string;
  newStatus?: string;
  error?: string;
  code?: string;
  // Enriched UI fields returned after mutation
  my_role?: OrderRole;
  primaryAction?: PrimaryAction;
  secondaryAction?: SecondaryAction | null;
  nextStepText?: string;
  isTerminal?: boolean;
  showChat?: boolean;
}

// ── Order Creation ────────────────────────────────────────────────────

export interface CreateOrderRequest {
  /** User's intent: buy or sell crypto */
  type: 'buy' | 'sell';
  /** Offer to trade against (optional — backend finds best if omitted) */
  offer_id?: string;
  /** Amount of crypto (USDT) to trade */
  crypto_amount: number;
  /** Payment method */
  payment_method: 'bank' | 'cash';
  /** Client-generated UUID for idempotency */
  idempotency_key: string;
}
