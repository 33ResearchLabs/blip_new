/**
 * Unit Tests — Chat Availability (Backend Source of Truth)
 *
 * getChatAvailability() is the SINGLE function that determines whether
 * a user/merchant/compliance officer can send messages on an order.
 * Both the API endpoint and the message POST handler call it.
 *
 * Every test here is a real scenario from the P2P trading lifecycle.
 */

import { getChatAvailability, hasBothParties } from '@/lib/chat/availability';

// ── Factory ────────────────────────────────────────────────────────────
function makeOrder(overrides: Partial<{
  id: string;
  status: string;
  user_id: string | null;
  merchant_id: string | null;
  buyer_merchant_id: string | null;
  chat_frozen: boolean;
  chat_frozen_by: string | null;
}> = {}) {
  return {
    id: 'order-001',
    status: 'accepted',
    user_id: 'user-001',
    merchant_id: 'merchant-001',
    buyer_merchant_id: null,
    chat_frozen: false,
    chat_frozen_by: null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════
// getChatAvailability
// ════════════════════════════════════════════════════════════════════════

describe('getChatAvailability', () => {
  // ── Order status lifecycle ──────────────────────────────────────────

  describe('pending/open orders → chat disabled', () => {
    it.each(['open', 'pending'])('status "%s" → disabled for user', (status) => {
      const result = getChatAvailability(makeOrder({ status }), 'user');
      expect(result.enabled).toBe(false);
      expect(result.reason).toMatch(/waiting/i);
    });

    it.each(['open', 'pending'])('status "%s" → disabled for merchant', (status) => {
      const result = getChatAvailability(makeOrder({ status }), 'merchant');
      expect(result.enabled).toBe(false);
      expect(result.reason).toMatch(/waiting/i);
    });

    it.each(['open', 'pending'])('status "%s" → disabled for compliance', (status) => {
      const result = getChatAvailability(makeOrder({ status }), 'compliance');
      expect(result.enabled).toBe(false);
      expect(result.reason).toMatch(/waiting/i);
    });
  });

  describe('active orders → chat enabled', () => {
    it.each(['accepted', 'escrowed', 'payment_sent', 'disputed'])(
      'status "%s" → enabled for user',
      (status) => {
        const result = getChatAvailability(makeOrder({ status }), 'user');
        expect(result.enabled).toBe(true);
        expect(result.reason).toBeNull();
      }
    );

    it.each(['accepted', 'escrowed', 'payment_sent', 'disputed'])(
      'status "%s" → enabled for merchant',
      (status) => {
        const result = getChatAvailability(makeOrder({ status }), 'merchant');
        expect(result.enabled).toBe(true);
        expect(result.reason).toBeNull();
      }
    );
  });

  describe('closed orders → chat disabled for regular users', () => {
    it.each(['completed', 'cancelled', 'expired'])(
      'status "%s" → disabled for user',
      (status) => {
        const result = getChatAvailability(makeOrder({ status }), 'user');
        expect(result.enabled).toBe(false);
        expect(result.reason).toMatch(new RegExp(status, 'i'));
      }
    );

    it.each(['completed', 'cancelled', 'expired'])(
      'status "%s" → disabled for merchant',
      (status) => {
        const result = getChatAvailability(makeOrder({ status }), 'merchant');
        expect(result.enabled).toBe(false);
        expect(result.reason).toMatch(/closed/i);
      }
    );
  });

  // ── Compliance override ─────────────────────────────────────────────

  describe('compliance override on closed orders', () => {
    it.each(['completed', 'cancelled', 'expired'])(
      'status "%s" → compliance CAN still message',
      (status) => {
        const result = getChatAvailability(makeOrder({ status }), 'compliance');
        expect(result.enabled).toBe(true);
      }
    );

    it('system actor can message on closed orders', () => {
      const result = getChatAvailability(makeOrder({ status: 'completed' }), 'system');
      expect(result.enabled).toBe(true);
    });
  });

  // ── Frozen chat ─────────────────────────────────────────────────────

  describe('frozen chat', () => {
    const frozen = makeOrder({ chat_frozen: true, chat_frozen_by: 'compliance-001' });

    it('user CANNOT message when chat is frozen', () => {
      const result = getChatAvailability(frozen, 'user');
      expect(result.enabled).toBe(false);
      expect(result.reason).toMatch(/frozen/i);
    });

    it('merchant CANNOT message when chat is frozen', () => {
      const result = getChatAvailability(frozen, 'merchant');
      expect(result.enabled).toBe(false);
      expect(result.reason).toMatch(/frozen/i);
    });

    it('compliance CAN message when chat is frozen', () => {
      const result = getChatAvailability(frozen, 'compliance');
      expect(result.enabled).toBe(true);
    });

    it('system CAN message when chat is frozen', () => {
      const result = getChatAvailability(frozen, 'system');
      expect(result.enabled).toBe(true);
    });
  });

  // ── Disputed orders ─────────────────────────────────────────────────

  describe('disputed orders', () => {
    const disputed = makeOrder({ status: 'disputed' });

    it('all three parties can message during dispute', () => {
      expect(getChatAvailability(disputed, 'user').enabled).toBe(true);
      expect(getChatAvailability(disputed, 'merchant').enabled).toBe(true);
      expect(getChatAvailability(disputed, 'compliance').enabled).toBe(true);
    });
  });

  // ── Unknown status (fail closed) ──────────────────────────────────

  describe('unknown/invalid status → fail closed', () => {
    it('unrecognized status disables chat', () => {
      const result = getChatAvailability(makeOrder({ status: 'some_new_status' }), 'user');
      expect(result.enabled).toBe(false);
      expect(result.reason).toBeTruthy();
    });
  });

  // ── Race condition: frozen + closed ──────────────────────────────

  describe('frozen takes priority over closed', () => {
    it('frozen order shows "frozen" reason, not "closed"', () => {
      const order = makeOrder({ status: 'completed', chat_frozen: true });
      const result = getChatAvailability(order, 'user');
      expect(result.enabled).toBe(false);
      // Frozen check runs BEFORE closed check
      expect(result.reason).toMatch(/frozen/i);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// hasBothParties
// ════════════════════════════════════════════════════════════════════════

describe('hasBothParties', () => {
  it('U2M: user + merchant → true', () => {
    expect(hasBothParties(makeOrder())).toBe(true);
  });

  it('U2M: user only, no merchant → false', () => {
    expect(hasBothParties(makeOrder({ merchant_id: null }))).toBe(false);
  });

  it('U2M: merchant only, no user → false', () => {
    expect(hasBothParties(makeOrder({ user_id: null }))).toBe(false);
  });

  it('M2M: merchant_id + buyer_merchant_id → true', () => {
    expect(hasBothParties(makeOrder({
      user_id: null,
      merchant_id: 'merchant-001',
      buyer_merchant_id: 'merchant-002',
    }))).toBe(true);
  });

  it('M2M: merchant_id only, no buyer → false', () => {
    expect(hasBothParties(makeOrder({
      user_id: null,
      merchant_id: 'merchant-001',
      buyer_merchant_id: null,
    }))).toBe(false);
  });

  it('empty order → false', () => {
    expect(hasBothParties(makeOrder({
      user_id: null,
      merchant_id: null,
      buyer_merchant_id: null,
    }))).toBe(false);
  });
});
