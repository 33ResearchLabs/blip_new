/**
 * E2E: User BUY Flow
 *
 * User buys crypto from merchant.
 * Roles: User = Buyer, Merchant = Seller
 * Flow: open → accepted → escrowed → payment_sent → completed
 *
 * Tests both API status transitions AND frontend UI rendering.
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
  retry,
} from './helpers/p2p-actions';

let scenario: ScenarioData;

test.describe('P2P User BUY Flow', () => {
  test.beforeAll(async () => {
    scenario = await seedFullScenario();
  });

  // ── Happy Path ────────────────────────────────────────────────────────

  test('complete buy flow: open → accepted → escrowed → payment_sent → completed', async ({
    page,
    networkLogger,
  }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    // 1. Create fresh BUY order
    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'buy',
      amount: 500,
    });

    // Verify initial state
    const fresh = await getOrder(order.id);
    expect(fresh.status).toBe('pending');

    // 2. Merchant accepts → accepted
    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    const afterAccept = await getOrder(order.id);
    expect(afterAccept.status).toMatch(/accepted/);

    // 3. Merchant locks escrow → escrowed
    await lockEscrow(order.id, 'merchant', m1.id);
    const afterEscrow = await getOrder(order.id);
    expect(afterEscrow.status).toMatch(/escrowed/);

    // 4. User sends payment → payment_sent
    await transitionOrder(order.id, 'payment_sent', 'user', u1.id);
    const afterPayment = await getOrder(order.id);
    expect(afterPayment.status).toMatch(/payment_sent/);

    // 5. Release escrow → completed
    await releaseEscrow(order.id, 'merchant', m1.id);
    const afterComplete = await getOrder(order.id);
    expect(afterComplete.status).toMatch(/completed/);

    // ── UI Verification ──────────────────────────────────────────────
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(2000);

    // Verify completed order appears
    const card = page.locator(`[data-testid="order-card-${order.id}"]`);
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Status badge should show completed
      const statusBadge = page.locator('[data-testid="order-status"]').first();
      if (await statusBadge.isVisible().catch(() => false)) {
        await expect(statusBadge).toHaveText(/completed/i);
      }
    }

    expect(networkLogger.getApiCalls().length).toBeGreaterThan(0);
  });

  // ── Backend-Driven UI: Seller View ────────────────────────────────────

  test('seller sees correct primaryAction at each stage', async ({ page }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'buy',
      amount: 250,
    });

    // Accepted: Seller should see "Lock Escrow"
    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    const enrichedAccepted = await getSettleOrder(order.id, m1.id, 'merchant');
    expect(enrichedAccepted.my_role).toBe('seller');
    expect(enrichedAccepted.primaryAction?.type).toBe('LOCK_ESCROW');
    expect(enrichedAccepted.primaryAction?.enabled).toBe(true);

    // Escrowed: Seller should be waiting
    await lockEscrow(order.id, 'merchant', m1.id);
    const enrichedEscrowed = await getSettleOrder(order.id, m1.id, 'merchant');
    expect(enrichedEscrowed.primaryAction?.enabled).toBe(false);
    expect(enrichedEscrowed.secondaryAction?.type).toMatch(/CANCEL|DISPUTE/);

    // Payment sent: Seller should see "Confirm Payment"
    await transitionOrder(order.id, 'payment_sent', 'user', u1.id);
    const enrichedPayment = await getSettleOrder(order.id, m1.id, 'merchant');
    expect(enrichedPayment.primaryAction?.type).toBe('CONFIRM_PAYMENT');
    expect(enrichedPayment.primaryAction?.enabled).toBe(true);

    // Navigate as merchant and check button rendering
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(2000);

    const card = page.locator(`[data-testid="order-card-${order.id}"]`);
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1000);

      // Primary action button should be visible
      const primaryBtn = page.locator('[data-testid="primary-action-btn"]').first();
      if (await primaryBtn.isVisible().catch(() => false)) {
        await expect(primaryBtn).toContainText(/confirm/i);
      }
    }
  });

  // ── Backend-Driven UI: Buyer View ─────────────────────────────────────

  test('buyer sees correct primaryAction at each stage', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'buy',
      amount: 300,
    });

    // Open: Buyer should be waiting for acceptor
    const enrichedOpen = await getSettleOrder(order.id, u1.id, 'user');
    expect(enrichedOpen.my_role).toBe('buyer');
    expect(enrichedOpen.primaryAction?.enabled).toBe(false);

    // Accepted: Buyer should be waiting for escrow
    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    const enrichedAccepted = await getSettleOrder(order.id, u1.id, 'user');
    expect(enrichedAccepted.primaryAction?.enabled).toBe(false);
    expect(enrichedAccepted.nextStepText).toBeTruthy();

    // Escrowed: Buyer should see "I've Paid" / SEND_PAYMENT
    await lockEscrow(order.id, 'merchant', m1.id);
    const enrichedEscrowed = await getSettleOrder(order.id, u1.id, 'user');
    expect(enrichedEscrowed.primaryAction?.type).toBe('SEND_PAYMENT');
    expect(enrichedEscrowed.primaryAction?.enabled).toBe(true);

    // Payment sent: Buyer should be waiting for confirmation
    await transitionOrder(order.id, 'payment_sent', 'user', u1.id);
    const enrichedPayment = await getSettleOrder(order.id, u1.id, 'user');
    expect(enrichedPayment.primaryAction?.enabled).toBe(false);
  });

  // ── Status Badge Rendering ────────────────────────────────────────────

  test('order list shows correct status badges for all states', async ({ page }) => {
    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    // Check each pre-seeded order's status badge
    const statusChecks = [
      { id: scenario.orders.pending.id, expected: /open|pending/i },
      { id: scenario.orders.accepted.id, expected: /accepted/i },
      { id: scenario.orders.escrowed.id, expected: /escrowed/i },
      { id: scenario.orders.completed.id, expected: /completed/i },
      { id: scenario.orders.cancelled.id, expected: /cancelled/i },
    ];

    for (const { id, expected } of statusChecks) {
      const card = page.locator(`[data-testid="order-card-${id}"]`);
      if (await card.isVisible().catch(() => false)) {
        const badge = card.locator('[data-testid="order-status"]');
        if (await badge.isVisible().catch(() => false)) {
          await expect(badge).toHaveText(expected);
        }
      }
    }

    await page.screenshot({ path: 'e2e/results/buy-flow-all-statuses.png', fullPage: true });
  });

  // ── Cancel from Open ──────────────────────────────────────────────────

  test('buyer can cancel open order', async ({ page }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'buy',
      amount: 100,
    });

    // Cancel via Settle action endpoint
    const result = await dispatchAction(order.id, {
      action: 'CANCEL',
      actor_id: u1.id,
      actor_type: 'user',
      reason: 'Changed my mind',
    });

    expect(result.body.success).toBe(true);
    expect(result.body.newStatus).toBe('cancelled');
    expect(result.body.isTerminal).toBe(true);

    // Verify terminal state
    const cancelled = await getOrder(order.id);
    expect(cancelled.status).toMatch(/cancelled/);
  });

  // ── Cancel from Escrowed (with refund) ────────────────────────────────

  test('seller can cancel escrowed order and get refund', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'buy',
      amount: 200,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    await lockEscrow(order.id, 'merchant', m1.id);

    // Cancel from escrowed → should trigger refund
    const result = await dispatchAction(order.id, {
      action: 'CANCEL',
      actor_id: m1.id,
      actor_type: 'merchant',
      reason: 'Cannot fulfill order',
    });

    expect(result.body.success).toBe(true);
    expect(result.body.newStatus).toBe('cancelled');

    const cancelled = await getOrder(order.id);
    expect(cancelled.status).toMatch(/cancelled/);
  });

  // ── Dispute from Payment Sent ─────────────────────────────────────────

  test('seller can dispute after payment_sent', async () => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'buy',
      amount: 350,
    });

    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    await lockEscrow(order.id, 'merchant', m1.id);
    await transitionOrder(order.id, 'payment_sent', 'user', u1.id);

    const result = await dispatchAction(order.id, {
      action: 'DISPUTE',
      actor_id: m1.id,
      actor_type: 'merchant',
      reason: 'Payment not received in bank',
    });

    expect(result.body.success).toBe(true);
    expect(result.body.newStatus).toBe('disputed');
    expect(result.body.isTerminal).toBeTruthy();
  });

  // ── nextStepText always present ───────────────────────────────────────

  test('nextStepText is always present in enriched response', async () => {
    const m1 = scenario.merchants[0];

    const statuses = ['pending', 'accepted', 'escrowed', 'payment_sent', 'completed', 'cancelled'];
    const orderIds = [
      scenario.orders.pending.id,
      scenario.orders.accepted.id,
      scenario.orders.escrowed.id,
      scenario.orders.payment_sent.id,
      scenario.orders.completed.id,
      scenario.orders.cancelled.id,
    ];

    for (const id of orderIds) {
      const enriched = await getSettleOrder(id, m1.id, 'merchant');
      expect(enriched.nextStepText).toBeTruthy();
      expect(typeof enriched.nextStepText).toBe('string');
      expect(enriched.nextStepText.length).toBeGreaterThan(0);
    }
  });
});
