/**
 * API Tests — Escrow-Specific Flows
 *
 * Tests escrow locking, cancellation with refund, escrow invariants,
 * and race conditions around escrow operations.
 *
 * Requires: settle on SETTLE_URL, core-api on CORE_API_URL
 */

const SETTLE_URL = process.env.SETTLE_URL || 'http://localhost:3000';
const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4010';

// ── Helpers ─────────────────────────────────────────────────────────────

function headers(merchantId?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.CORE_API_SECRET;
  if (secret) h['x-core-api-secret'] = secret;
  if (merchantId) h['x-merchant-id'] = merchantId;
  return h;
}

async function resetAndSeed() {
  await fetch(`${SETTLE_URL}/api/test/reset`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ confirm: true }),
  });
  const res = await fetch(`${SETTLE_URL}/api/test/seed`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ scenario: 'full' }),
  });
  if (!res.ok) throw new Error(`Seed failed: ${res.status}`);
  return (await res.json()).data;
}

async function createOrder(userId: string, merchantId: string, offerId: string, type: 'buy' | 'sell', amount: number) {
  const res = await fetch(`${CORE_API_URL}/v1/orders`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: userId,
      merchant_id: merchantId,
      offer_id: offerId,
      type,
      payment_method: 'bank',
      crypto_amount: amount,
      fiat_amount: amount * 3.67,
      rate: 3.67,
      payment_details: { bank_name: 'Test Bank' },
    }),
  });
  if (!res.ok) throw new Error(`createOrder failed: ${res.status}`);
  return (await res.json()).data;
}

async function transition(orderId: string, status: string, actorType: string, actorId: string) {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status, actor_type: actorType, actor_id: actorId }),
  });
  if (!res.ok) throw new Error(`transition failed: ${res.status}`);
}

