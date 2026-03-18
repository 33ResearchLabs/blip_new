import { computeMyRole, MyRole } from './statusResolver';
import { normalizeStatus } from './statusNormalizer';
import { OrderStatus } from '../types/database';

export interface NextStepResult {
  actor: 'me' | 'counterparty' | 'system' | 'none';
  label: string;
  sublabel: string;
  badgeText: string;
  badgeVariant: 'action' | 'waiting' | 'done' | 'error';
  actionRequired: boolean;
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
  acceptedAt?: string | null;
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
    expiresIn,
    escrowTradeId,
    orderType,
    acceptedAt,
  } = order;

  const role: MyRole = computeMyRole({
    merchant_id: orderMerchantId,
    buyer_merchant_id: buyerMerchantId,
    type: orderType,
    escrow_debited_entity_type: undefined,
    escrow_debited_entity_id: undefined,
  }, myMerchantId);

  const iAmBuyer = role === 'buyer';
  const iAmSeller = role === 'seller';

  const hasEscrow = !!escrowTxHash;

  const iAmEscrowCreator = myWalletAddress
    ? !!(escrowCreatorWallet && escrowCreatorWallet === myWalletAddress)
    : !!(hasEscrow && orderMerchantId && myMerchantId === orderMerchantId);

  const isExpired = expiresIn <= 0;

  const minimal = normalizeStatus(dbStatus as OrderStatus);

  // --- TERMINAL STATES ---

  if (minimal === 'completed') {
    return {
      actor: 'none', label: 'Complete', sublabel: 'Trade completed successfully',
      badgeText: 'DONE', badgeVariant: 'done', actionRequired: false, actionType: null,
    };
  }

  if (minimal === 'cancelled') {
    return {
      actor: 'none', label: 'Cancelled', sublabel: 'This order was cancelled',
      badgeText: 'CANCELLED', badgeVariant: 'error', actionRequired: false, actionType: null,
    };
  }

  if (minimal === 'disputed') {
    return {
      actor: 'system', label: 'Under Dispute', sublabel: 'Dispute is being reviewed',
      badgeText: 'DISPUTED', badgeVariant: 'error', actionRequired: false, actionType: null,
    };
  }

  if (minimal === 'expired') {
    if ((iAmEscrowCreator || iAmSeller) && escrowTradeId != null) {
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
    if ((iAmEscrowCreator || iAmSeller) && escrowTradeId != null) {
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

  // --- OPEN (was: pending) ---

  if (minimal === 'open') {
    if (role !== 'observer') {
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

  // --- ACCEPTED (was: accepted, escrow_pending) ---

  if (minimal === 'accepted') {
    if (iAmBuyer) {
      if (hasEscrow) {
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

    if (iAmSeller) {
      if (!hasEscrow) {
        return {
          actor: 'me', label: 'Lock Escrow', sublabel: 'Lock your USDC to proceed with this trade',
          badgeText: 'LOCK', badgeVariant: 'action', actionRequired: true, actionType: 'lock_escrow',
        };
      }
      if (hasEscrow && iAmEscrowCreator) {
        return {
          actor: 'counterparty', label: 'Awaiting Payment', sublabel: 'Waiting for buyer to send AED payment',
          badgeText: 'AWAIT PAY', badgeVariant: 'waiting', actionRequired: false, actionType: null,
        };
      }
    }

    if (hasEscrow && !iAmEscrowCreator) {
      return {
        actor: 'me', label: 'Sign to Claim', sublabel: 'Counterparty locked escrow — sign to proceed',
        badgeText: 'SIGN', badgeVariant: 'action', actionRequired: true, actionType: 'sign_claim',
      };
    }

    return {
      actor: 'counterparty', label: 'Waiting', sublabel: 'Waiting for counterparty to lock escrow',
      badgeText: 'WAITING', badgeVariant: 'waiting', actionRequired: false, actionType: null,
    };
  }

  // --- ESCROWED (was: escrowed, payment_pending) ---

  if (minimal === 'escrowed') {
    const hasBeenAccepted = !!acceptedAt;

    if (!hasBeenAccepted && !iAmEscrowCreator) {
      return {
        actor: 'me', label: 'Accept', sublabel: 'User locked escrow — accept to start trading',
        badgeText: 'NEW', badgeVariant: 'action', actionRequired: true, actionType: 'accept',
      };
    }

    if (iAmSeller || iAmEscrowCreator) {
      return {
        actor: 'counterparty', label: 'Awaiting Payment', sublabel: 'Waiting for buyer to send AED payment',
        badgeText: 'AWAIT PAY', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }

    if (iAmBuyer) {
      return {
        actor: 'me', label: "I've Paid", sublabel: 'Send AED payment, then mark as paid',
        badgeText: 'SEND', badgeVariant: 'action', actionRequired: true, actionType: 'mark_paid',
      };
    }

    return {
      actor: 'me', label: "I've Paid", sublabel: 'Send AED payment, then mark as paid',
      badgeText: 'SEND', badgeVariant: 'action', actionRequired: true, actionType: 'mark_paid',
    };
  }

  // --- PAYMENT SENT (was: payment_sent, payment_confirmed) ---

  if (minimal === 'payment_sent') {
    if (dbStatus === 'payment_confirmed') {
      if (iAmEscrowCreator || iAmSeller) {
        return {
          actor: 'me', label: 'Release', sublabel: 'Payment confirmed — release USDC to buyer',
          badgeText: 'READY', badgeVariant: 'action', actionRequired: true, actionType: 'release_escrow',
        };
      }
      if (iAmBuyer) {
        return {
          actor: 'counterparty', label: 'Waiting', sublabel: 'Payment confirmed — waiting for escrow release',
          badgeText: 'RELEASING', badgeVariant: 'waiting', actionRequired: false, actionType: null,
        };
      }
      return {
        actor: 'me', label: 'Release', sublabel: 'Payment confirmed — release USDC to buyer',
        badgeText: 'READY', badgeVariant: 'action', actionRequired: true, actionType: 'release_escrow',
      };
    }

    if (iAmEscrowCreator || iAmSeller) {
      return {
        actor: 'me', label: 'Confirm & Release', sublabel: 'Verify you received AED, then confirm payment',
        badgeText: 'PAID', badgeVariant: 'action', actionRequired: true, actionType: 'confirm_payment',
      };
    }
    if (iAmBuyer) {
      return {
        actor: 'counterparty', label: 'Waiting', sublabel: 'Waiting for seller to confirm your payment',
        badgeText: 'CONFIRMING', badgeVariant: 'waiting', actionRequired: false, actionType: null,
      };
    }
    return {
      actor: 'me', label: 'Confirm & Release', sublabel: 'Verify you received AED, then confirm payment',
      badgeText: 'PAID', badgeVariant: 'action', actionRequired: true, actionType: 'confirm_payment',
    };
  }

  // --- FALLBACK ---

  return {
    actor: 'system', label: 'Processing', sublabel: `Order status: ${dbStatus}`,
    badgeText: dbStatus.toUpperCase(), badgeVariant: 'waiting', actionRequired: false, actionType: null,
  };
}
