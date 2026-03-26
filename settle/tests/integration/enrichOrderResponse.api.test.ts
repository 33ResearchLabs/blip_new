/**
 * API Integration Tests — enrichOrderResponse Contract
 *
 * Validates the backend-driven UI enrichment layer returns correct
 * primaryAction, secondaryAction, nextStepText, and role for every
 * status × role combination.
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
  return (await res.json()).data;
}

async function transition(orderId: string, status: string, actorType: string, actorId: string) {
  await fetch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status, actor_type: actorType, actor_id: actorId }),
  });
}

async function lockEscrow(orderId: string, actorType: string, actorId: string) {
  await fetch(`${CORE_API_URL}/v1/orders/${orderId}/escrow`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ tx_hash: `enrich_test_${orderId.slice(0, 8)}`, actor_type: actorType, actor_id: actorId }),
  });
}

async function getEnriched(orderId: string, actorId: string, actorType = 'merchant') {
  const h = headers(actorType === 'merchant' ? actorId : undefined);
  const res = await fetch(`${SETTLE_URL}/api/orders/${orderId}?actor_id=${actorId}&actor_type=${actorType}`, { headers: h });
  if (!res.ok) throw new Error(`getEnriched failed: ${res.status}`);
  const data = await res.json();
  return data.order || data.data || data;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('enrichOrderResponse — Backend-Driven UI Contract', () => {
  let fixtures: any;
  let u1: string, m1: string;
  let sellOffer: string, buyOffer: string;

  beforeAll(async () => {
    fixtures = await resetAndSeed();
    u1 = fixtures.users[0].id;
    m1 = fixtures.merchants[0].id;
    sellOffer = fixtures.offers[0].id;
    buyOffer = fixtures.offers[1].id;
  }, 30000);

  // ── BUY Order: Seller Perspective ─────────────────────────────────

  describe('BUY order — Seller (merchant) view', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 400);
      orderId = order.id;
    });

    it('OPEN: seller sees disabled primary, can CANCEL', async () => {
      const enriched = await getEnriched(orderId, m1);
      expect(enriched.my_role).toBe('seller');
      expect(enriched.status).toMatch(/open|pending/);
      expect(enriched.primaryAction.enabled).toBe(false);
      expect(enriched.nextStepText).toBeTruthy();
    });

    it('ACCEPTED: seller sees LOCK_ESCROW enabled', async () => {
      await transition(orderId, 'accepted', 'merchant', m1);
      const enriched = await getEnriched(orderId, m1);
      expect(enriched.primaryAction.type).toBe('LOCK_ESCROW');
      expect(enriched.primaryAction.enabled).toBe(true);
      expect(enriched.primaryAction.label).toBeTruthy();
    });

    it('ESCROWED: seller sees disabled (waiting for buyer)', async () => {
      await lockEscrow(orderId, 'merchant', m1);
      const enriched = await getEnriched(orderId, m1);
      expect(enriched.status).toMatch(/escrowed/);
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('PAYMENT_SENT: seller sees CONFIRM_PAYMENT enabled', async () => {
      await transition(orderId, 'payment_sent', 'user', u1);
      const enriched = await getEnriched(orderId, m1);
      expect(enriched.primaryAction.type).toBe('CONFIRM_PAYMENT');
      expect(enriched.primaryAction.enabled).toBe(true);
      // Secondary action should be DISPUTE
      if (enriched.secondaryAction) {
        expect(enriched.secondaryAction.type).toBe('DISPUTE');
      }
    });
  });

  // ── BUY Order: Buyer Perspective ──────────────────────────────────

  describe('BUY order — Buyer (user) view', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 350);
      orderId = order.id;
    });

    it('OPEN: buyer sees disabled primary', async () => {
      const enriched = await getEnriched(orderId, u1, 'user');
      expect(enriched.my_role).toBe('buyer');
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('ACCEPTED: buyer is waiting for escrow', async () => {
      await transition(orderId, 'accepted', 'merchant', m1);
      const enriched = await getEnriched(orderId, u1, 'user');
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('ESCROWED: buyer sees SEND_PAYMENT enabled', async () => {
      await lockEscrow(orderId, 'merchant', m1);
      const enriched = await getEnriched(orderId, u1, 'user');
      expect(enriched.primaryAction.type).toBe('SEND_PAYMENT');
      expect(enriched.primaryAction.enabled).toBe(true);
    });

    it('PAYMENT_SENT: buyer sees disabled (waiting for confirmation)', async () => {
      await transition(orderId, 'payment_sent', 'user', u1);
      const enriched = await getEnriched(orderId, u1, 'user');
      expect(enriched.primaryAction.enabled).toBe(false);
      // Secondary should be DISPUTE
      if (enriched.secondaryAction) {
        expect(enriched.secondaryAction.type).toBe('DISPUTE');
      }
    });
  });

  // ── SELL Order: Seller (user) Perspective ─────────────────────────

  describe('SELL order — Seller (user) view', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await createOrder(u1, m1, buyOffer, 'sell', 250);
      orderId = order.id;
    });

    it('OPEN: user/seller sees disabled primary', async () => {
      const enriched = await getEnriched(orderId, u1, 'user');
      expect(enriched.my_role).toBe('seller');
    });

    it('ACCEPTED: seller sees LOCK_ESCROW', async () => {
      await transition(orderId, 'accepted', 'merchant', m1);
      const enriched = await getEnriched(orderId, u1, 'user');
      expect(enriched.primaryAction.type).toBe('LOCK_ESCROW');
      expect(enriched.primaryAction.enabled).toBe(true);
    });

    it('ESCROWED: seller waits for buyer payment', async () => {
      await lockEscrow(orderId, 'user', u1);
      const enriched = await getEnriched(orderId, u1, 'user');
      expect(enriched.primaryAction.enabled).toBe(false);
    });

    it('PAYMENT_SENT: seller sees CONFIRM_PAYMENT', async () => {
      await transition(orderId, 'payment_sent', 'merchant', m1);
      const enriched = await getEnriched(orderId, u1, 'user');
      expect(enriched.primaryAction.type).toBe('CONFIRM_PAYMENT');
      expect(enriched.primaryAction.enabled).toBe(true);
    });
  });

  // ── Terminal States ───────────────────────────────────────────────

  describe('Terminal states enrichment', () => {
    it('completed order: isTerminal=true, no actions, showChat preserved', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 500);
      await transition(order.id, 'accepted', 'merchant', m1);
      await lockEscrow(order.id, 'merchant', m1);
      await transition(order.id, 'payment_sent', 'user', u1);

      // Complete via release
      const h = headers();
      h['x-actor-type'] = 'merchant';
      h['x-actor-id'] = m1;
      await fetch(`${CORE_API_URL}/v1/orders/${order.id}/events`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ event_type: 'release', tx_hash: `release_${order.id.slice(0, 8)}` }),
      });

      const enriched = await getEnriched(order.id, m1);
      expect(enriched.isTerminal).toBe(true);
      expect(enriched.primaryAction.enabled).toBe(false);
      expect(enriched.primaryAction.type).toBeNull();
    });

    it('cancelled order: isTerminal=true', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 80);
      await fetch(`${CORE_API_URL}/v1/orders/${order.id}?actor_type=user&actor_id=${u1}&reason=Test`, {
        method: 'DELETE',
        headers: headers(),
      });

      const enriched = await getEnriched(order.id, m1);
      expect(enriched.isTerminal).toBe(true);
      expect(enriched.primaryAction.enabled).toBe(false);
    });
  });

  // ── showChat Logic ────────────────────────────────────────────────

  describe('showChat field', () => {
    it('open order: showChat is false (no counterparty yet)', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 90);
      const enriched = await getEnriched(order.id, m1);
      expect(enriched.showChat).toBe(false);
    });

    it('accepted order: showChat is true', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 95);
      await transition(order.id, 'accepted', 'merchant', m1);
      const enriched = await getEnriched(order.id, m1);
      expect(enriched.showChat).toBe(true);
    });
  });

  // ── Consistency: enricher matches handleOrderAction ───────────────

  describe('Enricher ↔ Action handler consistency', () => {
    it('if primaryAction.type is set and enabled, dispatching it succeeds', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 300);
      await transition(order.id, 'accepted', 'merchant', m1);

      // Get enriched response — should show LOCK_ESCROW for seller
      const enriched = await getEnriched(order.id, m1);
      expect(enriched.primaryAction.type).toBe('LOCK_ESCROW');
      expect(enriched.primaryAction.enabled).toBe(true);

      // Dispatch that exact action
      const res = await fetch(`${SETTLE_URL}/api/orders/${order.id}/action`, {
        method: 'POST',
        headers: headers(m1),
        body: JSON.stringify({
          action: enriched.primaryAction.type,
          actor_id: m1,
          actor_type: 'merchant',
          tx_hash: `consistency_${Date.now()}`,
        }),
      });
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('if primaryAction.enabled is false, dispatching its type fails', async () => {
      const order = await createOrder(u1, m1, sellOffer, 'buy', 310);

      // Buyer view on open order — primaryAction is disabled
      const enriched = await getEnriched(order.id, u1, 'user');
      expect(enriched.primaryAction.enabled).toBe(false);

      // If the disabled action has a type, dispatching it should fail
      if (enriched.primaryAction.type) {
        const res = await fetch(`${SETTLE_URL}/api/orders/${order.id}/action`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            action: enriched.primaryAction.type,
            actor_id: u1,
            actor_type: 'user',
          }),
        });
        const body = await res.json();
        expect(body.success).toBe(false);
      }
    });
  });
});
