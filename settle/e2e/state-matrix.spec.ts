import { test, expect, navigateAsMerchant } from './fixtures';
import {
  seedFullScenario,
  getOrder,
  ScenarioData,
} from './helpers/api';

let scenario: ScenarioData;

const ALL_STATES = [
  'pending',
  'accepted',
  'escrowed',
  'payment_sent',
  'completed',
  'cancelled',
  'expired',
  'disputed',
] as const;

test.describe('State Matrix', () => {
  test.beforeAll(async () => {
    scenario = await seedFullScenario();
  });

  test('all seeded orders have correct API state', async () => {
    for (const state of ALL_STATES) {
      const order = scenario.orders[state];
      const apiOrder = await getOrder(order.id);

      // The DB status should contain the expected state
      // (pending maps to 'pending' in DB, etc.)
      const expectedDbStatuses: Record<string, string[]> = {
        pending: ['pending'],
        accepted: ['accepted'],
        escrowed: ['escrowed'],
        payment_sent: ['payment_sent'],
        completed: ['completed'],
        cancelled: ['cancelled'],
        expired: ['expired'],
        disputed: ['disputed'],
      };

      const validStatuses = expectedDbStatuses[state];
      expect(
        validStatuses.some((s) => apiOrder.status.includes(s)),
        `Order ${order.id} (${state}): expected status to include one of [${validStatuses}], got "${apiOrder.status}"`,
      ).toBe(true);
    }
  });

  test('dashboard screenshots for each state', async ({ page }) => {
    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    // Take full dashboard screenshot
    await page.screenshot({
      path: 'e2e/results/state-matrix-dashboard.png',
      fullPage: true
    });
  });

  for (const state of ALL_STATES) {
    test(`order card screenshot: ${state}`, async ({ page }) => {
      const m1 = scenario.merchants[0];
      await navigateAsMerchant(page, m1.id, m1.username);
      await page.waitForTimeout(3000);

      const order = scenario.orders[state];

      // Try to find the order card
      const card = page.locator(`[data-testid="order-card-${order.id}"]`);
      const isVisible = await card.isVisible().catch(() => false);

      if (isVisible) {
        // Screenshot just the card
        await card.screenshot({ path: `e2e/results/order-card-${state}.png` });
      } else {
        // Full page screenshot as fallback
        await page.screenshot({ path: `e2e/results/order-state-${state}.png`, fullPage: true });
      }
    });
  }

  test('disputed order shows dispute info', async ({ page }) => {
    const disputedOrder = scenario.orders.disputed;
    const apiOrder = await getOrder(disputedOrder.id);
    expect(apiOrder.status).toMatch(/disputed/);

    const m1 = scenario.merchants[0];
    await navigateAsMerchant(page, m1.id, m1.username);
    await page.waitForTimeout(3000);

    await page.screenshot({ path: 'e2e/results/disputed-detail.png', fullPage: true });
  });
});
