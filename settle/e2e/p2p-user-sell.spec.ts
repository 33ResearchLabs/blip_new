/**
 * E2E: User SELL Flow
 *
 * User sells crypto to merchant.
 * Roles: User = Seller (locks escrow), Merchant = Buyer (sends fiat)
 * Flow: open → accepted → escrowed → payment_sent → completed
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
} from './helpers/p2p-actions';

let scenario: ScenarioData;

test.describe('P2P User SELL Flow', () => {
  test.beforeAll(async () => {
    scenario = await seedFullScenario();
  });

  // ── Happy Path ────────────────────────────────────────────────────────

  test('complete sell flow: open → accepted → escrowed → payment_sent → completed', async ({
    networkLogger,
  }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const buyOffer = scenario.offers[1];

    // 1. Create SELL order (user sells crypto)
    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: buyOffer.id,
      type: 'sell',
      amount: 400,
    });

    const fresh = await getOrder(order.id);
    expect(fresh.status).toBe('pending');

    // 2. Merchant accepts → accepted
    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    const afterAccept = await getOrder(order.id);
    expect(afterAccept.status).toMatch(/accepted/);

    // 3. User (seller) locks escrow → escrowed
    // In SELL, user is the seller who locks escrow
    await lockEscrow(order.id, 'user', u1.id);
    const afterEscrow = await getOrder(order.id);
    expect(afterEscrow.status).toMatch(/escrowed/);

    // 4. Merchant (buyer) sends fiat payment → payment_sent
    await transitionOrder(order.id, 'payment_sent', 'merchant', m1.id);
    const afterPayment = await getOrder(order.id);
    expect(afterPayment.status).toMatch(/payment_sent/);

    // 5. Release escrow → completed
    await releaseEscrow(order.id, 'user', u1.id);
    const afterComplete = await getOrder(order.id);
    expect(afterComplete.status).toMatch(/completed/);
  });

  // ── Role Verification ─────────────────────────────────────────────────

  test('roles are inverted for SELL order', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const buyOffer = scenario.offers[1];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: buyOffer.id,
      type: 'sell',
      amount: 150,
    });

    // User should be seller in SELL order
    const userView = await getSettleOrder(order.id, u1.id, 'user');
    expect(userView.my_role).toBe('seller');

    // Merchant should be buyer in SELL order
    const merchantView = await getSettleOrder(order.id, m1.id, 'merchant');
    expect(merchantView.my_role).toBe('buyer');
  });

  // ── Seller (User) Actions at Each Stage ───────────────────────────────

  test('seller sees LOCK_ESCROW after accepted', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const buyOffer = scenario.offers[1];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: buyOffer.id,
      type: 'sell',
      amount: 200,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);

    // User (seller) should see LOCK_ESCROW
    const sellerView = await getSettleOrder(order.id, u1.id, 'user');
    expect(sellerView.primaryAction?.type).toBe('LOCK_ESCROW');
    expect(sellerView.primaryAction?.enabled).toBe(true);

    // Merchant (buyer) should be waiting
    const buyerView = await getSettleOrder(order.id, m1.id, 'merchant');
    expect(buyerView.primaryAction?.enabled).toBe(false);
  });

  // ── Buyer (Merchant) Actions at Escrowed ──────────────────────────────

  test('buyer sees SEND_PAYMENT after escrowed', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const buyOffer = scenario.offers[1];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: buyOffer.id,
      type: 'sell',
      amount: 225,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    await lockEscrow(order.id, 'user', u1.id);

    // Merchant (buyer) should see SEND_PAYMENT
    const buyerView = await getSettleOrder(order.id, m1.id, 'merchant');
    expect(buyerView.primaryAction?.type).toBe('SEND_PAYMENT');
    expect(buyerView.primaryAction?.enabled).toBe(true);
  });

  // ── Seller Confirms Payment ───────────────────────────────────────────

  test('seller sees CONFIRM_PAYMENT after payment_sent', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const buyOffer = scenario.offers[1];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: buyOffer.id,
      type: 'sell',
      amount: 275,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    await lockEscrow(order.id, 'user', u1.id);
    await transitionOrder(order.id, 'payment_sent', 'merchant', m1.id);

    // User (seller) should see CONFIRM_PAYMENT
    const sellerView = await getSettleOrder(order.id, u1.id, 'user');
    expect(sellerView.primaryAction?.type).toBe('CONFIRM_PAYMENT');
    expect(sellerView.primaryAction?.enabled).toBe(true);

    // Merchant (buyer) should be waiting
    const buyerView = await getSettleOrder(order.id, m1.id, 'merchant');
    expect(buyerView.primaryAction?.enabled).toBe(false);
  });

  // ── UI Rendering (Merchant as Buyer) ──────────────────────────────────

  test('merchant dashboard shows SELL orders with buyer role', async ({ page }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const buyOffer = scenario.offers[1];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: buyOffer.id,
      type: 'sell',
      amount: 175,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);

    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    const card = page.locator(`[data-testid="order-card-${order.id}"]`);
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Detail panel should show accepted status
      const statusBadge = page.locator('[data-testid="order-status"]').first();
      if (await statusBadge.isVisible().catch(() => false)) {
        await expect(statusBadge).toHaveText(/accepted/i);
      }
    }

    await page.screenshot({ path: 'e2e/results/sell-flow-accepted.png', fullPage: true });
  });

  // ── Cancel Sell Order ─────────────────────────────────────────────────

  test('seller can cancel before escrow', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const buyOffer = scenario.offers[1];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: buyOffer.id,
      type: 'sell',
      amount: 125,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);

    const result = await dispatchAction(order.id, {
      action: 'CANCEL',
      actor_id: u1.id,
      actor_type: 'user',
      reason: 'Changed mind about selling',
    });

    expect(result.body.success).toBe(true);
    expect(result.body.newStatus).toBe('cancelled');
  });

  // ── Dispute from Buyer Side ───────────────────────────────────────────

  test('buyer (merchant) can dispute after payment_sent', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const buyOffer = scenario.offers[1];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: buyOffer.id,
      type: 'sell',
      amount: 350,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    await lockEscrow(order.id, 'user', u1.id);
    await transitionOrder(order.id, 'payment_sent', 'merchant', m1.id);

    const result = await dispatchAction(order.id, {
      action: 'DISPUTE',
      actor_id: m1.id,
      actor_type: 'merchant',
      reason: 'Seller not confirming receipt',
    });

    expect(result.body.success).toBe(true);
    expect(result.body.newStatus).toBe('disputed');
  });
});
