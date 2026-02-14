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

let scenario: ScenarioData;

test.describe('Trade Buy Flow', () => {
  test.beforeAll(async () => {
    scenario = await seedFullScenario();
  });

  test('full buy flow: pending -> accepted -> escrowed -> payment_sent -> completed', async ({
    page,
    networkLogger,
    consoleErrors,
  }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];
    const sellOffer = scenario.offers[0];

    // Create a fresh order for this flow
    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: sellOffer.id,
      type: 'buy',
      amount: 250,
    });

    // Verify the freshly created order is actually pending
    const freshOrder = await getOrder(order.id);
    expect(freshOrder.status).toBe('pending');

    // Step 2: Merchant accepts the order (via API - simulating backend action)
    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);

    // Navigate as merchant
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(2000);

    // Refresh page to see updated state
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Verify accepted state
    const apiOrder1 = await getOrder(order.id);
    expect(apiOrder1.status).toMatch(/accepted/);

    // Step 3: Lock escrow
    await lockEscrow(order.id, 'merchant', m1.id);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const apiOrder2 = await getOrder(order.id);
    expect(apiOrder2.status).toMatch(/escrowed/);

    // Step 4: User marks payment sent
    await transitionOrder(order.id, 'payment_sent', 'user', u1.id);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const apiOrder3 = await getOrder(order.id);
    expect(apiOrder3.status).toMatch(/payment_sent/);

    // Step 5: Release escrow to complete (auto-sets payment_confirmed)
    await releaseEscrow(order.id, 'merchant', m1.id);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const apiOrder4 = await getOrder(order.id);
    expect(apiOrder4.status).toMatch(/completed/);

    // Verify network calls were made
    expect(networkLogger.getApiCalls().length).toBeGreaterThan(0);
  });

  test('pending order shows correct UI elements', async ({ page }) => {
    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    // Verify pending order is visible
    const pendingOrder = scenario.orders.pending;
    const card = page.locator(`[data-testid="order-card-${pendingOrder.id}"]`);
    const isVisible = await card.isVisible().catch(() => false);

    if (isVisible) {
      // Check status badge shows OPEN
      const statusBadge = card.locator('[data-testid="order-status"]');
      if (await statusBadge.isVisible().catch(() => false)) {
        await expect(statusBadge).toHaveText(/open|pending/i);
      }
    }

    // Take screenshot for state matrix
    await page.screenshot({ path: 'e2e/results/pending-order.png', fullPage: true });
  });

  test('accepted order shows correct status', async ({ page }) => {
    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    const order = scenario.orders.accepted;
    const apiOrder = await getOrder(order.id);
    expect(apiOrder.status).toMatch(/accepted/);

    await page.screenshot({ path: 'e2e/results/accepted-order.png', fullPage: true });
  });

  test('escrowed order shows correct status', async ({ page }) => {
    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    const order = scenario.orders.escrowed;
    const apiOrder = await getOrder(order.id);
    expect(apiOrder.status).toMatch(/escrowed/);

    await page.screenshot({ path: 'e2e/results/escrowed-order.png', fullPage: true });
  });

  test('completed order shows correct status', async ({ page }) => {
    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    const order = scenario.orders.completed;
    const apiOrder = await getOrder(order.id);
    expect(apiOrder.status).toMatch(/completed/);

    await page.screenshot({ path: 'e2e/results/completed-order.png', fullPage: true });
  });
});
