/**
 * Assertion Library for Flow Tests
 *
 * Provides clear, descriptive assertion functions for test scenarios.
 */

import { OrderStatus, ActorType } from '../../../src/lib/types/database';
import { OrderEvent, ExpectedTransition, Order } from './types';

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/**
 * Assert that two values are equal
 */
export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new AssertionError(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

/**
 * Assert that a value is truthy
 */
export function assertTrue(value: boolean, label: string): void {
  if (!value) {
    throw new AssertionError(`${label}: expected truthy value, got ${value}`);
  }
}

/**
 * Assert that a value is defined (not null or undefined)
 */
export function assertDefined<T>(value: T | null | undefined, label: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new AssertionError(`${label}: expected defined value, got ${value}`);
  }
}

/**
 * Assert that balance changed by expected amount
 * Allows small floating point tolerance (0.01)
 */
export function assertBalanceChange(
  before: number,
  after: number,
  expectedChange: number,
  label: string
): void {
  const actualChange = after - before;
  const tolerance = 0.01;

  if (Math.abs(actualChange - expectedChange) > tolerance) {
    throw new AssertionError(
      `${label}: expected balance change Δ${expectedChange}, got Δ${actualChange} (before=${before}, after=${after})`
    );
  }
}

/**
 * Assert that order status matches expected
 */
export function assertStatus(
  actual: OrderStatus,
  expected: OrderStatus,
  context: string
): void {
  if (actual !== expected) {
    throw new AssertionError(
      `${context}: expected status '${expected}', got '${actual}'`
    );
  }
}

/**
 * Assert that order events match expected state transitions
 * Verifies the audit trail is correct
 */
export function assertStatusTransitions(
  events: OrderEvent[],
  expectedTransitions: ExpectedTransition[]
): void {
  if (events.length !== expectedTransitions.length) {
    throw new AssertionError(
      `Expected ${expectedTransitions.length} transitions, got ${events.length}\n` +
        `Events: ${events.map(e => `${e.old_status} → ${e.new_status}`).join(', ')}`
    );
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expected = expectedTransitions[i];

    if (event.old_status !== expected.from) {
      throw new AssertionError(
        `Transition ${i}: expected from='${expected.from}', got '${event.old_status}'`
      );
    }

    if (event.new_status !== expected.to) {
      throw new AssertionError(
        `Transition ${i}: expected to='${expected.to}', got '${event.new_status}'`
      );
    }

    if (event.actor_type !== expected.actor) {
      throw new AssertionError(
        `Transition ${i}: expected actor='${expected.actor}', got '${event.actor_type}'`
      );
    }
  }
}

/**
 * Assert that an array contains an item matching predicate
 */
export function assertContains<T>(
  array: T[],
  predicate: (item: T) => boolean,
  label: string
): void {
  if (!array.some(predicate)) {
    throw new AssertionError(
      `${label}: array does not contain expected item`
    );
  }
}

/**
 * Assert that value is within a numeric range
 */
export function assertInRange(
  value: number,
  min: number,
  max: number,
  label: string
): void {
  if (value < min || value > max) {
    throw new AssertionError(
      `${label}: expected value in range [${min}, ${max}], got ${value}`
    );
  }
}

/**
 * Get the effective status from an order (prefers minimal_status if available)
 * This allows tests to work with both old and new API responses
 */
export function getOrderStatus(order: Order): string {
  return order.minimal_status || order.status;
}

/**
 * Assert that order status matches expected minimal status
 * Checks minimal_status if available, otherwise checks status
 */
export function assertOrderStatus(
  order: Order,
  expectedMinimalStatus: string,
  context: string
): void {
  const actualStatus = getOrderStatus(order);
  if (actualStatus !== expectedMinimalStatus) {
    throw new AssertionError(
      `${context}: expected status '${expectedMinimalStatus}', got '${actualStatus}' (minimal_status: ${order.minimal_status}, status: ${order.status})`
    );
  }
}
