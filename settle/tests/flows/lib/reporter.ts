/**
 * Test Reporter for Flow Tests
 *
 * Provides colored console output and failure reporting with
 * order events audit trail for debugging.
 */

import { TestResult, OrderEvent } from './types';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

export class TestReporter {
  private results: TestResult[] = [];

  /**
   * Add a test result
   */
  addResult(result: TestResult): void {
    this.results.push(result);
  }

  /**
   * Print summary of all test results
   */
  printSummary(): void {
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    const total = this.results.length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log('\n' + '='.repeat(70));
    console.log(this.bold('TEST SUMMARY'));
    console.log('='.repeat(70));

    // Print each test result
    for (const result of this.results) {
      const status = result.passed
        ? this.green('✓ PASS')
        : this.red('✗ FAIL');
      const duration = this.cyan(`${result.duration}ms`);
      const scenarioName = result.scenario.padEnd(45);

      console.log(`${status} ${scenarioName} ${duration}`);

      // Print error details for failed tests
      if (!result.passed && result.error) {
        console.log(this.red(`  Error: ${result.error}`));

        // Print order events if available
        if (result.orderEvents && result.orderEvents.length > 0) {
          console.log(this.yellow('  Order events (audit trail):'));
          for (const event of result.orderEvents.slice(-20)) {
            // Show last 20
            const transition = `${event.old_status || 'null'} → ${event.new_status}`;
            const actor = `(${event.actor_type})`;
            console.log(this.yellow(`    ${transition} ${actor}`));
          }
        }
        console.log(''); // Empty line after error
      }
    }

    // Print final summary
    console.log('='.repeat(70));
    const passedStr = this.green(`Passed: ${passed}`);
    const failedStr = failed > 0 ? this.red(`Failed: ${failed}`) : `Failed: ${failed}`;
    const totalStr = `Total: ${total}`;
    const durationStr = this.cyan(`Duration: ${totalDuration}ms`);

    console.log(`${this.bold(totalStr)} | ${passedStr} | ${failedStr} | ${durationStr}`);
    console.log('='.repeat(70) + '\n');
  }

  /**
   * Check if any tests failed
   */
  hasFailures(): boolean {
    return this.results.some(r => !r.passed);
  }

  /**
   * Get all results
   */
  getResults(): TestResult[] {
    return this.results;
  }

  /**
   * Print a progress message
   */
  printProgress(message: string): void {
    console.log(this.cyan(message));
  }

  /**
   * Print an error message
   */
  printError(message: string): void {
    console.log(this.red(`✗ ${message}`));
  }

  /**
   * Print a success message
   */
  printSuccess(message: string): void {
    console.log(this.green(`✓ ${message}`));
  }

  // Helper methods for colored output
  private green(text: string): string {
    return `${colors.green}${text}${colors.reset}`;
  }

  private red(text: string): string {
    return `${colors.red}${text}${colors.reset}`;
  }

  private yellow(text: string): string {
    return `${colors.yellow}${text}${colors.reset}`;
  }

  private cyan(text: string): string {
    return `${colors.cyan}${text}${colors.reset}`;
  }

  private bold(text: string): string {
    return `${colors.bright}${text}${colors.reset}`;
  }
}
