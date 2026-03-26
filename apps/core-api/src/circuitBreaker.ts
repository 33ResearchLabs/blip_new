/**
 * Simple Circuit Breaker for External Service Calls
 *
 * Prevents cascading failures when external services (Telegram, reputation API)
 * are down. Tracks consecutive failures per service and trips the circuit
 * when the threshold is exceeded.
 *
 * States:
 *   CLOSED  → Normal operation. Calls pass through.
 *   OPEN    → Failures exceeded threshold. Calls are short-circuited immediately.
 *   HALF_OPEN → Cooldown elapsed. One probe call is allowed to test recovery.
 *
 * Design:
 *   - Per-service state (keyed by service name)
 *   - Auto-recovery after cooldown period
 *   - Does NOT affect internal DB operations — only wraps external HTTP calls
 *   - Returns a typed error so callers can decide what to do (retry later, skip, etc.)
 */

import { logger } from 'settlement-core';

// ── Configuration ────────────────────────────────────────────
const DEFAULT_FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD || '5', 10);
const DEFAULT_COOLDOWN_MS       = parseInt(process.env.CB_COOLDOWN_MS || '60000', 10); // 1 minute

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitInfo {
  state: CircuitState;
  failures: number;
  lastFailureAt: number;
  /** Timestamp when the circuit opened (for cooldown calculation). */
  openedAt: number;
}

const circuits = new Map<string, CircuitInfo>();

function getCircuit(service: string): CircuitInfo {
  let c = circuits.get(service);
  if (!c) {
    c = { state: 'CLOSED', failures: 0, lastFailureAt: 0, openedAt: 0 };
    circuits.set(service, c);
  }
  return c;
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before tripping. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds before attempting recovery. Default: 60000 (1 min) */
  cooldownMs?: number;
}

export class CircuitBreakerError extends Error {
  public readonly service: string;
  public readonly retryAfterMs: number;

  constructor(service: string, retryAfterMs: number) {
    super(`SERVICE_UNAVAILABLE_RETRY: ${service} circuit is open (retry in ${retryAfterMs}ms)`);
    this.name = 'CircuitBreakerError';
    this.service = service;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Execute an async operation with circuit breaker protection.
 *
 * @param service  - Unique name for the external service (e.g. 'telegram', 'reputation')
 * @param fn       - The async operation to execute
 * @param options  - Optional thresholds
 * @returns The result of fn(), or throws CircuitBreakerError if the circuit is open
 */
export async function withCircuitBreaker<T>(
  service: string,
  fn: () => Promise<T>,
  options?: CircuitBreakerOptions
): Promise<T> {
  const threshold  = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
  const cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const circuit    = getCircuit(service);
  const now        = Date.now();

  // ── OPEN → check if cooldown has elapsed ──
  if (circuit.state === 'OPEN') {
    const elapsed = now - circuit.openedAt;
    if (elapsed < cooldownMs) {
      const retryAfterMs = cooldownMs - elapsed;
      throw new CircuitBreakerError(service, retryAfterMs);
    }
    // Cooldown elapsed → transition to HALF_OPEN (allow one probe)
    circuit.state = 'HALF_OPEN';
    logger.info(`[CircuitBreaker] ${service}: OPEN → HALF_OPEN (probe allowed)`);
  }

  // ── Execute the call ──
  try {
    const result = await fn();

    // Success → reset circuit
    if (circuit.state === 'HALF_OPEN' || circuit.failures > 0) {
      logger.info(`[CircuitBreaker] ${service}: ${circuit.state} → CLOSED (success)`);
    }
    circuit.state = 'CLOSED';
    circuit.failures = 0;
    return result;
  } catch (err) {
    circuit.failures++;
    circuit.lastFailureAt = now;

    if (circuit.failures >= threshold) {
      circuit.state = 'OPEN';
      circuit.openedAt = now;
      logger.warn(`[CircuitBreaker] ${service}: CLOSED → OPEN (${circuit.failures} consecutive failures)`, {
        service,
        failures: circuit.failures,
        threshold,
        cooldownMs,
      });
    } else if (circuit.state === 'HALF_OPEN') {
      // Probe failed → back to OPEN
      circuit.state = 'OPEN';
      circuit.openedAt = now;
      logger.warn(`[CircuitBreaker] ${service}: HALF_OPEN → OPEN (probe failed)`);
    }

    throw err;
  }
}

/**
 * Check if a circuit is currently open (for logging/metrics).
 */
export function isCircuitOpen(service: string): boolean {
  const c = circuits.get(service);
  if (!c) return false;
  return c.state === 'OPEN';
}

/**
 * Get circuit state for debugging/health checks.
 */
export function getCircuitState(service: string): { state: CircuitState; failures: number } {
  const c = circuits.get(service);
  if (!c) return { state: 'CLOSED', failures: 0 };
  return { state: c.state, failures: c.failures };
}
