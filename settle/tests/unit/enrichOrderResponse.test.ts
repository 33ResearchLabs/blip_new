/**
 * Unit Tests — enrichOrderResponse
 *
 * Tests the pure enrichment function that computes backend-driven UI state
 * for every status × role combination. No HTTP, no DB.
 */

import { enrichOrderResponse } from '../../src/lib/orders/enrichOrderResponse';

// ── Test Helpers ────────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000001';
const MERCHANT_ID = '00000000-0000-0000-0000-000000000002';
const BUYER_MERCHANT_ID = '00000000-0000-0000-0000-000000000003';
const OBSERVER_ID = '00000000-0000-0000-0000-000000000099';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    status: 'pending' as string,
    type: 'buy' as 'buy' | 'sell',
    user_id: USER_ID,
    merchant_id: MERCHANT_ID,
    buyer_merchant_id: null as string | null,
    escrow_debited_entity_id: null as string | null,
    escrow_tx_hash: null as string | null,
    refund_tx_hash: null as string | null,
    order_version: 1,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('enrichOrderResponse', () => {
  // ── Always-present fields ─────────────────────────────────────────

  describe('Invariants', () => {
    it('primaryAction is always defined', () => {
      const statuses = ['pending', 'accepted', 'escrowed', 'payment_sent', 'completed', 'cancelled', 'expired'];
      for (const status of statuses) {
        const order = makeOrder({ status });
        const enriched = enrichOrderResponse(order, MERCHANT_ID);
        expect(enriched.primaryAction).toBeDefined();
        expect(enriched.primaryAction).not.toBeNull();
        expect(enriched.primaryAction).toHaveProperty('type');
        expect(enriched.primaryAction).toHaveProperty('enabled');
      }
    });

    it('nextStepText is always a non-empty string', () => {
      const statuses = ['pending', 'accepted', 'escrowed', 'payment_sent', 'completed', 'cancelled'];
      for (const status of statuses) {
        const order = makeOrder({ status });
        const enriched = enrichOrderResponse(order, MERCHANT_ID);
        expect(typeof enriched.nextStepText).toBe('string');
        expect(enriched.nextStepText.length).toBeGreaterThan(0);
      }
    });

    it('statusLabel is always a non-empty string', () => {
      const statuses = ['pending', 'accepted', 'escrowed', 'payment_sent', 'completed', 'cancelled'];
      for (const status of statuses) {
        const order = makeOrder({ status });
        const enriched = enrichOrderResponse(order, MERCHANT_ID);
        expect(typeof enriched.statusLabel).toBe('string');
        expect(enriched.statusLabel.length).toBeGreaterThan(0);
      }
    });

    it('my_role is always buyer, seller, or observer', () => {
      const order = makeOrder();
      const roles = [USER_ID, MERCHANT_ID, OBSERVER_ID];
      for (const actorId of roles) {
        const enriched = enrichOrderResponse(order, actorId);
        expect(['buyer', 'seller', 'observer']).toContain(enriched.my_role);
      }
    });
  });

  // ── BUY Order: Seller (Merchant) ──────────────────────────────────

  describe('BUY order — Seller (merchant)', () => {
    it('OPEN: disabled primary, can cancel', () => {
      const order = makeOrder({ status: 'pending', type: 'buy' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.my_role).toBe('seller');
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('ACCEPTED: LOCK_ESCROW enabled', () => {
      const order = makeOrder({ status: 'accepted', type: 'buy' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.primaryAction.type).toBe('LOCK_ESCROW');
      expect(enriched.primaryAction.enabled).toBe(true);
      expect(enriched.primaryAction.label).toBeTruthy();
    });

    it('ESCROWED: disabled (waiting for buyer payment)', () => {
      // Regular user-merchant BUY: user=buyer, merchant=seller
      // buyer_merchant_id is null (no M2M), escrow_tx_hash set to show escrow locked
      const order = makeOrder({
        status: 'escrowed',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
        escrow_tx_hash: 'mock_tx_hash',
        buyer_merchant_id: null,
      });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      // Seller: no buyer_merchant_id means unclaimed, so waiting for acceptor
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('PAYMENT_SENT: CONFIRM_PAYMENT enabled', () => {
      const order = makeOrder({
        status: 'payment_sent',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.primaryAction.type).toBe('CONFIRM_PAYMENT');
      expect(enriched.primaryAction.enabled).toBe(true);
    });
  });

  // ── BUY Order: Buyer (User) ───────────────────────────────────────

  describe('BUY order — Buyer (user)', () => {
    it('OPEN: disabled primary', () => {
      const order = makeOrder({ status: 'pending', type: 'buy' });
      const enriched = enrichOrderResponse(order, USER_ID);
      expect(enriched.my_role).toBe('buyer');
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('ACCEPTED: disabled (waiting for escrow)', () => {
      const order = makeOrder({ status: 'accepted', type: 'buy' });
      const enriched = enrichOrderResponse(order, USER_ID);
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('ESCROWED: SEND_PAYMENT enabled', () => {
      // Regular BUY: user=buyer. No buyer_merchant_id needed.
      const order = makeOrder({
        status: 'escrowed',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
        escrow_tx_hash: 'mock_tx_hash',
        buyer_merchant_id: null,
      });
      const enriched = enrichOrderResponse(order, USER_ID);
      expect(enriched.primaryAction.type).toBe('SEND_PAYMENT');
      expect(enriched.primaryAction.enabled).toBe(true);
    });

    it('PAYMENT_SENT: disabled (waiting for confirmation)', () => {
      const order = makeOrder({
        status: 'payment_sent',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const enriched = enrichOrderResponse(order, USER_ID);
      expect(enriched.primaryAction.enabled).toBe(false);
    });
  });

  // ── SELL Order: Seller (User) ─────────────────────────────────────

  describe('SELL order — Seller (user)', () => {
    it('ACCEPTED: LOCK_ESCROW enabled', () => {
      const order = makeOrder({ status: 'accepted', type: 'sell' });
      const enriched = enrichOrderResponse(order, USER_ID);
      expect(enriched.my_role).toBe('seller');
      expect(enriched.primaryAction.type).toBe('LOCK_ESCROW');
      expect(enriched.primaryAction.enabled).toBe(true);
    });

    it('PAYMENT_SENT: CONFIRM_PAYMENT enabled', () => {
      const order = makeOrder({
        status: 'payment_sent',
        type: 'sell',
        escrow_debited_entity_id: USER_ID,
      });
      const enriched = enrichOrderResponse(order, USER_ID);
      expect(enriched.primaryAction.type).toBe('CONFIRM_PAYMENT');
      expect(enriched.primaryAction.enabled).toBe(true);
    });
  });

  // ── SELL Order: Buyer (Merchant) ──────────────────────────────────

  describe('SELL order — Buyer (merchant)', () => {
    it('ACCEPTED: disabled (waiting for seller escrow)', () => {
      const order = makeOrder({ status: 'accepted', type: 'sell' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.my_role).toBe('buyer');
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('ESCROWED: SEND_PAYMENT enabled', () => {
      // Regular SELL: user=seller, merchant=buyer. No M2M.
      const order = makeOrder({
        status: 'escrowed',
        type: 'sell',
        escrow_debited_entity_id: USER_ID,
        escrow_tx_hash: 'mock_tx_hash',
        buyer_merchant_id: null,
      });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.primaryAction.type).toBe('SEND_PAYMENT');
      expect(enriched.primaryAction.enabled).toBe(true);
    });
  });

  // ── Observer ──────────────────────────────────────────────────────

  describe('Observer view', () => {
    it('OPEN: observer sees ACCEPT enabled', () => {
      const order = makeOrder({ status: 'pending', type: 'buy' });
      const enriched = enrichOrderResponse(order, OBSERVER_ID);
      expect(enriched.my_role).toBe('observer');
      expect(enriched.primaryAction.type).toBe('ACCEPT');
      expect(enriched.primaryAction.enabled).toBe(true);
    });

    it('ACCEPTED: observer sees disabled (already accepted)', () => {
      const order = makeOrder({ status: 'accepted', type: 'buy' });
      const enriched = enrichOrderResponse(order, OBSERVER_ID);
      expect(enriched.my_role).toBe('observer');
      expect(enriched.primaryAction.enabled).toBe(false);
    });
  });

  // ── Terminal States ───────────────────────────────────────────────

  describe('Terminal states', () => {
    const terminalStatuses = ['completed', 'cancelled', 'expired'];

    for (const status of terminalStatuses) {
      it(`${status}: isTerminal=true, primary disabled, no type`, () => {
        const order = makeOrder({ status });
        const enriched = enrichOrderResponse(order, MERCHANT_ID);
        expect(enriched.isTerminal).toBe(true);
        expect(enriched.primaryAction.enabled).toBe(false);
        expect(enriched.primaryAction.type).toBeNull();
      });
    }
  });

  // ── Disputed ──────────────────────────────────────────────────────

  describe('Disputed state', () => {
    it('disputed: all actions disabled', () => {
      const order = makeOrder({ status: 'disputed' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.primaryAction.enabled).toBe(false);
    });
  });

  // ── showChat ──────────────────────────────────────────────────────

  describe('showChat', () => {
    it('open order: showChat = false', () => {
      const order = makeOrder({ status: 'pending' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.showChat).toBe(false);
    });

    it('accepted order: showChat = true', () => {
      const order = makeOrder({ status: 'accepted' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.showChat).toBe(true);
    });

    it('escrowed order: showChat = true (for non-observer)', () => {
      const order = makeOrder({
        status: 'escrowed',
        escrow_debited_entity_id: MERCHANT_ID,
        escrow_tx_hash: 'mock_tx_hash',
      });
      // MERCHANT_ID is seller in BUY → showChat = role !== 'observer' → true
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.showChat).toBe(true);
    });

    it('completed order: showChat = false (terminal)', () => {
      const order = makeOrder({ status: 'completed' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.showChat).toBe(false);
    });
  });

  // ── M2M Role Resolution ───────────────────────────────────────────

  describe('M2M role resolution', () => {
    it('M2M SELL: merchant_id = seller, buyer_merchant_id = buyer', () => {
      const order = makeOrder({
        type: 'sell',
        buyer_merchant_id: BUYER_MERCHANT_ID,
      });

      const sellerView = enrichOrderResponse(order, MERCHANT_ID);
      const buyerView = enrichOrderResponse(order, BUYER_MERCHANT_ID);

      // In sell: merchant_id=seller, buyer_merchant_id=buyer
      expect(sellerView.my_role).toBe('seller');
      expect(buyerView.my_role).toBe('buyer');
    });

    it('M2M BUY: merchant_id = seller, buyer_merchant_id = buyer (same as SELL)', () => {
      // M2M: roles are type-agnostic. merchant_id=seller, buyer_merchant_id=buyer always.
      const order = makeOrder({
        type: 'buy',
        buyer_merchant_id: BUYER_MERCHANT_ID,
      });

      const m1View = enrichOrderResponse(order, MERCHANT_ID);
      const m2View = enrichOrderResponse(order, BUYER_MERCHANT_ID);

      // M2M: merchant_id=seller, buyer_merchant_id=buyer (type-agnostic)
      expect(m1View.my_role).toBe('seller');
      expect(m2View.my_role).toBe('buyer');
    });
  });

  // ── Secondary Actions ─────────────────────────────────────────────

  describe('Secondary actions', () => {
    it('accepted: secondaryAction is CANCEL', () => {
      const order = makeOrder({ status: 'accepted', type: 'buy' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.secondaryAction).not.toBeNull();
      expect(enriched.secondaryAction?.type).toBe('CANCEL');
    });

    it('payment_sent: secondaryAction is DISPUTE', () => {
      const order = makeOrder({
        status: 'payment_sent',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      if (enriched.secondaryAction) {
        expect(enriched.secondaryAction.type).toBe('DISPUTE');
      }
    });

    it('completed: secondaryAction is null', () => {
      const order = makeOrder({ status: 'completed' });
      const enriched = enrichOrderResponse(order, MERCHANT_ID);
      expect(enriched.secondaryAction).toBeNull();
    });
  });
});
