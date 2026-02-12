/**
 * getNextStep() - Determines exactly what a merchant should do next for an order
 *
 * Pure function with zero side effects. Takes order state + current merchant context
 * and returns a structured object describing the next action.
 */

export interface NextStepResult {
  /** Who needs to act? */
  actor: 'me' | 'counterparty' | 'system' | 'none';
  /** Button text: "Lock Escrow", "I've Paid", "Release", etc. */
  label: string;
  /** Explanation: "Waiting for buyer to send AED payment" */
  sublabel: string;
  /** Short status badge text */
  badgeText: string;
  /** Badge styling variant */
  badgeVariant: 'action' | 'waiting' | 'done' | 'error';
  /** Whether this merchant needs to press a button */
  actionRequired: boolean;
  /** Which handler to invoke (maps to existing merchant page functions) */
  actionType:
    | 'accept'
    | 'lock_escrow'
    | 'sign_claim'
    | 'sign_proceed'
    | 'mark_paid'
    | 'confirm_payment'
    | 'release_escrow'
    | 'refund'
    | null;
}

export interface OrderContext {
  escrowTxHash?: string | null;
  escrowCreatorWallet?: string | null;
  orderMerchantId?: string | null;
  buyerMerchantId?: string | null;
  acceptorWallet?: string | null;
  isMyOrder?: boolean;
  expiresIn: number;
  escrowTradeId?: number | null;
  orderType?: 'buy' | 'sell' | null;
}

