#!/usr/bin/env tsx
/**
 * Flow Test Runner
 *
 * Orchestrates the complete test pipeline:
 * 1. Reset database (truncate all data)
 * 2. Seed test data (deterministic users, merchants, offers)
 * 3. Run all test scenarios sequentially
 * 4. Report results with colored output
 * 5. Exit with code 0 (success) or 1 (failure)
 *
 * Usage:
 *   pnpm test:flow
 *   TEST_BASE_URL=http://localhost:3000 pnpm test:flow
 */

import { ApiClient } from './lib/http';
import { TestReporter } from './lib/reporter';
import { TestScenario, TestData } from './lib/types';

// Import all test scenarios
import { userBuyHappy } from './scenarios/user-buy-happy';
import { userSellHappy } from './scenarios/user-sell-happy';
import { m2mBuyHappy } from './scenarios/m2m-buy-happy';
import { m2mSellHappy } from './scenarios/m2m-sell-happy';

// Define all scenarios to run
const SCENARIOS: TestScenario[] = [
  userBuyHappy,
  userSellHappy,
  m2mBuyHappy,
  m2mSellHappy,
  // Future scenarios:
  // userBuyCancel,
  // userSellCancel,
  // userBuyExpire,
  // userSellExpire,
  // userBuyDispute,
  // userSellDispute,
  // m2mBuyCancel,
  // m2mSellDispute,
];

async function main() {
  const baseUrl = process.env.SETTLE_URL || process.env.TEST_BASE_URL || 'https://localhost:3000';
  const api = new ApiClient(baseUrl);
  const reporter = new TestReporter();

  console.log('');
  console.log('========================================');
  console.log('  Blip Money - Flow Test Suite');
  console.log('========================================');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Scenarios: ${SCENARIOS.length}`);
  console.log('========================================\n');

  try {
    // Step 1: Reset database
    reporter.printProgress('🔄 Resetting database...');
    const resetRes = await api.post<{ success: boolean; message: string }>(
      '/api/test/reset',
      { confirm: true }
    );

    if (!resetRes.success) {
      reporter.printError(`Database reset failed: ${resetRes.message}`);
      process.exit(1);
    }
    reporter.printSuccess('Database reset complete');

    // Step 2: Seed test data
    reporter.printProgress('🌱 Seeding test data...');
    const seedRes = await api.post<{
      success: boolean;
      data: TestData;
      summary: {
        users_created: number;
        merchants_created: number;
        offers_created: number;
      };
    }>('/api/test/seed', { scenario: 'full' });

    if (!seedRes.success) {
      reporter.printError('Seed failed');
      process.exit(1);
    }

    const { users_created, merchants_created, offers_created } = seedRes.summary;
    reporter.printSuccess(
      `Seed complete: ${users_created} users, ${merchants_created} merchants, ${offers_created} offers`
    );

    const testData = seedRes.data;

    // Step 3: Run all scenarios
    console.log('\n🧪 Running flow tests...\n');

    for (const scenario of SCENARIOS) {
      const startTime = Date.now();

      try {
        await scenario.run(api, testData);
        const duration = Date.now() - startTime;

        reporter.addResult({
          scenario: scenario.name,
          passed: true,
          duration,
        });

        console.log(`✓ ${scenario.name} (${duration}ms)`);
      } catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';

        console.log(`✗ ${scenario.name} (${duration}ms)`);
        console.error(`  Error: ${errorMessage}`);

        // Try to fetch order events for the failed test (if order ID is in error)
        // This would require enhanced error context from scenarios
        reporter.addResult({
          scenario: scenario.name,
          passed: false,
          duration,
          error: errorMessage,
        });
      }
    }

    // Step 4: Print summary
    reporter.printSummary();

    // Step 5: Exit with appropriate code
    process.exit(reporter.hasFailures() ? 1 : 0);
  } catch (error) {
    reporter.printError(
      `Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    console.error(error);
    process.exit(1);
  }
}

// Run the main function
main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
