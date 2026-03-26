/**
 * Unit Tests for handleOrderAction — Action-Based Order State Machine
 *
 * Tests the core validation logic: role resolution, action rules,
 * escrow invariants, and state machine transitions.
 */

import {
  handleOrderAction,
  resolveTradeRole,
  getAllowedActions,
  type OrderAction,
} from '../../src/lib/orders/handleOrderAction';

// ── Test helpers ───────────────────────────────────────────────────────

const USER_ID = '00000000-0000-0000-0000-000000000001';
const MERCHANT_ID = '00000000-0000-0000-0000-000000000002';
const BUYER_MERCHANT_ID = '00000000-0000-0000-0000-000000000003';
const OBSERVER_ID = '00000000-0000-0000-0000-000000000099';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    status: 'pending' as any,
    type: 'buy' as any,
    user_id: USER_ID,
    merchant_id: MERCHANT_ID,
    buyer_merchant_id: null,
    escrow_debited_entity_id: null,
    order_version: 1,
    ...overrides,
  };
}

// ── resolveTradeRole ───────────────────────────────────────────────────

describe('resolveTradeRole', () => {
  describe('BUY orders (user buys crypto)', () => {
    it('user = buyer', () => {
      const order = makeOrder({ type: 'buy' });
      expect(resolveTradeRole(order, USER_ID)).toBe('buyer');
    });

    it('merchant = seller', () => {
      const order = makeOrder({ type: 'buy' });
      expect(resolveTradeRole(order, MERCHANT_ID)).toBe('seller');
    });

    it('observer = null', () => {
      const order = makeOrder({ type: 'buy' });
      expect(resolveTradeRole(order, OBSERVER_ID)).toBeNull();
    });
  });

  describe('SELL orders (user sells crypto)', () => {
    it('user = seller', () => {
      const order = makeOrder({ type: 'sell' });
      expect(resolveTradeRole(order, USER_ID)).toBe('seller');
    });

    it('merchant = buyer', () => {
      const order = makeOrder({ type: 'sell' });
      expect(resolveTradeRole(order, MERCHANT_ID)).toBe('buyer');
    });
  });

  describe('M2M orders', () => {
    it('M2M BUY: buyer_merchant_id = always buyer', () => {
      // buyer_merchant_id is ALWAYS buyer regardless of stored type (matches SQL)
      const order = makeOrder({ type: 'buy', buyer_merchant_id: BUYER_MERCHANT_ID });
      expect(resolveTradeRole(order, BUYER_MERCHANT_ID)).toBe('buyer');
    });

    it('M2M BUY: merchant_id = always seller', () => {
      const order = makeOrder({ type: 'buy', buyer_merchant_id: BUYER_MERCHANT_ID });
      expect(resolveTradeRole(order, MERCHANT_ID)).toBe('seller');
    });

    it('M2M SELL: merchant_id = always seller', () => {
      // merchant_id is ALWAYS seller regardless of stored type (matches SQL)
      const order = makeOrder({ type: 'sell', buyer_merchant_id: BUYER_MERCHANT_ID });
      expect(resolveTradeRole(order, MERCHANT_ID)).toBe('seller');
    });

    it('M2M SELL: buyer_merchant_id = always buyer', () => {
      const order = makeOrder({ type: 'sell', buyer_merchant_id: BUYER_MERCHANT_ID });
      expect(resolveTradeRole(order, BUYER_MERCHANT_ID)).toBe('buyer');
    });
  });
});

// ── handleOrderAction ──────────────────────────────────────────────────

