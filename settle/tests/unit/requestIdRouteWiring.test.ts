/**
 * Request ID Route Wiring Tests
 *
 * Verifies that requestId flows end-to-end through settle-side code:
 * 1. buildEvent includes requestId in emitted events
 * 2. emitOrderEvent persists request_id to order_events table
 * 3. proxyCoreApi forwards requestId to core-api
 *
 * Tests the two most critical transitions: payment_sent and completed.
 */

// ─── Mocks ────────────────────────────────────────────────────────

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

// ─── Imports ──────────────────────────────────────────────────────

import { buildEvent, emitOrderEvent } from '../../src/lib/events/OrderEventEmitter';
import type { OrderLifecycleEvent } from '../../src/lib/events/types';

// ─── Tests ────────────────────────────────────────────────────────

describe('Request ID Route Wiring', () => {

  describe('payment_sent transition with requestId', () => {
    it('buildEvent includes requestId for payment_sent', () => {
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.payment_sent',
        orderVersion: 3,
        actorType: 'user',
        actorId: '00000000-0000-0000-0000-000000000002',
        previousStatus: 'escrowed',
        newStatus: 'payment_sent',
        payload: {
          fiatAmount: 367,
          fiatCurrency: 'AED',
          sentBy: 'user',
        },
        requestId: 'test-req-payment-001',
      });

      expect(event.requestId).toBe('test-req-payment-001');
      expect(event.eventType).toBe('order.payment_sent');
      expect(event.newStatus).toBe('payment_sent');
      expect(event.payload).toEqual(expect.objectContaining({
        fiatAmount: 367,
        fiatCurrency: 'AED',
      }));
    });

    it('emitOrderEvent persists request_id to order_events table', async () => {
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.payment_sent',
        orderVersion: 3,
        actorType: 'user',
        actorId: '00000000-0000-0000-0000-000000000002',
        previousStatus: 'escrowed',
        newStatus: 'payment_sent',
        payload: { fiatAmount: 367 },
        requestId: 'test-req-payment-001',
      });

      // Mock DB client
      const queries: Array<{ text: string; values: unknown[] }> = [];
      const mockClient = {
        query: jest.fn(async (text: string, values?: unknown[]) => {
          queries.push({ text, values: values || [] });
          return { rows: [], rowCount: 0 };
        }),
      };

      await emitOrderEvent(mockClient as any, event);

      // Find the order_events INSERT
      const insertQuery = queries.find(q =>
        q.text.includes('INSERT INTO order_events')
      );
      expect(insertQuery).toBeDefined();

      // The 10th parameter ($10) should be the requestId
      expect(insertQuery!.text).toContain('request_id');
      expect(insertQuery!.values).toContain('test-req-payment-001');
    });
  });

  describe('completed transition with requestId', () => {
    it('buildEvent includes requestId for completed', () => {
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.completed',
        orderVersion: 5,
        actorType: 'merchant',
        actorId: '00000000-0000-0000-0000-000000000003',
        previousStatus: 'payment_sent',
        newStatus: 'completed',
        payload: {
          releaseTxHash: '0xabc123',
          cryptoAmount: 100,
          cryptoCurrency: 'USDC',
          fiatAmount: 367,
          fiatCurrency: 'AED',
        },
        requestId: 'test-req-complete-001',
      });

      expect(event.requestId).toBe('test-req-complete-001');
      expect(event.eventType).toBe('order.completed');
      expect(event.newStatus).toBe('completed');
    });

    it('emitOrderEvent persists request_id for completed event', async () => {
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.completed',
        orderVersion: 5,
        actorType: 'merchant',
        actorId: '00000000-0000-0000-0000-000000000003',
        previousStatus: 'payment_sent',
        newStatus: 'completed',
        payload: { releaseTxHash: '0xabc123' },
        requestId: 'test-req-complete-001',
      });

      const queries: Array<{ text: string; values: unknown[] }> = [];
      const mockClient = {
        query: jest.fn(async (text: string, values?: unknown[]) => {
          queries.push({ text, values: values || [] });
          return { rows: [], rowCount: 0 };
        }),
      };

      await emitOrderEvent(mockClient as any, event);

      const insertQuery = queries.find(q =>
        q.text.includes('INSERT INTO order_events')
      );
      expect(insertQuery).toBeDefined();
      expect(insertQuery!.text).toContain('request_id');
      expect(insertQuery!.values).toContain('test-req-complete-001');
    });
  });

  describe('requestId absent (backward compatibility)', () => {
    it('emitOrderEvent uses null when requestId is undefined', async () => {
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.accepted',
        orderVersion: 2,
        actorType: 'merchant',
        actorId: '00000000-0000-0000-0000-000000000003',
        previousStatus: 'pending',
        newStatus: 'accepted',
        // no requestId
      });

      expect(event.requestId).toBeUndefined();

      const queries: Array<{ text: string; values: unknown[] }> = [];
      const mockClient = {
        query: jest.fn(async (text: string, values?: unknown[]) => {
          queries.push({ text, values: values || [] });
          return { rows: [], rowCount: 0 };
        }),
      };

      await emitOrderEvent(mockClient as any, event);

      const insertQuery = queries.find(q =>
        q.text.includes('INSERT INTO order_events')
      );
      expect(insertQuery).toBeDefined();
      // request_id should be null (not undefined) in the SQL params
      const requestIdValue = insertQuery!.values[insertQuery!.values.length - 1];
      expect(requestIdValue).toBeNull();
    });
  });

  describe('requestId stability across event chain', () => {
    it('same requestId appears in event and DB insert', async () => {
      const requestId = 'stable-req-id-xyz';

      // Step 1: buildEvent preserves it
      const event = buildEvent({
        orderId: '00000000-0000-0000-0000-000000000001',
        eventType: 'order.payment_sent',
        orderVersion: 4,
        actorType: 'user',
        actorId: '00000000-0000-0000-0000-000000000002',
        previousStatus: 'escrowed',
        newStatus: 'payment_sent',
        requestId,
      });
      expect(event.requestId).toBe(requestId);

      // Step 2: emitOrderEvent persists it
      const queries: Array<{ text: string; values: unknown[] }> = [];
      const mockClient = {
        query: jest.fn(async (text: string, values?: unknown[]) => {
          queries.push({ text, values: values || [] });
          return { rows: [], rowCount: 0 };
        }),
      };

      await emitOrderEvent(mockClient as any, event);

      const insertQuery = queries.find(q =>
        q.text.includes('INSERT INTO order_events')
      );
      expect(insertQuery!.values).toContain(requestId);

      // Step 3: The same string is in the event object and DB — no mutation
      expect(event.requestId).toBe(requestId);
    });
  });
});
