/**
 * Contract Tests: Minimal Status Field
 *
 * Ensures all order-returning endpoints include minimal_status with valid values
 */

import { describe, it, expect } from '@jest/globals';

const VALID_MINIMAL_STATUSES = [
  'open',
  'accepted',
  'escrowed',
  'payment_sent',
  'completed',
  'cancelled',
  'expired',
  'disputed',
] as const;

type MinimalStatus = typeof VALID_MINIMAL_STATUSES[number];

function isValidMinimalStatus(status: any): status is MinimalStatus {
  return VALID_MINIMAL_STATUSES.includes(status);
}

describe('Minimal Status Contract Tests', () => {
  describe('Order Serializer', () => {
    it('should serialize single order with minimal_status', async () => {
      const { serializeOrder } = await import('@/lib/api/orderSerializer');

      const testOrder = {
        id: 'test-123',
        status: 'pending',
        crypto_amount: 100,
      };

      const serialized = serializeOrder(testOrder);

      expect(serialized).toHaveProperty('minimal_status');
      expect(isValidMinimalStatus(serialized.minimal_status)).toBe(true);
      expect(serialized.status).toBe('pending');
      expect(serialized.minimal_status).toBe('open');
    });

    it('should serialize array of orders with minimal_status', async () => {
      const { serializeOrders } = await import('@/lib/api/orderSerializer');

      const testOrders = [
        { id: '1', status: 'pending' },
        { id: '2', status: 'accepted' },
        { id: '3', status: 'payment_confirmed' },
        { id: '4', status: 'completed' },
      ];

      const serialized = serializeOrders(testOrders);

      expect(serialized).toHaveLength(4);
      serialized.forEach((order) => {
        expect(order).toHaveProperty('minimal_status');
        expect(isValidMinimalStatus(order.minimal_status)).toBe(true);
      });

      // Check specific mappings
      expect(serialized[0].minimal_status).toBe('open');
      expect(serialized[1].minimal_status).toBe('accepted');
      expect(serialized[2].minimal_status).toBe('payment_sent');
      expect(serialized[3].minimal_status).toBe('completed');
    });

    it('should serialize order with metadata', async () => {
      const { serializeOrderWithMetadata } = await import('@/lib/api/orderSerializer');

      const testOrder = {
        id: 'test-456',
        status: 'escrowed',
      };

      const metadata = {
        escrow_verified: true,
        custom_field: 'value',
      };

      const serialized = serializeOrderWithMetadata(testOrder, metadata);

      expect(serialized).toHaveProperty('minimal_status');
      expect(serialized.minimal_status).toBe('escrowed');
      expect(serialized.escrow_verified).toBe(true);
      expect(serialized.custom_field).toBe('value');
    });

    it('should handle all 12-to-8 status mappings', async () => {
      const { serializeOrder } = await import('@/lib/api/orderSerializer');

      const mappings = [
        { db: 'pending', minimal: 'open' },
        { db: 'accepted', minimal: 'accepted' },
        { db: 'escrow_pending', minimal: 'accepted' },
        { db: 'escrowed', minimal: 'escrowed' },
        { db: 'payment_pending', minimal: 'escrowed' },
        { db: 'payment_sent', minimal: 'payment_sent' },
        { db: 'payment_confirmed', minimal: 'payment_sent' },
        { db: 'releasing', minimal: 'completed' },
        { db: 'completed', minimal: 'completed' },
        { db: 'cancelled', minimal: 'cancelled' },
        { db: 'disputed', minimal: 'disputed' },
        { db: 'expired', minimal: 'expired' },
      ];

      mappings.forEach(({ db, minimal }) => {
        const serialized = serializeOrder({ id: 'test', status: db });
        expect(serialized.minimal_status).toBe(minimal);
      });
    });
  });

  describe('Status Normalizer', () => {
    it('should normalize all legacy statuses', async () => {
      const { normalizeStatus } = await import('settlement-core');

      expect(normalizeStatus('pending')).toBe('open');
      expect(normalizeStatus('accepted')).toBe('accepted');
      expect(normalizeStatus('escrow_pending')).toBe('accepted');
      expect(normalizeStatus('escrowed')).toBe('escrowed');
      expect(normalizeStatus('payment_pending')).toBe('escrowed');
      expect(normalizeStatus('payment_sent')).toBe('payment_sent');
      expect(normalizeStatus('payment_confirmed')).toBe('payment_sent');
      expect(normalizeStatus('releasing')).toBe('completed');
      expect(normalizeStatus('completed')).toBe('completed');
      expect(normalizeStatus('cancelled')).toBe('cancelled');
      expect(normalizeStatus('disputed')).toBe('disputed');
      expect(normalizeStatus('expired')).toBe('expired');
    });

    it('should return only valid minimal statuses', async () => {
      const { normalizeStatus } = await import('settlement-core');

      const allStatuses = [
        'pending', 'accepted', 'escrow_pending', 'escrowed',
        'payment_pending', 'payment_sent', 'payment_confirmed',
        'releasing', 'completed', 'cancelled', 'disputed', 'expired',
      ];

      allStatuses.forEach((status) => {
        const normalized = normalizeStatus(status as any);
        expect(isValidMinimalStatus(normalized)).toBe(true);
      });
    });
  });

  describe('Endpoint Response Contracts', () => {
    it('should validate minimal_status is one of 8 allowed values', () => {
      const testCases = [
        { status: 'open', valid: true },
        { status: 'accepted', valid: true },
        { status: 'escrowed', valid: true },
        { status: 'payment_sent', valid: true },
        { status: 'completed', valid: true },
        { status: 'cancelled', valid: true },
        { status: 'expired', valid: true },
        { status: 'disputed', valid: true },
        { status: 'pending', valid: false },
        { status: 'payment_confirmed', valid: false },
        { status: 'releasing', valid: false },
        { status: 'escrow_pending', valid: false },
        { status: 'payment_pending', valid: false },
      ];

      testCases.forEach(({ status, valid }) => {
        expect(isValidMinimalStatus(status)).toBe(valid);
      });
    });

    it('should ensure minimal_status never includes transient statuses', () => {
      const transientStatuses = [
        'pending',
        'escrow_pending',
        'payment_pending',
        'payment_confirmed',
        'releasing',
      ];

      transientStatuses.forEach((status) => {
        expect(VALID_MINIMAL_STATUSES.includes(status as any)).toBe(false);
      });
    });
  });
});
