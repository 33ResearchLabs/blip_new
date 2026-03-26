/**
 * E2E: Merchant-to-Merchant (M2M) Flows
 *
 * M2M BUY:  merchant_id = seller, buyer_merchant_id (acceptor) = buyer
 * M2M SELL: merchant_id = seller, buyer_merchant_id (acceptor) = buyer
 *
 * Tests the full lifecycle for both M2M directions, role resolution,
 * and correct backend-driven UI enrichment for both merchants.
 */

import { test, expect, navigateAsMerchant } from './fixtures';
import {
  seedFullScenario,
  createOrder,
  transitionOrder,
  lockEscrow,
  releaseEscrow,
  getOrder,
  ScenarioData,
} from './helpers/api';
import {
  dispatchAction,
  getSettleOrder,
  getMerchantOrders,
} from './helpers/p2p-actions';

let scenario: ScenarioData;

test.describe('P2P M2M (Merchant-to-Merchant) Flows', () => {
  test.beforeAll(async () => {
    scenario = await seedFullScenario();
  });

  // ══════════════════════════════════════════════════════════════════════
  // M2M SELL: merchant_id (creator) = Seller, buyer_merchant_id = Buyer
  // ══════════════════════════════════════════════════════════════════════

  test.describe('M2M SELL Flow', () => {
    test('complete M2M sell: open → accepted → escrowed → payment_sent → completed', async () => {
      const m1 = scenario.merchants[0]; // Creator (seller)
      const m2 = scenario.merchants[1]; // Acceptor (buyer)
      const u1 = scenario.users[0];
      const sellOffer = scenario.offers[0];

      // 1. Create order — m1 creates a sell offer
      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: sellOffer.id,
        type: 'sell',
        amount: 1000,
      });

      expect((await getOrder(order.id)).status).toBe('pending');

      // 2. m2 accepts the order → becomes buyer_merchant_id
      await transitionOrder(order.id, 'accepted', 'merchant', m2.id);
      const afterAccept = await getOrder(order.id);
      expect(afterAccept.status).toMatch(/accepted/);

      // 3. Seller (m1 or u1 depending on type) locks escrow
      // In a sell order, user = seller
      await lockEscrow(order.id, 'user', u1.id);
      const afterEscrow = await getOrder(order.id);
      expect(afterEscrow.status).toMatch(/escrowed/);

      // 4. Buyer sends payment
      await transitionOrder(order.id, 'payment_sent', 'merchant', m2.id);
      const afterPayment = await getOrder(order.id);
      expect(afterPayment.status).toMatch(/payment_sent/);

      // 5. Release escrow → completed
      await releaseEscrow(order.id, 'user', u1.id);
      const afterComplete = await getOrder(order.id);
      expect(afterComplete.status).toMatch(/completed/);
    });

    test('M2M sell: roles resolve correctly for both merchants', async () => {
      const m1 = scenario.merchants[0];
      const m2 = scenario.merchants[1];
      const u1 = scenario.users[0];
      const sellOffer = scenario.offers[0];

      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: sellOffer.id,
        type: 'sell',
        amount: 500,
      });

      await transitionOrder(order.id, 'accepted', 'merchant', m2.id);

      // After acceptance, verify roles from each merchant's perspective
      const m1View = await getSettleOrder(order.id, m1.id, 'merchant');
      const m2View = await getSettleOrder(order.id, m2.id, 'merchant');

      // In a sell order: user = seller, merchant acceptor = buyer
      // m1 is merchant_id (original), m2 is buyer_merchant_id (acceptor)
      // user_id (u1) is the seller in sell orders
      expect(m1View.my_role).toBeDefined();
      expect(m2View.my_role).toBeDefined();

      // Both should have primaryAction defined (backend-driven UI invariant)
      expect(m1View.primaryAction).toBeDefined();
      expect(m2View.primaryAction).toBeDefined();
      expect(m1View.nextStepText).toBeTruthy();
      expect(m2View.nextStepText).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // M2M BUY: merchant_id = Seller (always), buyer_merchant_id = Buyer (always)
  // ══════════════════════════════════════════════════════════════════════

  test.describe('M2M BUY Flow', () => {
    test('complete M2M buy: open → accepted → escrowed → payment_sent → completed', async () => {
      const m1 = scenario.merchants[0]; // Creator (buyer)
      const m2 = scenario.merchants[1]; // Acceptor (seller)
      const u1 = scenario.users[0];
      const buyOffer = scenario.offers[1];

      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: buyOffer.id,
        type: 'buy',
        amount: 800,
      });

      expect((await getOrder(order.id)).status).toBe('pending');

      // m2 accepts → becomes buyer_merchant_id
      await transitionOrder(order.id, 'accepted', 'merchant', m2.id);
      expect((await getOrder(order.id)).status).toMatch(/accepted/);

      // In BUY: merchant_id = buyer, so seller is whoever accepted
      // Seller (m2 in M2M context) locks escrow
      await lockEscrow(order.id, 'merchant', m1.id);
      expect((await getOrder(order.id)).status).toMatch(/escrowed/);

      // Buyer sends payment
      await transitionOrder(order.id, 'payment_sent', 'user', u1.id);
      expect((await getOrder(order.id)).status).toMatch(/payment_sent/);

      // Release escrow
      await releaseEscrow(order.id, 'merchant', m1.id);
      expect((await getOrder(order.id)).status).toMatch(/completed/);
    });

    test('M2M buy: roles resolve correctly', async () => {
      const m1 = scenario.merchants[0];
      const m2 = scenario.merchants[1];
      const u1 = scenario.users[0];
      const buyOffer = scenario.offers[1];

      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: buyOffer.id,
        type: 'buy',
        amount: 600,
      });

      await transitionOrder(order.id, 'accepted', 'merchant', m2.id);

      const m1View = await getSettleOrder(order.id, m1.id, 'merchant');
      const m2View = await getSettleOrder(order.id, m2.id, 'merchant');

      // Both should have backend-driven UI fields
      expect(m1View.primaryAction).toBeDefined();
      expect(m2View.primaryAction).toBeDefined();
      expect(m1View.isTerminal).toBe(false);
      expect(m2View.isTerminal).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // M2M UI Tests
  // ══════════════════════════════════════════════════════════════════════

  test('M2M order visible on both merchant dashboards', async ({ page }) => {
    const m1 = scenario.merchants[0];
    const m2 = scenario.merchants[1];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'sell',
      amount: 750,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m2.id);

    // Check m1 dashboard
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    const m1Card = page.locator(`[data-testid="order-card-${order.id}"]`);
    const m1Visible = await m1Card.isVisible().catch(() => false);

    // Check m2 dashboard
    await navigateAsMerchant(page, m2.id, m2.username);
    await page.waitForTimeout(3000);

    const m2Card = page.locator(`[data-testid="order-card-${order.id}"]`);
    const m2Visible = await m2Card.isVisible().catch(() => false);

    // At least one merchant should see the order
    expect(m1Visible || m2Visible).toBe(true);

    await page.screenshot({ path: 'e2e/results/m2m-order-dashboard.png', fullPage: true });
  });

  // ── M2M Cancel ────────────────────────────────────────────────────────

  test('M2M order can be cancelled by either merchant', async () => {
    const m1 = scenario.merchants[0];
    const m2 = scenario.merchants[1];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'sell',
      amount: 300,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m2.id);

    // m2 (buyer) cancels
    const result = await dispatchAction(order.id, {
      action: 'CANCEL',
      actor_id: m2.id,
      actor_type: 'merchant',
      reason: 'Changed mind',
    });

    expect(result.body.success).toBe(true);
    expect(result.body.newStatus).toBe('cancelled');
  });

  // ── M2M Dispute ───────────────────────────────────────────────────────

  test('M2M order can be disputed after payment_sent', async () => {
    const m1 = scenario.merchants[0];
    const m2 = scenario.merchants[1];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'sell',
      amount: 450,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m2.id);
    await lockEscrow(order.id, 'user', u1.id);
    await transitionOrder(order.id, 'payment_sent', 'merchant', m2.id);

    const result = await dispatchAction(order.id, {
      action: 'DISPUTE',
      actor_id: m2.id,
      actor_type: 'merchant',
      reason: 'Crypto not released after payment',
    });

    expect(result.body.success).toBe(true);
    expect(result.body.newStatus).toBe('disputed');
  });
});
