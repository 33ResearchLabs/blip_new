/**
 * API Integration Tests — POST /api/orders/{id}/action
 *
 * Tests the Settle action endpoint directly via HTTP.
 * Covers all action types, role validation, status transitions,
 * and response contract compliance.
 *
 * Requires: settle server running on SETTLE_URL (default localhost:3000)
 *           core-api running on CORE_API_URL (default localhost:4010)
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
  // Reset
  const resetRes = await fetch(`${SETTLE_URL}/api/test/reset`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ confirm: true }),
  });
  if (!resetRes.ok) throw new Error(`Reset failed: ${resetRes.status}`);

  // Seed
  const seedRes = await fetch(`${SETTLE_URL}/api/test/seed`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ scenario: 'full' }),
  });
  if (!seedRes.ok) throw new Error(`Seed failed: ${seedRes.status}`);
  const data = await seedRes.json();
  return data.data;
}

async function createOrder(params: {
  userId: string;
  merchantId: string;
  offerId: string;
  type: 'buy' | 'sell';
  amount: number;
}) {
  const res = await fetch(`${CORE_API_URL}/v1/orders`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: params.userId,
      merchant_id: params.merchantId,
      offer_id: params.offerId,
      type: params.type,
      payment_method: 'bank',
      crypto_amount: params.amount,
      fiat_amount: params.amount * 3.67,
      rate: 3.67,
      payment_details: { bank_name: 'Test Bank', iban: 'AE123456789012345678901' },
    }),
  });
  if (!res.ok) throw new Error(`createOrder failed: ${res.status}`);
  return (await res.json()).data;
}

async function transitionOrder(orderId: string, status: string, actorType: string, actorId: string) {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status, actor_type: actorType, actor_id: actorId }),
  });
  if (!res.ok) throw new Error(`transitionOrder failed: ${res.status}`);
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
  const body = await res.json().catch(() => ({ success: false }));
  return { status: res.status, body };
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

// ── Test Suite ──────────────────────────────────────────────────────────

describe('POST /api/orders/{id}/action', () => {
  let fixtures: any;
  let u1: string;
  let m1: string;
  let m2: string;
  let sellOffer: string;
  let buyOffer: string;

  beforeAll(async () => {
    fixtures = await resetAndSeed();
    u1 = fixtures.users[0].id;
    m1 = fixtures.merchants[0].id;
    m2 = fixtures.merchants[1].id;
    sellOffer = fixtures.offers[0].id;
    buyOffer = fixtures.offers[1].id;
  }, 30000);

  // ══════════════════════════════════════════════════════════════════════
  // User BUY — Full Happy Path via Action Endpoint
  // ══════════════════════════════════════════════════════════════════════

  describe('User BUY: full happy path', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 500,
      });
      orderId = order.id;
    });

    it('ACCEPT: observer accepts open order', async () => {
      // Use m2 as the observer/acceptor
      await transitionOrder(orderId, 'accepted', 'merchant', m1);

      const enriched = await getSettleOrder(orderId, m1, 'merchant');
      expect(enriched.status).toMatch(/accepted/);
      expect(enriched.my_role).toBe('seller');
    });

    it('LOCK_ESCROW: seller locks escrow', async () => {
      const result = await dispatchAction(orderId, {
        action: 'LOCK_ESCROW',
        actor_id: m1,
        actor_type: 'merchant',
        tx_hash: `test_escrow_${Date.now()}`,
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('escrowed');
      expect(result.body.previousStatus).toBe('accepted');
      expect(result.body.my_role).toBe('seller');
    });

    it('SEND_PAYMENT: buyer sends fiat', async () => {
      const result = await dispatchAction(orderId, {
        action: 'SEND_PAYMENT',
        actor_id: u1,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('payment_sent');
      expect(result.body.my_role).toBe('buyer');
    });

    it('CONFIRM_PAYMENT: seller confirms and releases', async () => {
      const result = await dispatchAction(orderId, {
        action: 'CONFIRM_PAYMENT',
        actor_id: m1,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('completed');
      expect(result.body.isTerminal).toBe(true);
    });

    it('response contains all enriched UI fields', async () => {
      const enriched = await getSettleOrder(orderId, m1, 'merchant');

      // Contract compliance
      expect(enriched).toHaveProperty('status');
      expect(enriched).toHaveProperty('statusLabel');
      expect(enriched).toHaveProperty('my_role');
      expect(enriched).toHaveProperty('primaryAction');
      expect(enriched).toHaveProperty('secondaryAction');
      expect(enriched).toHaveProperty('nextStepText');
      expect(enriched).toHaveProperty('isTerminal');
      expect(enriched).toHaveProperty('showChat');

      // Terminal state assertions
      expect(enriched.isTerminal).toBe(true);
      expect(enriched.primaryAction.enabled).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // User SELL — Full Happy Path
  // ══════════════════════════════════════════════════════════════════════

  describe('User SELL: full happy path', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: buyOffer,
        type: 'sell',
        amount: 300,
      });
      orderId = order.id;
    });

    it('roles are correct for SELL order', async () => {
      const userView = await getSettleOrder(orderId, u1, 'user');
      expect(userView.my_role).toBe('seller');

      const merchantView = await getSettleOrder(orderId, m1, 'merchant');
      expect(merchantView.my_role).toBe('buyer');
    });

    it('accepts → escrows → payment → completed', async () => {
      // Accept
      await transitionOrder(orderId, 'accepted', 'merchant', m1);

      // Seller (user) locks escrow
      const escrowResult = await dispatchAction(orderId, {
        action: 'LOCK_ESCROW',
        actor_id: u1,
        actor_type: 'user',
        tx_hash: `test_sell_escrow_${Date.now()}`,
      });
      expect(escrowResult.body.success).toBe(true);
      expect(escrowResult.body.newStatus).toBe('escrowed');

      // Buyer (merchant) sends payment
      const payResult = await dispatchAction(orderId, {
        action: 'SEND_PAYMENT',
        actor_id: m1,
        actor_type: 'merchant',
      });
      expect(payResult.body.success).toBe(true);
      expect(payResult.body.newStatus).toBe('payment_sent');

      // Seller (user) confirms
      const confirmResult = await dispatchAction(orderId, {
        action: 'CONFIRM_PAYMENT',
        actor_id: u1,
        actor_type: 'user',
      });
      expect(confirmResult.body.success).toBe(true);
      expect(confirmResult.body.newStatus).toBe('completed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // M2M BUY
  // ══════════════════════════════════════════════════════════════════════

  describe('M2M BUY: merchant-to-merchant', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 1000,
      });
      orderId = order.id;
      await transitionOrder(orderId, 'accepted', 'merchant', m2);
    });

    it('both merchants have defined roles after acceptance', async () => {
      const m1View = await getSettleOrder(orderId, m1, 'merchant');
      const m2View = await getSettleOrder(orderId, m2, 'merchant');

      expect(m1View.my_role).toBeDefined();
      expect(m2View.my_role).toBeDefined();
      expect(m1View.primaryAction).toBeDefined();
      expect(m2View.primaryAction).toBeDefined();
    });

    it('transitions through full M2M lifecycle', async () => {
      // Lock escrow
      await lockEscrowViaCore(orderId, 'merchant', m1);
      const afterEscrow = await getSettleOrder(orderId, m1, 'merchant');
      expect(afterEscrow.status).toMatch(/escrowed/);

      // Send payment
      await transitionOrder(orderId, 'payment_sent', 'user', u1);
      const afterPayment = await getSettleOrder(orderId, m1, 'merchant');
      expect(afterPayment.status).toMatch(/payment_sent/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // M2M SELL
  // ══════════════════════════════════════════════════════════════════════

  describe('M2M SELL: merchant-to-merchant', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: buyOffer,
        type: 'sell',
        amount: 750,
      });
      orderId = order.id;
      await transitionOrder(orderId, 'accepted', 'merchant', m2);
    });

    it('M2M sell roles resolve correctly', async () => {
      const m1View = await getSettleOrder(orderId, m1, 'merchant');
      const m2View = await getSettleOrder(orderId, m2, 'merchant');

      expect(m1View.my_role).toBeDefined();
      expect(m2View.my_role).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Cancel Flow
  // ══════════════════════════════════════════════════════════════════════

  describe('CANCEL action', () => {
    it('cancels open order', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 100,
      });

      const result = await dispatchAction(order.id, {
        action: 'CANCEL',
        actor_id: u1,
        actor_type: 'user',
        reason: 'Test cancel from open',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('cancelled');
      expect(result.body.isTerminal).toBe(true);
    });

    it('cancels accepted order', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 110,
      });
      await transitionOrder(order.id, 'accepted', 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'CANCEL',
        actor_id: m1,
        actor_type: 'merchant',
        reason: 'Test cancel from accepted',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('cancelled');
    });

    it('cancels escrowed order with refund', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 120,
      });
      await transitionOrder(order.id, 'accepted', 'merchant', m1);
      await lockEscrowViaCore(order.id, 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'CANCEL',
        actor_id: u1,
        actor_type: 'user',
        reason: 'Test cancel from escrowed',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('cancelled');
    });

    it('rejects cancel from payment_sent', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 130,
      });
      await transitionOrder(order.id, 'accepted', 'merchant', m1);
      await lockEscrowViaCore(order.id, 'merchant', m1);
      await transitionOrder(order.id, 'payment_sent', 'user', u1);

      const result = await dispatchAction(order.id, {
        action: 'CANCEL',
        actor_id: u1,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Dispute Flow
  // ══════════════════════════════════════════════════════════════════════

  describe('DISPUTE action', () => {
    it('disputes from escrowed', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 200,
      });
      await transitionOrder(order.id, 'accepted', 'merchant', m1);
      await lockEscrowViaCore(order.id, 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'DISPUTE',
        actor_id: u1,
        actor_type: 'user',
        reason: 'Test dispute from escrowed',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('disputed');
    });

    it('disputes from payment_sent', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 210,
      });
      await transitionOrder(order.id, 'accepted', 'merchant', m1);
      await lockEscrowViaCore(order.id, 'merchant', m1);
      await transitionOrder(order.id, 'payment_sent', 'user', u1);

      const result = await dispatchAction(order.id, {
        action: 'DISPUTE',
        actor_id: m1,
        actor_type: 'merchant',
        reason: 'Fiat not received',
      });

      expect(result.body.success).toBe(true);
      expect(result.body.newStatus).toBe('disputed');
    });

    it('rejects dispute from open', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 220,
      });

      const result = await dispatchAction(order.id, {
        action: 'DISPUTE',
        actor_id: u1,
        actor_type: 'user',
        reason: 'Too early',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Response Contract Validation
  // ══════════════════════════════════════════════════════════════════════

  describe('Response contract', () => {
    it('successful action returns all required fields', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 50,
      });

      const result = await dispatchAction(order.id, {
        action: 'CANCEL',
        actor_id: u1,
        actor_type: 'user',
        reason: 'Contract test',
      });

      expect(result.status).toBe(200);
      expect(result.body).toHaveProperty('success', true);
      expect(result.body).toHaveProperty('action', 'CANCEL');
      expect(result.body).toHaveProperty('previousStatus');
      expect(result.body).toHaveProperty('newStatus');
      expect(result.body).toHaveProperty('my_role');
      expect(result.body).toHaveProperty('primaryAction');
      expect(result.body).toHaveProperty('nextStepText');
      expect(result.body).toHaveProperty('isTerminal');
    });

    it('failed action returns error and code', async () => {
      const result = await dispatchAction('00000000-0000-0000-0000-000000000000', {
        action: 'ACCEPT',
        actor_id: m1,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body).toHaveProperty('error');
      expect(typeof result.body.error).toBe('string');
    });

    it('GET /api/orders/{id} returns full BackendOrder contract', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 75,
      });

      const enriched = await getSettleOrder(order.id, m1, 'merchant');

      // Required BackendOrder fields
      expect(enriched).toHaveProperty('id');
      expect(enriched).toHaveProperty('status');
      expect(enriched).toHaveProperty('statusLabel');
      expect(enriched).toHaveProperty('my_role');
      expect(enriched).toHaveProperty('primaryAction');
      expect(enriched).toHaveProperty('nextStepText');
      expect(enriched).toHaveProperty('isTerminal');
      expect(enriched).toHaveProperty('type');
      expect(enriched).toHaveProperty('crypto_amount');
      expect(enriched).toHaveProperty('fiat_amount');
      expect(enriched).toHaveProperty('rate');

      // primaryAction structure
      expect(enriched.primaryAction).toHaveProperty('type');
      expect(enriched.primaryAction).toHaveProperty('enabled');
      expect(typeof enriched.primaryAction.enabled).toBe('boolean');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Escrow Invariants
  // ══════════════════════════════════════════════════════════════════════

  describe('Escrow invariants', () => {
    it('SEND_PAYMENT requires escrow to be locked', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 150,
      });
      await transitionOrder(order.id, 'accepted', 'merchant', m1);

      // Try to send payment without locking escrow
      // (order is 'accepted', not 'escrowed')
      const result = await dispatchAction(order.id, {
        action: 'SEND_PAYMENT',
        actor_id: u1,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    it('CONFIRM_PAYMENT requires escrow to be locked', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 160,
      });
      await transitionOrder(order.id, 'accepted', 'merchant', m1);

      const result = await dispatchAction(order.id, {
        action: 'CONFIRM_PAYMENT',
        actor_id: m1,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Idempotency
  // ══════════════════════════════════════════════════════════════════════

  describe('Idempotency for financial actions', () => {
    it('duplicate LOCK_ESCROW returns consistent result', async () => {
      const order = await createOrder({
        userId: u1,
        merchantId: m1,
        offerId: sellOffer,
        type: 'buy',
        amount: 180,
      });
      await transitionOrder(order.id, 'accepted', 'merchant', m1);

      const result1 = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1,
        actor_type: 'merchant',
        tx_hash: `idempotent_test_${Date.now()}`,
      });
      expect(result1.body.success).toBe(true);

      // Second attempt should fail gracefully
      const result2 = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1,
        actor_type: 'merchant',
        tx_hash: `idempotent_test_2_${Date.now()}`,
      });
      expect(result2.body.success).toBe(false);
      expect(result2.body.code).toMatch(/ALREADY_ESCROWED|INVALID_STATUS_FOR_ACTION/);
    });
  });
});