export function getNextStep(
  dbStatus: string,
  myMerchantId: string,
  myWalletAddress: string | null,
  order: OrderContext
): NextStepResult {
  const {
    escrowTxHash,
    escrowCreatorWallet,
    orderMerchantId,
    buyerMerchantId,
    acceptorWallet,
    isMyOrder,
    expiresIn,
    escrowTradeId,
    orderType,
  } = order;

  // Determine my role
  const iAmOrderCreator = orderMerchantId === myMerchantId;
  const iAmBuyerMerchant = buyerMerchantId === myMerchantId;
  const hasEscrow = !!escrowTxHash;

  // Determine if I'm the escrow creator (seller)
  // Primary: wallet address comparison (production mode with connected wallet)
  // Fallback: merchant_id is always the seller/escrow-creator in M2M trades
  //           (covers mock mode where walletAddress is null, and pre-connect states)
  const iAmEscrowCreator = myWalletAddress
    ? !!(escrowCreatorWallet && escrowCreatorWallet === myWalletAddress)
    : !!(hasEscrow && orderMerchantId && myMerchantId === orderMerchantId);

  // If escrow exists and I didn't create it, I'm on the other side
  const iAmBuyer = hasEscrow && !iAmEscrowCreator;
  const isExpired = expiresIn <= 0;

  // --- TERMINAL STATES ---

  if (dbStatus === 'completed') {
    return {
      actor: 'none', label: 'Complete', sublabel: 'Trade completed successfully',
      badgeText: 'DONE', badgeVariant: 'done', actionRequired: false, actionType: null,
    };
  }

  if (dbStatus === 'cancelled') {
    return {
      actor: 'none', label: 'Cancelled', sublabel: 'This order was cancelled',
      badgeText: 'CANCELLED', badgeVariant: 'error', actionRequired: false, actionType: null,
    };
  }

  if (dbStatus === 'disputed') {
    return {
      actor: 'system', label: 'Under Dispute', sublabel: 'Dispute is being reviewed',
      badgeText: 'DISPUTED', badgeVariant: 'error', actionRequired: false, actionType: null,
    };
  }

  if (dbStatus === 'expired') {
    if ((iAmEscrowCreator || iAmOrderCreator) && escrowTradeId != null) {
      return {
        actor: 'me', label: 'Claim Refund', sublabel: 'Order expired — reclaim your escrowed funds',
        badgeText: 'EXPIRED', badgeVariant: 'error', actionRequired: true, actionType: 'refund',
      };
    }
    return {
      actor: 'none', label: 'Expired', sublabel: 'This order has expired',
      badgeText: 'EXPIRED', badgeVariant: 'error', actionRequired: false, actionType: null,
    };
  }

  // --- EXPIRED CHECK (timer ran out but status not yet updated) ---

  if (isExpired && dbStatus !== 'releasing') {
    if ((iAmEscrowCreator || iAmOrderCreator) && escrowTradeId != null) {
      return {
        actor: 'me', label: 'Claim Refund', sublabel: 'Order expired — reclaim your escrowed funds',
        badgeText: 'EXPIRED', badgeVariant: 'error', actionRequired: true, actionType: 'refund',
      };
    }
    return {
      actor: 'none', label: 'Expired', sublabel: 'This order has expired',
      badgeText: 'EXPIRED', badgeVariant: 'error', actionRequired: false, actionType: null,
    };
  }

  // --- PENDING ---

  if (dbStatus === 'pending') {
    if (isMyOrder) {
      return {
        actor: 'counterparty', label: 'Waiting', sublabel: 'Waiting for another merchant to accept',
        badgeText: 'OPEN', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }
    return {
      actor: 'me', label: 'Accept', sublabel: 'Accept this order to start trading',
      badgeText: 'NEW', badgeVariant: 'action', actionRequired: true, actionType: 'accept',
    };
  }

  // --- ACCEPTED ---

  if (dbStatus === 'accepted') {
    // BUYER: If escrow is already locked, I can send fiat payment now
    if (iAmBuyerMerchant) {
      if (hasEscrow) {
        // Seller locked escrow before I accepted — I can pay now
        return {
          actor: 'me', label: "I've Paid", sublabel: 'Send AED payment, then mark as paid',
          badgeText: 'SEND', badgeVariant: 'action', actionRequired: true, actionType: 'mark_paid',
        };
      }
      return {
        actor: 'counterparty', label: 'Waiting', sublabel: 'Waiting for seller to lock escrow',
        badgeText: 'WAITING', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }

    // From here: I'm the SELLER (merchant_id) or a non-buyer party
    // Who needs to lock escrow?
    // After acceptance, merchant_id is reassigned to the seller (acceptor).
    // So iAmOrderCreator = true for the seller after reassignment.
    const iNeedToLockEscrow =
      // I'm merchant_id (seller) and NOT the buyer — I need to lock
      (iAmOrderCreator && !iAmBuyerMerchant && !hasEscrow) ||
      // I'm the acceptor of a sell-type order and NOT the buyer — I need to lock
      (!iAmOrderCreator && !iAmBuyerMerchant && orderType === 'sell' && !hasEscrow);

    if (iNeedToLockEscrow) {
      return {
        actor: 'me', label: 'Lock Escrow', sublabel: 'Lock your USDC to proceed with this trade',
        badgeText: 'LOCK', badgeVariant: 'action', actionRequired: true, actionType: 'lock_escrow',
      };
    }

    // Escrow exists and I created it — waiting for buyer to pay
    if (hasEscrow && iAmEscrowCreator) {
      return {
        actor: 'counterparty', label: 'Awaiting Payment', sublabel: 'Waiting for buyer to send AED payment',
        badgeText: 'AWAIT PAY', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }

    // Escrow exists from other party — I need to sign/claim
    if (hasEscrow && !iAmEscrowCreator) {
      return {
        actor: 'me', label: 'Sign to Claim', sublabel: 'Counterparty locked escrow — sign to proceed',
        badgeText: 'SIGN', badgeVariant: 'action', actionRequired: true, actionType: 'sign_claim',
      };
    }

    // Catch-all: waiting for counterparty
    return {
      actor: 'counterparty', label: 'Waiting', sublabel: 'Waiting for counterparty to lock escrow',
      badgeText: 'WAITING', badgeVariant: 'waiting', actionRequired: false, actionType: null,
    };
  }

  // --- ESCROWED ---

  if (dbStatus === 'escrowed') {
    if (iAmEscrowCreator) {
      // I locked escrow — waiting for buyer to pay fiat
      return {
        actor: 'counterparty', label: 'Awaiting Payment', sublabel: 'Waiting for buyer to send AED payment',
        badgeText: 'AWAIT PAY', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }
    if (iAmBuyer || iAmBuyerMerchant) {
      // I'm the buyer — I need to send fiat and mark as paid
      return {
        actor: 'me', label: "I've Paid", sublabel: 'Send AED payment, then mark as paid',
        badgeText: 'SEND', badgeVariant: 'action', actionRequired: true, actionType: 'mark_paid',
      };
    }
    // Fallback: if I'm merchant_id (seller) but wallet detection missed
    if (iAmOrderCreator) {
      return {
        actor: 'counterparty', label: 'Awaiting Payment', sublabel: 'Waiting for buyer to send AED payment',
        badgeText: 'AWAIT PAY', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }
    // Last resort: can't determine role — default to buyer action so order isn't stuck
    return {
      actor: 'me', label: "I've Paid", sublabel: 'Send AED payment, then mark as paid',
      badgeText: 'SEND', badgeVariant: 'action', actionRequired: true, actionType: 'mark_paid',
    };
  }

  // --- PAYMENT PENDING ---

  if (dbStatus === 'payment_pending') {
    if (iAmBuyer || iAmBuyerMerchant) {
      return {
        actor: 'me', label: "I've Paid", sublabel: 'Send AED payment, then mark as paid',
        badgeText: 'SEND', badgeVariant: 'action', actionRequired: true, actionType: 'mark_paid',
      };
    }
    return {
      actor: 'counterparty', label: 'Awaiting Payment', sublabel: 'Waiting for buyer to send AED payment',
      badgeText: 'AWAIT PAY', badgeVariant: 'waiting', actionRequired: false, actionType: null,
    };
  }

  // --- PAYMENT SENT ---

  if (dbStatus === 'payment_sent') {
    if (iAmEscrowCreator || iAmOrderCreator) {
      // I'm the seller — buyer says they paid, I need to verify and confirm
      return {
        actor: 'me', label: 'Confirm & Release', sublabel: 'Verify you received AED, then confirm payment',
        badgeText: 'PAID', badgeVariant: 'action', actionRequired: true, actionType: 'confirm_payment',
      };
    }
    if (iAmBuyer || iAmBuyerMerchant) {
      // I'm the buyer — waiting for seller to confirm
      return {
        actor: 'counterparty', label: 'Waiting', sublabel: 'Waiting for seller to confirm your payment',
        badgeText: 'CONFIRMING', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }
    // Last resort: default to seller action so order isn't stuck
    return {
      actor: 'me', label: 'Confirm & Release', sublabel: 'Verify you received AED, then confirm payment',
      badgeText: 'PAID', badgeVariant: 'action', actionRequired: true, actionType: 'confirm_payment',
    };
  }

  // --- PAYMENT CONFIRMED ---

  if (dbStatus === 'payment_confirmed') {
    if (iAmEscrowCreator || iAmOrderCreator) {
      // I'm the seller — payment confirmed, release escrow to buyer
      return {
        actor: 'me', label: 'Release', sublabel: 'Payment confirmed — release USDC to buyer',
        badgeText: 'READY', badgeVariant: 'action', actionRequired: true, actionType: 'release_escrow',
      };
    }
    if (iAmBuyer || iAmBuyerMerchant) {
      return {
        actor: 'counterparty', label: 'Waiting', sublabel: 'Payment confirmed — waiting for escrow release',
        badgeText: 'RELEASING', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }
    // Last resort: default to seller action so order isn't stuck
    return {
      actor: 'me', label: 'Release', sublabel: 'Payment confirmed — release USDC to buyer',
      badgeText: 'READY', badgeVariant: 'action', actionRequired: true, actionType: 'release_escrow',
    };
  }

  // --- RELEASING ---

  if (dbStatus === 'releasing') {
    return {
      actor: 'system', label: 'Releasing...', sublabel: 'Escrow is being released',
      badgeText: 'RELEASING', badgeVariant: 'waiting', actionRequired: false, actionType: null,
    };
  }

  // --- FALLBACK ---

  return {
    actor: 'system', label: 'Processing', sublabel: `Order status: ${dbStatus}`,
    badgeText: dbStatus.toUpperCase(), badgeVariant: 'waiting', actionRequired: false, actionType: null,
  };
}
