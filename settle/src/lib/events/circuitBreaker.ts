/**
 * Circuit Breaker
 *
 * Protects against cascading failures when calling external services
 * (Pusher, core-api). When failures exceed a threshold, the circuit
 * opens and fast-fails requests until a timeout elapses.
 *
 * States:
 * - CLOSED: normal operation, requests pass through
 * - OPEN: failures exceeded threshold, requests fast-fail
 * - HALF_OPEN: timeout elapsed, one probe request allowed
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerConfig {
  /** Name for logging */
  name: string;
  /** Consecutive failures before opening */
  failureThreshold: number;
  /** Time in ms before transitioning from open → half_open */
  resetTimeoutMs: number;
  /** Successful probes in half_open before closing */
  halfOpenMaxAttempts: number;
}

const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenSuccesses = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = 'half_open';
        this.halfOpenSuccesses = 0;
      } else {
        throw new CircuitOpenError(
          `Circuit breaker [${this.config.name}] is OPEN — requests blocked for ${Math.ceil((this.config.resetTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000)}s`
        );
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Check if a call can proceed without executing.
   * Use this for fire-and-forget paths where you want to skip
   * the call entirely when the circuit is open.
   */
  canCall(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = 'half_open';
        this.halfOpenSuccesses = 0;
        return true;
      }
      return false;
    }
    // half_open: allow probe
    return true;
  }

  private onSuccess(): void {
    if (this.state === 'half_open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenMaxAttempts) {
        this.state = 'closed';
        this.failureCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats() {
    return {
      name: this.config.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
