import { test, expect, navigateAsMerchant } from './fixtures';
import {
  seedFullScenario,
  createOrder,
  transitionOrder,
  getOrder,
  ScenarioData,
} from './helpers/api';

let scenario: ScenarioData;

test.describe('Expiry Flow', () => {
  test.beforeAll(async () => {
    scenario = await seedFullScenario();
  });

  test('seeded expired order has correct state', async ({ page }) => {
    const expiredOrder = scenario.orders.expired;
    const apiOrder = await getOrder(expiredOrder.id);
    expect(apiOrder.status).toMatch(/expired/);

    // Navigate and check UI reflects expired
    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e/results/expired-order.png', fullPage: true });
  });

  test('expire via system transition works', async ({ page }) => {
    const m1 = scenario.merchants[0];
    const u1 = scenario.users[0];

    // Create a fresh order and expire it
    const order = await createOrder({
      userId: u1.id,
      merchantId: m1.id,
      offerId: scenario.offers[1].id,
      type: 'sell',
      amount: 180,
    });

    // System expires the order
    await transitionOrder(order.id, 'expired', 'system', m1.id);

    const apiOrder = await getOrder(order.id);
    expect(apiOrder.status).toMatch(/expired/);
  });
});
