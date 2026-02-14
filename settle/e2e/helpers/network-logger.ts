/**
 * Network Logger for Playwright Tests
 *
 * Records all network requests and responses during tests
 * for debugging and assertion purposes.
 */

import { Page } from '@playwright/test';

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  responseSize: number;
  timestamp: number;
}

export class NetworkLogger {
  private entries: NetworkEntry[] = [];

  async attach(page: Page): Promise<void> {
    page.on('response', async (response) => {
      try {
        const body = await response.body().catch(() => Buffer.alloc(0));
        this.entries.push({
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          responseSize: body.length,
          timestamp: Date.now(),
        });
      } catch {
        // Response may have been aborted
      }
    });
  }

  getEntries(): NetworkEntry[] {
    return [...this.entries];
  }

  getByUrl(pattern: string | RegExp): NetworkEntry[] {
    return this.entries.filter((e) =>
      typeof pattern === 'string' ? e.url.includes(pattern) : pattern.test(e.url)
    );
  }

  getApiCalls(): NetworkEntry[] {
    return this.entries.filter((e) => e.url.includes('/api/') || e.url.includes('/v1/'));
  }

  hasCall(pattern: string | RegExp, method?: string): boolean {
    return this.getByUrl(pattern).some((e) => !method || e.method === method);
  }

  clear(): void {
    this.entries = [];
  }

  toJSON(): NetworkEntry[] {
    return this.entries;
  }
}
