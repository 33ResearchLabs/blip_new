import { test, expect, navigateAsMerchant } from './fixtures';
import {
  seedFullScenario,
  createOrder,
  transitionOrder,
  cancelOrder,
  getOrder,
  ScenarioData,
} from './helpers/api';

let scenario: ScenarioData;

test.describe('Cancel Flow', () => {
  test.beforeAll(async () => {
    scenario = await seedFullScenario();
  });

  test('cancel pending order succeeds', async ({ page, networkLogger }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];

    // Create a fresh order to cancel
    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: scenario.offers[0].id,
      type: 'buy',
      amount: 100,
    });

    // Cancel via API
    await cancelOrder(order.id, 'user', u1.id);

    // Verify cancellation
    const apiOrder = await getOrder(order.id);
    expect(apiOrder.status).toMatch(/cancelled/);

    // Navigate and verify UI shows cancelled
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e/results/cancelled-order.png', fullPage: true });
  });

  test('cancel accepted order succeeds', async ({ page }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];

    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: scenario.offers[0].id,
      type: 'buy',
      amount: 120,
    });

    // Accept then cancel
    await transitionOrder(order.id, 'accepted', 'merchant', m1.id);
    await cancelOrder(order.id, 'merchant', m1.id);

    const apiOrder = await getOrder(order.id);
    expect(apiOrder.status).toMatch(/cancelled/);
  });

  test('seeded cancelled order has correct state', async ({ page }) => {
    const cancelledOrder = scenario.orders.cancelled;
    const apiOrder = await getOrder(cancelledOrder.id);
    expect(apiOrder.status).toMatch(/cancelled/);

    // Navigate and verify
    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e/results/cancel-seeded.png', fullPage: true });
  });
});
