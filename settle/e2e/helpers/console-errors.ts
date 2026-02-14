/**
 * Console Error Collector for Playwright Tests
 *
 * Collects console errors during test runs.
 * Tests can assert no unexpected errors occurred.
 */

import { Page } from '@playwright/test';

export class ConsoleErrorCollector {
  private errors: Array<{ text: string; type: string; timestamp: number }> = [];
  private allowedPatterns: RegExp[] = [
    /Download the React DevTools/,
    /Warning:/,
    /Pusher/i,
    /WebSocket/i,
    /favicon\.ico/,
    /\[HMR\]/,
    /hydration/i,
    /Fast Refresh/,
  ];

  async attach(page: Page): Promise<void> {
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const text = msg.text();
        const isAllowed = this.allowedPatterns.some((p) => p.test(text));
        if (!isAllowed) {
          this.errors.push({
            text,
            type: msg.type(),
            timestamp: Date.now(),
          });
        }
      }
    });

    page.on('pageerror', (error) => {
      this.errors.push({
        text: error.message,
        type: 'pageerror',
        timestamp: Date.now(),
      });
    });
  }

  getErrors(): Array<{ text: string; type: string; timestamp: number }> {
    return [...this.errors];
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  clear(): void {
    this.errors = [];
  }

  assertNoErrors(): void {
    if (this.errors.length > 0) {
      const messages = this.errors.map((e) => `[${e.type}] ${e.text}`).join('\n');
      throw new Error(`Unexpected console errors:\n${messages}`);
    }
  }
}
