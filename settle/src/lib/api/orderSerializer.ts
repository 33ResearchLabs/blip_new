/**
 * Order Serializer - Shared mapper for API responses
 *
 * Ensures all endpoints return consistent order format with:
 * - `status`: Legacy 12-state status (backwards compatible)
 * - `minimal_status`: New 8-state normalized status
 */

import { normalizeStatus, Order } from 'settlement-core';

/**
 * Serialize a single order for API response
 * Adds minimal_status field while preserving legacy status
 */
export function serializeOrder<T extends { status: string }>(order: T): T & { minimal_status: string } {
  return {
    ...order,
    minimal_status: normalizeStatus(order.status as any),
  };
}

/**
 * Serialize an array of orders for API response
 * Adds minimal_status to each order
 */
export function serializeOrders<T extends { status: string }>(orders: T[]): Array<T & { minimal_status: string }> {
  return orders.map(order => serializeOrder(order));
}

/**
 * Serialize order with additional fields
 * Useful for responses that include extra metadata
 */
export function serializeOrderWithMetadata<T extends { status: string }, M extends Record<string, any>>(
  order: T,
  metadata: M
): T & { minimal_status: string } & M {
  return {
    ...order,
    minimal_status: normalizeStatus(order.status as any),
    ...metadata,
  };
}