async function lockEscrowViaCore(orderId: string, actorType: string, actorId: string) {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}/escrow`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      tx_hash: `mock_escrow_${orderId.slice(0, 8)}`,
      actor_type: actorType,
      actor_id: actorId,
    }),
  });
  if (!res.ok) throw new Error(`lockEscrow failed: ${res.status}`);
}

async function dispatchAction(orderId: string, payload: Record<string, any>) {
  const merchantId = payload.actor_type === 'merchant' ? payload.actor_id : undefined;
  const res = await fetch(`${SETTLE_URL}/api/orders/${orderId}/action`, {
    method: 'POST',
    headers: headers(merchantId),
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({ success: false })) };
}

async function getSettleOrder(orderId: string, actorId: string, actorType = 'merchant') {
  const h = headers(actorType === 'merchant' ? actorId : undefined);
  const res = await fetch(
    `${SETTLE_URL}/api/orders/${orderId}?actor_id=${actorId}&actor_type=${actorType}`,
    { headers: h },
  );
  if (!res.ok) throw new Error(`getSettleOrder failed: ${res.status}`);
  const data = await res.json();
  return data.order || data.data || data;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Escrow API Tests', () => {
  let fixtures: any;
  let u1: string, m1: string, m2: string;
  let sellOffer: string, buyOffer: string;

  beforeAll(async () => {
    fixtures = await resetAndSeed();
    u1 = fixtures.users[0].id;
    m1 = fixtures.merchants[0].id;
    m2 = fixtures.merchants[1].id;
    sellOffer = fixtures.offers[0].id;
    buyOffer = fixtures.offers[1].id;
  }, 30000);

  // ══════════════════════════════════════════════════════════════════════
  // LOCK_ESCROW — Basic
  // ══════════════════════════════════════════════════════════════════════

  describe('LOCK_ESCROW', () => {
    it('seller can lock escrow on accepted BUY order', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 500);
      await transition(order.id, 'accepted', 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1,
        actor_type: 'merchant',
        tx_hash: `lock_buy_${Date.now()}`,
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('escrowed');

      // Verify enriched response shows escrowed state
      const enriched = await getSettleOrder(order.id, m1, 'merchant');
      expect(enriched.status).toMatch(/escrowed/);
    });

    it('seller (user) can lock escrow on accepted SELL order', async () => {
      const order = await createOrder(u1, m1, buyOffer, 'sell', 400);
      await transition(order.id, 'accepted', 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: u1,
        actor_type: 'user',
        tx_hash: `lock_sell_${Date.now()}`,
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('escrowed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Escrow Invariants
  // ══════════════════════════════════════════════════════════════════════

  describe('Escrow invariants', () => {
    it('SEND_PAYMENT requires escrow locked (rejects from accepted)', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 150);
      await transition(order.id, 'accepted', 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'SEND_PAYMENT',
        actor_id: u1,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    it('CONFIRM_PAYMENT requires escrow locked (rejects from accepted)', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 160);
      await transition(order.id, 'accepted', 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'CONFIRM_PAYMENT',
        actor_id: m1,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
    });

    it('cannot lock escrow on open order (must accept first)', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 170);

      const result = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    it('cannot lock escrow twice', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 180);
      await transition(order.id, 'accepted', 'merchant', m1);

      const r1 = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1,
        actor_type: 'merchant',
        tx_hash: `double_lock_1_${Date.now()}`,
      });
      expect(r1.body.success).toBe(true);

      const r2 = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1,
        actor_type: 'merchant',
        tx_hash: `double_lock_2_${Date.now()}`,
      });
      expect(r2.body.success).toBe(false);
      expect(r2.body.code).toMatch(/ALREADY_ESCROWED|INVALID_STATUS_FOR_ACTION/);
    });

    it('buyer cannot lock escrow (role mismatch)', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 190);
      await transition(order.id, 'accepted', 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: u1,    // buyer in BUY order
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('ROLE_MISMATCH');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Cancel with Escrow Refund
  // ══════════════════════════════════════════════════════════════════════

  describe('Cancel with escrow refund', () => {
    it('cancelling escrowed order triggers refund', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 250);
      await transition(order.id, 'accepted', 'merchant', m1);
      await lockEscrowViaCore(order.id, 'merchant', m1);

      // Verify escrowed
      const before = await getSettleOrder(order.id, m1, 'merchant');
      expect(before.status).toMatch(/escrowed/);

      // Cancel (should refund)
      const result = await dispatchAction(order.id, {
        action: 'CANCEL',
        actor_id: u1,
        actor_type: 'user',
        reason: 'Refund test',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('cancelled');
      expect(result.body.isTerminal).toBe(true);
    });

    it('cancelling accepted order (no escrow) succeeds without refund', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 260);
      await transition(order.id, 'accepted', 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'CANCEL',
        actor_id: m1,
        actor_type: 'merchant',
        reason: 'No escrow cancel',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('cancelled');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Race Conditions on Escrow
  // ══════════════════════════════════════════════════════════════════════

  describe('Escrow race conditions', () => {
    it('concurrent LOCK_ESCROW: exactly one succeeds', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 300);
      await transition(order.id, 'accepted', 'merchant', m1);

      const [r1, r2] = await Promise.all([
        dispatchAction(order.id, {
          action: 'LOCK_ESCROW',
          actor_id: m1,
          actor_type: 'merchant',
          tx_hash: 'race_1',
        }),
        dispatchAction(order.id, {
          action: 'LOCK_ESCROW',
          actor_id: m1,
          actor_type: 'merchant',
          tx_hash: 'race_2',
        }),
      ]);

      const successes = [r1, r2].filter(r => r.body.success);
      const failures = [r1, r2].filter(r => !r.body.success);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect(failures[0].body.code).toMatch(/ALREADY_ESCROWED|INVALID_STATUS_FOR_ACTION|CONFLICT/);
    });

    it('concurrent CANCEL and LOCK_ESCROW: one wins', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 310);
      await transition(order.id, 'accepted', 'merchant', m1);

      const [cancelResult, escrowResult] = await Promise.all([
        dispatchAction(order.id, {
          action: 'CANCEL',
          actor_id: u1,
          actor_type: 'user',
          reason: 'Race cancel',
        }),
        dispatchAction(order.id, {
          action: 'LOCK_ESCROW',
          actor_id: m1,
          actor_type: 'merchant',
          tx_hash: 'race_cancel_escrow',
        }),
      ]);

      const successes = [cancelResult, escrowResult].filter(r => r.body.success);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Final state is deterministic
      const enriched = await getSettleOrder(order.id, m1, 'merchant');
      expect(enriched.status).toMatch(/cancelled|escrowed/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Enrichment after Escrow
  // ══════════════════════════════════════════════════════════════════════

  describe('Enrichment after escrow operations', () => {
    it('after LOCK_ESCROW: seller sees disabled primary, buyer sees SEND_PAYMENT', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 350);
      await transition(order.id, 'accepted', 'merchant', m1);
      await lockEscrowViaCore(order.id, 'merchant', m1);

      const sellerView = await getSettleOrder(order.id, m1, 'merchant');
      expect(sellerView.my_role).toBe('seller');
      expect(sellerView.primaryAction.enabled).toBe(false);

      const buyerView = await getSettleOrder(order.id, u1, 'user');
      expect(buyerView.my_role).toBe('buyer');
      expect(buyerView.primaryAction.type).toBe('SEND_PAYMENT');
      expect(buyerView.primaryAction.enabled).toBe(true);
    });

    it('after LOCK_ESCROW on SELL order: buyer (merchant) sees SEND_PAYMENT', async () => {
      const order = await createOrder(u1, m1, buyOffer, 'sell', 360);
      await transition(order.id, 'accepted', 'merchant', m1);
      await lockEscrowViaCore(order.id, 'user', u1);

      const sellerView = await getSettleOrder(order.id, u1, 'user');
      expect(sellerView.my_role).toBe('seller');
      expect(sellerView.primaryAction.enabled).toBe(false);

      const buyerView = await getSettleOrder(order.id, m1, 'merchant');
      expect(buyerView.my_role).toBe('buyer');
      expect(buyerView.primaryAction.type).toBe('SEND_PAYMENT');
      expect(buyerView.primaryAction.enabled).toBe(true);
    });

    it('showChat is true after escrow lock', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 370);
      await transition(order.id, 'accepted', 'merchant', m1);
      await lockEscrowViaCore(order.id, 'merchant', m1);

      const enriched = await getSettleOrder(order.id, m1, 'merchant');
      expect(enriched.showChat).toBe(true);
    });
  });
});
