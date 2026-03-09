/**
 * Request ID Propagation Tests
 *
 * Verifies that request IDs are correctly:
 * 1. Included in OrderLifecycleEvent via buildEvent
 * 2. Optional (backward-compatible)
 * 3. Present in the event type contract
 *
 * Uses manual mocks for dependencies that don't transform under Jest.
 */

// Mock transitive dependencies before importing the module under test
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/events/chatTemplates', () => ({
  getSystemChatMessage: jest.fn(() => null),
}));

import { buildEvent } from '../../src/lib/events/OrderEventEmitter';
import type { OrderLifecycleEvent } from '../../src/lib/events/types';

describe('Request ID Propagation', () => {
  describe('buildEvent', () => {
    it('includes requestId when provided', () => {
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.accepted',
        orderVersion: 2,
        actorType: 'merchant',
        actorId: '00000000-0000-0000-0000-000000000002',
        previousStatus: 'pending',
        newStatus: 'accepted',
        payload: {},
        requestId: 'test-req-123',
      });

      expect(event.requestId).toBe('test-req-123');
      expect(event.eventType).toBe('order.accepted');
      expect(event.orderId).toBe('00000000-0000-0000-0000-000000000001');
    });

    it('leaves requestId undefined when not provided', () => {
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.created',
        orderVersion: 1,
        actorType: 'user',
        actorId: '00000000-0000-0000-0000-000000000003',
        previousStatus: null,
        newStatus: 'pending',
      });

      expect(event.requestId).toBeUndefined();
    });

    it('preserves all existing fields when requestId is added', () => {
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.escrowed',
        orderVersion: 3,
        actorType: 'merchant',
        actorId: '00000000-0000-0000-0000-000000000002',
        previousStatus: 'accepted',
        newStatus: 'escrowed',
        payload: { txHash: '0xabc', amount: 100 },
        requestId: 'req-456',
      });

      expect(event.eventId).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.idempotencyKey).toContain('order.escrowed');
      expect(event.actor.type).toBe('merchant');
      expect(event.actor.id).toBe('00000000-0000-0000-0000-000000000002');
      expect(event.previousStatus).toBe('accepted');
      expect(event.newStatus).toBe('escrowed');
      expect(event.payload).toEqual({ txHash: '0xabc', amount: 100 });
      expect(event.requestId).toBe('req-456');
    });
  });

  describe('OrderLifecycleEvent type contract', () => {
    it('requestId is optional (backward-compatible)', () => {
      const eventWithout = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.completed',
        orderVersion: 5,
        actorType: 'system',
        actorId: 'system',
        previousStatus: 'payment_sent',
        newStatus: 'completed',
      });
      expect(eventWithout.requestId).toBeUndefined();

      const eventWith = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.completed',
        orderVersion: 5,
        actorType: 'system',
        actorId: 'system',
        previousStatus: 'payment_sent',
        newStatus: 'completed',
        requestId: 'req-789',
      });
      expect(eventWith.requestId).toBe('req-789');
    });

    it('event satisfies OrderLifecycleEvent interface with requestId', () => {
      const event: OrderLifecycleEvent = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.cancelled',
        orderVersion: 4,
        actorType: 'merchant',
        actorId: '00000000-0000-0000-0000-000000000002',
        previousStatus: 'escrowed',
        newStatus: 'cancelled',
        requestId: 'cancel-req-001',
      });

      expect(event.eventId).toBeTruthy();
      expect(event.eventType).toBe('order.cancelled');
      expect(event.requestId).toBe('cancel-req-001');
    });
  });
});
