/**
 * Lightweight in-memory metrics collector for Solana transactions.
 *
 * Zero-overhead: just increments counters + updates rolling averages.
 * Logs a summary every 60s or after 20 transactions, whichever comes first.
 *
 * Used by sendAndConfirmSafe to track reliability in production without
 * piping every tx through a heavy analytics pipeline.
 */

import { logger } from '@/lib/logger';

interface MetricsSnapshot {
  total: number;
  succeeded: number;
  failed: number;
  retries: number;
  reconciled: number;
  avgLatencyMs: number;
  failureReasons: Record<string, number>;
}

class TxMetrics {
  private total = 0;
  private succeeded = 0;
  private failed = 0;
  private retries = 0;
  private reconciled = 0;
  private totalLatencyMs = 0;
  private failureReasons: Record<string, number> = {};
  private lastFlushAt = Date.now();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Categorize an error message into a short bucket for aggregation */
  private categorize(err: unknown): string {
    const msg = String((err as Error)?.message ?? err ?? '').toLowerCase();
    if (msg.includes('user rejected') || msg.includes('user cancelled')) return 'user_rejected';
    if (msg.includes('blockhash')) return 'blockhash_expired';
    if (msg.includes('insufficient')) return 'insufficient_funds';
    if (msg.includes('timed out') || msg.includes('timeout')) return 'timeout';
    if (msg.includes('network') || msg.includes('fetch failed')) return 'network';
    if (msg.includes('503') || msg.includes('service unavailable')) return 'rpc_down';
    if (msg.includes('429') || msg.includes('rate')) return 'rate_limited';
    return 'other';
  }

  recordSuccess(opts: { latencyMs: number; attempts: number; reconciled: boolean }) {
    this.total += 1;
    this.succeeded += 1;
    this.retries += Math.max(0, opts.attempts - 1);
    if (opts.reconciled) this.reconciled += 1;
    this.totalLatencyMs += opts.latencyMs;
    this.scheduleFlush();
  }

  recordFailure(opts: { latencyMs: number; attempts: number; error: unknown }) {
    this.total += 1;
    this.failed += 1;
    this.retries += Math.max(0, opts.attempts - 1);
    this.totalLatencyMs += opts.latencyMs;
    const bucket = this.categorize(opts.error);
    this.failureReasons[bucket] = (this.failureReasons[bucket] ?? 0) + 1;
    this.scheduleFlush();
  }

  snapshot(): MetricsSnapshot {
    return {
      total: this.total,
      succeeded: this.succeeded,
      failed: this.failed,
      retries: this.retries,
      reconciled: this.reconciled,
      avgLatencyMs: this.total > 0 ? Math.round(this.totalLatencyMs / this.total) : 0,
      failureReasons: { ...this.failureReasons },
    };
  }

  /** Reset counters after a flush so rolling windows stay bounded */
  reset() {
    this.total = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.retries = 0;
    this.reconciled = 0;
    this.totalLatencyMs = 0;
    this.failureReasons = {};
    this.lastFlushAt = Date.now();
  }

  private scheduleFlush() {
    // Flush immediately if we've accumulated 20+ txs; otherwise debounce to 60s
    if (this.total >= 20) {
      this.flush();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 60_000);
  }

  private flush() {
    if (this.total === 0) return;
    const snap = this.snapshot();
    const successRate = snap.total > 0 ? (snap.succeeded / snap.total) * 100 : 0;
    logger.info('[metrics][safeTx]', {
      total: snap.total,
      successRate: `${successRate.toFixed(1)}%`,
      avgLatencyMs: snap.avgLatencyMs,
      retries: snap.retries,
      reconciled: snap.reconciled,
      failureReasons: snap.failureReasons,
      windowSec: Math.round((Date.now() - this.lastFlushAt) / 1000),
    });
    this.reset();
  }
}

export const txMetrics = new TxMetrics();
