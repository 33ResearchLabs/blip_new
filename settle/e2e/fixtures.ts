/**
 * Playwright Test Fixtures
 *
 * Provides test-specific fixtures like network logger,
 * console error collector, and merchant page navigation.
 */

import { test as base, expect } from '@playwright/test';
import { NetworkLogger } from './helpers/network-logger';
import { ConsoleErrorCollector } from './helpers/console-errors';

// Extended test with custom fixtures
export const test = base.extend<{
  networkLogger: NetworkLogger;
  consoleErrors: ConsoleErrorCollector;
}>({
  networkLogger: async ({ page }, use) => {
    const logger = new NetworkLogger();
    await logger.attach(page);
    await use(logger);
  },
  consoleErrors: async ({ page }, use) => {
    const collector = new ConsoleErrorCollector();
    await collector.attach(page);
    await use(collector);
  },
});

export { expect };

/**
 * Navigate to merchant dashboard as a specific merchant.
 * The app restores sessions from localStorage('blip_merchant')
 * and validates via GET /api/auth/merchant?action=check_session.
 * We set localStorage before navigation so the dashboard auto-logs in.
 */
export async function navigateAsMerchant(
  page: any,
  merchantId: string,
  merchantUsername: string,
): Promise<void> {
  // First navigate to get on the right origin (required for localStorage)
  await page.goto('/merchant', { waitUntil: 'commit' });

  // Inject merchant session into localStorage so the dashboard auto-authenticates
  await page.evaluate(
    ({ id, username }: { id: string; username: string }) => {
      const merchantData = {
        id,
        username,
        display_name: username,
        business_name: username,
        wallet_address: null,
        rating: 5,
        total_trades: 0,
        balance: 50000,
      };
      localStorage.setItem('blip_merchant', JSON.stringify(merchantData));
    },
    { id: merchantId, username: merchantUsername },
  );

  // Reload so the useEffect picks up the localStorage session
  await page.reload({ waitUntil: 'networkidle' });

  // Wait for the dashboard to load (session check + render)
  await page.waitForSelector('[data-testid="merchant-dashboard"]', { timeout: 20000 }).catch(() => {
    // Fallback: wait for any content to render
    return page.waitForTimeout(5000);
  });
}