describe('handleOrderAction', () => {
  // ── ACCEPT ─────────────────────────────────────────────────────────

  describe('ACCEPT', () => {
    it('allows observer to accept open order', () => {
      const order = makeOrder({ status: 'pending' });
      const result = handleOrderAction(order, 'ACCEPT', OBSERVER_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('accepted');
    });

    it('rejects self-accept (user_id)', () => {
      const order = makeOrder({ status: 'pending' });
      const result = handleOrderAction(order, 'ACCEPT', USER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('SELF_ACCEPT');
    });

    it('allows merchant_id to accept (pre-assigned counterparty, not creator)', () => {
      // merchant_id is the matched merchant, NOT the order creator (user_id is creator)
      // Self-accept guard only blocks user_id
      const order = makeOrder({ status: 'pending' });
      const result = handleOrderAction(order, 'ACCEPT', MERCHANT_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('accepted');
    });

    it('rejects accept from non-open status', () => {
      const order = makeOrder({ status: 'escrowed' });
      const result = handleOrderAction(order, 'ACCEPT', OBSERVER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    it('rejects accept on completed order', () => {
      const order = makeOrder({ status: 'completed' });
      const result = handleOrderAction(order, 'ACCEPT', OBSERVER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('TERMINAL_STATE');
    });
  });

  // ── LOCK_ESCROW ────────────────────────────────────────────────────

  describe('LOCK_ESCROW', () => {
    it('allows seller to lock escrow from accepted (buy order)', () => {
      const order = makeOrder({ status: 'accepted', type: 'buy' });
      const result = handleOrderAction(order, 'LOCK_ESCROW', MERCHANT_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('escrowed');
    });

    it('allows seller to lock escrow from accepted (sell order)', () => {
      const order = makeOrder({ status: 'accepted', type: 'sell' });
      const result = handleOrderAction(order, 'LOCK_ESCROW', USER_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('escrowed');
    });

    it('rejects buyer trying to lock escrow (buy order)', () => {
      const order = makeOrder({ status: 'accepted', type: 'buy' });
      const result = handleOrderAction(order, 'LOCK_ESCROW', USER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('ROLE_MISMATCH');
    });

    it('rejects lock_escrow from open status', () => {
      const order = makeOrder({ status: 'pending' });
      const result = handleOrderAction(order, 'LOCK_ESCROW', MERCHANT_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    it('rejects lock_escrow from escrowed (already locked)', () => {
      const order = makeOrder({ status: 'escrowed' });
      const result = handleOrderAction(order, 'LOCK_ESCROW', MERCHANT_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_STATUS_FOR_ACTION');
    });
  });

  // ── SEND_PAYMENT ───────────────────────────────────────────────────

  describe('SEND_PAYMENT', () => {
    it('allows buyer to send payment from escrowed (buy order)', () => {
      const order = makeOrder({
        status: 'escrowed',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const result = handleOrderAction(order, 'SEND_PAYMENT', USER_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('payment_sent');
    });

    it('allows send_payment from escrowed even if escrow_debited_entity_id is null (status trusted)', () => {
      // When status is 'escrowed', escrow IS locked by definition.
      // escrow_debited_entity_id may be NULL due to on-chain data inconsistency.
      // The guard only fires when currentMinimal !== 'escrowed'.
      const order = makeOrder({
        status: 'escrowed',
        type: 'buy',
        escrow_debited_entity_id: null,
      });
      const result = handleOrderAction(order, 'SEND_PAYMENT', USER_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('payment_sent');
    });

    it('rejects seller trying to send payment (buy order)', () => {
      const order = makeOrder({
        status: 'escrowed',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const result = handleOrderAction(order, 'SEND_PAYMENT', MERCHANT_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('ROLE_MISMATCH');
    });

    it('rejects send_payment from accepted (must escrow first)', () => {
      const order = makeOrder({
        status: 'accepted',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const result = handleOrderAction(order, 'SEND_PAYMENT', USER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_STATUS_FOR_ACTION');
    });
  });

  // ── CONFIRM_PAYMENT ────────────────────────────────────────────────

  describe('CONFIRM_PAYMENT', () => {
    it('allows seller to confirm payment (buy order)', () => {
      const order = makeOrder({
        status: 'payment_sent',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const result = handleOrderAction(order, 'CONFIRM_PAYMENT', MERCHANT_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('completed');
    });

    it('rejects buyer trying to confirm payment', () => {
      const order = makeOrder({
        status: 'payment_sent',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const result = handleOrderAction(order, 'CONFIRM_PAYMENT', USER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('ROLE_MISMATCH');
    });

    it('rejects confirm_payment without escrow', () => {
      const order = makeOrder({
        status: 'payment_sent',
        type: 'buy',
        escrow_debited_entity_id: null,
      });
      const result = handleOrderAction(order, 'CONFIRM_PAYMENT', MERCHANT_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('ESCROW_REQUIRED');
    });

    it('rejects confirm_payment from escrowed (must send payment first)', () => {
      const order = makeOrder({
        status: 'escrowed',
        type: 'buy',
        escrow_debited_entity_id: MERCHANT_ID,
      });
      const result = handleOrderAction(order, 'CONFIRM_PAYMENT', MERCHANT_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_STATUS_FOR_ACTION');
    });
  });

  // ── CANCEL ─────────────────────────────────────────────────────────

  describe('CANCEL', () => {
    it('allows buyer to cancel open order', () => {
      const order = makeOrder({ status: 'pending', type: 'buy' });
      const result = handleOrderAction(order, 'CANCEL', USER_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('cancelled');
    });

    it('allows seller to cancel accepted order', () => {
      const order = makeOrder({ status: 'accepted', type: 'buy' });
      const result = handleOrderAction(order, 'CANCEL', MERCHANT_ID);
      expect(result.success).toBe(true);
    });

    it('allows cancel from escrowed', () => {
      const order = makeOrder({ status: 'escrowed', type: 'buy' });
      const result = handleOrderAction(order, 'CANCEL', USER_ID);
      expect(result.success).toBe(true);
    });

    it('rejects cancel from payment_sent (must dispute instead)', () => {
      const order = makeOrder({ status: 'payment_sent', type: 'buy' });
      const result = handleOrderAction(order, 'CANCEL', USER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    it('rejects cancel from completed', () => {
      const order = makeOrder({ status: 'completed' });
      const result = handleOrderAction(order, 'CANCEL', USER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('TERMINAL_STATE');
    });
  });

  // ── DISPUTE ────────────────────────────────────────────────────────

  describe('DISPUTE', () => {
    it('allows dispute from escrowed', () => {
      const order = makeOrder({ status: 'escrowed', type: 'buy' });
      const result = handleOrderAction(order, 'DISPUTE', USER_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('disputed');
    });

    it('allows dispute from payment_sent', () => {
      const order = makeOrder({ status: 'payment_sent', type: 'buy' });
      const result = handleOrderAction(order, 'DISPUTE', MERCHANT_ID);
      expect(result.success).toBe(true);
    });

    it('rejects dispute from open (no escrow yet)', () => {
      const order = makeOrder({ status: 'pending' });
      const result = handleOrderAction(order, 'DISPUTE', USER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    it('rejects dispute from accepted (no escrow yet)', () => {
      const order = makeOrder({ status: 'accepted' });
      const result = handleOrderAction(order, 'DISPUTE', USER_ID);
      expect(result.success).toBe(false);
    });
  });

  // ── Terminal state guard ───────────────────────────────────────────

  describe('Terminal state guard', () => {
    const terminalStatuses = ['completed', 'cancelled', 'expired'];
    const allActions: OrderAction[] = ['ACCEPT', 'LOCK_ESCROW', 'SEND_PAYMENT', 'CONFIRM_PAYMENT', 'CANCEL', 'DISPUTE'];

    for (const status of terminalStatuses) {
      for (const action of allActions) {
        it(`rejects ${action} from ${status}`, () => {
          const order = makeOrder({ status });
          const result = handleOrderAction(order, action, OBSERVER_ID);
          expect(result.success).toBe(false);
          expect(result.code).toBe('TERMINAL_STATE');
        });
      }
    }
  });

  // ── Unknown action ─────────────────────────────────────────────────

  describe('Unknown action', () => {
    it('rejects unknown action', () => {
      const order = makeOrder({ status: 'pending' });
      const result = handleOrderAction(order, 'INVALID' as any, USER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNKNOWN_ACTION');
    });
  });

  // ── Non-participant guard ──────────────────────────────────────────

  describe('Non-participant guard', () => {
    it('rejects non-participant for LOCK_ESCROW', () => {
      const order = makeOrder({ status: 'accepted' });
      const result = handleOrderAction(order, 'LOCK_ESCROW', OBSERVER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_PARTICIPANT');
    });

    it('allows observer SEND_PAYMENT on unclaimed escrowed order (auto-claim+pay)', () => {
      // Observer on unclaimed escrowed order triggers auto-claim+pay path:
      // isAutoClaimPayment = SEND_PAYMENT && escrowed && !buyer_merchant_id && !isAlreadyParticipant
      const order = makeOrder({
        status: 'escrowed',
        escrow_debited_entity_id: MERCHANT_ID,
        buyer_merchant_id: null,
      });
      const result = handleOrderAction(order, 'SEND_PAYMENT', OBSERVER_ID);
      expect(result.success).toBe(true);
      expect(result.targetStatus).toBe('payment_sent');
    });

    it('rejects non-participant for SEND_PAYMENT on claimed order', () => {
      // When buyer_merchant_id is set, the order is claimed — observer is rejected
      const order = makeOrder({
        status: 'escrowed',
        escrow_debited_entity_id: MERCHANT_ID,
        buyer_merchant_id: USER_ID,
      });
      const result = handleOrderAction(order, 'SEND_PAYMENT', OBSERVER_ID);
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_PARTICIPANT');
    });
  });

  // ── Step-skipping prevention ───────────────────────────────────────

  describe('Step-skipping prevention', () => {
    it('cannot skip from open directly to escrowed', () => {
      const order = makeOrder({ status: 'pending', type: 'buy' });
      const result = handleOrderAction(order, 'LOCK_ESCROW', MERCHANT_ID);
      expect(result.success).toBe(false);
    });

    it('cannot skip from open directly to payment_sent', () => {
      const order = makeOrder({ status: 'pending', type: 'buy' });
      const result = handleOrderAction(order, 'SEND_PAYMENT', USER_ID);
      expect(result.success).toBe(false);
    });

    it('cannot skip from accepted directly to completed', () => {
      const order = makeOrder({ status: 'accepted', type: 'buy' });
      const result = handleOrderAction(order, 'CONFIRM_PAYMENT', MERCHANT_ID);
      expect(result.success).toBe(false);
    });
  });
});

// ── getAllowedActions ──────────────────────────────────────────────────

describe('getAllowedActions', () => {
  it('returns ACCEPT for observer on open order', () => {
    const order = makeOrder({ status: 'pending' });
    const actions = getAllowedActions(order, OBSERVER_ID);
    expect(actions).toContain('ACCEPT');
    expect(actions).not.toContain('LOCK_ESCROW');
  });

  it('returns LOCK_ESCROW + CANCEL for seller on accepted order', () => {
    const order = makeOrder({ status: 'accepted', type: 'buy' });
    const actions = getAllowedActions(order, MERCHANT_ID);
    expect(actions).toContain('LOCK_ESCROW');
    expect(actions).toContain('CANCEL');
    expect(actions).not.toContain('ACCEPT');
  });

  it('returns SEND_PAYMENT + CANCEL + DISPUTE for buyer on escrowed order', () => {
    const order = makeOrder({
      status: 'escrowed',
      type: 'buy',
      escrow_debited_entity_id: MERCHANT_ID,
    });
    const actions = getAllowedActions(order, USER_ID);
    expect(actions).toContain('SEND_PAYMENT');
    expect(actions).toContain('CANCEL');
    expect(actions).toContain('DISPUTE');
  });

  it('returns CONFIRM_PAYMENT + DISPUTE for seller on payment_sent', () => {
    const order = makeOrder({
      status: 'payment_sent',
      type: 'buy',
      escrow_debited_entity_id: MERCHANT_ID,
    });
    const actions = getAllowedActions(order, MERCHANT_ID);
    expect(actions).toContain('CONFIRM_PAYMENT');
    expect(actions).toContain('DISPUTE');
    expect(actions).not.toContain('CANCEL');
  });

  it('returns empty for completed order', () => {
    const order = makeOrder({ status: 'completed' });
    const actions = getAllowedActions(order, USER_ID);
    expect(actions).toHaveLength(0);
  });

  it('returns empty for cancelled order', () => {
    const order = makeOrder({ status: 'cancelled' });
    const actions = getAllowedActions(order, MERCHANT_ID);
    expect(actions).toHaveLength(0);
  });
});

// ── Full happy-path flow ──────────────────────────────────────────────

describe('Full happy-path flow (BUY order)', () => {
  it('open → accepted → escrowed → payment_sent → completed', () => {
    // 1. Observer accepts
    let order = makeOrder({ status: 'pending', type: 'buy' });
    let result = handleOrderAction(order, 'ACCEPT', OBSERVER_ID);
    expect(result.success).toBe(true);
    expect(result.targetStatus).toBe('accepted');

    // 2. Seller locks escrow
    order = makeOrder({ status: 'accepted', type: 'buy' });
    result = handleOrderAction(order, 'LOCK_ESCROW', MERCHANT_ID);
    expect(result.success).toBe(true);
    expect(result.targetStatus).toBe('escrowed');

    // 3. Buyer sends payment
    order = makeOrder({
      status: 'escrowed',
      type: 'buy',
      escrow_debited_entity_id: MERCHANT_ID,
    });
    result = handleOrderAction(order, 'SEND_PAYMENT', USER_ID);
    expect(result.success).toBe(true);
    expect(result.targetStatus).toBe('payment_sent');

    // 4. Seller confirms payment → completed
    order = makeOrder({
      status: 'payment_sent',
      type: 'buy',
      escrow_debited_entity_id: MERCHANT_ID,
    });
    result = handleOrderAction(order, 'CONFIRM_PAYMENT', MERCHANT_ID);
    expect(result.success).toBe(true);
    expect(result.targetStatus).toBe('completed');
  });
});

describe('Full happy-path flow (SELL order)', () => {
  it('open → accepted → escrowed → payment_sent → completed', () => {
    // 1. Observer accepts (becomes buyer)
    let order = makeOrder({ status: 'pending', type: 'sell' });
    let result = handleOrderAction(order, 'ACCEPT', OBSERVER_ID);
    expect(result.success).toBe(true);

    // 2. Seller (user) locks escrow
    order = makeOrder({ status: 'accepted', type: 'sell' });
    result = handleOrderAction(order, 'LOCK_ESCROW', USER_ID);
    expect(result.success).toBe(true);

    // 3. Buyer (merchant) sends fiat
    order = makeOrder({
      status: 'escrowed',
      type: 'sell',
      escrow_debited_entity_id: USER_ID,
    });
    result = handleOrderAction(order, 'SEND_PAYMENT', MERCHANT_ID);
    expect(result.success).toBe(true);

    // 4. Seller (user) confirms fiat receipt → completed
    order = makeOrder({
      status: 'payment_sent',
      type: 'sell',
      escrow_debited_entity_id: USER_ID,
    });
    result = handleOrderAction(order, 'CONFIRM_PAYMENT', USER_ID);
    expect(result.success).toBe(true);
    expect(result.targetStatus).toBe('completed');
  });
});
