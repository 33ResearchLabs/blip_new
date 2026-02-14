/**
 * Unit Tests for Order State Machine
 */

import {
  validateTransition,
  isTerminalStatus,
  isActiveStatus,
  shouldRestoreLiquidity,
  getTransitionEventType,
  getStatusTimeout,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  ORDER_STATUSES,
} from 'settlement-core';

describe('Order State Machine', () => {
  describe('validateTransition', () => {
    // Valid transitions - User
    describe('User transitions', () => {
      it('should allow user to cancel open order', () => {
        // Note: 'open' maps to 'pending' in DB layer
        const result = validateTransition('pending', 'cancelled', 'user');
        expect(result.valid).toBe(true);
      });

      it('should allow user to mark payment sent from escrowed', () => {
        const result = validateTransition('escrowed', 'payment_sent', 'user');
        expect(result.valid).toBe(true);
      });

      it('should allow user to raise dispute from payment_sent', () => {
        const result = validateTransition('payment_sent', 'disputed', 'user');
        expect(result.valid).toBe(true);
      });

      it('should NOT allow user to accept order', () => {
        const result = validateTransition('pending', 'accepted', 'user');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should allow user to transition to payment_confirmed (DB layer allows, repository blocks)', () => {
        // payment_confirmed is allowed by state machine for backwards compatibility
        // but repository layer (orders.ts) blocks writes to transient statuses
        const result = validateTransition('payment_sent', 'payment_confirmed', 'user');
        expect(result.valid).toBe(true); // State machine allows for backwards compat
        // Note: Repository layer will reject with "transient status cannot be written"
      });
    });

    // Valid transitions - Merchant
    describe('Merchant transitions', () => {
      it('should allow merchant to accept open order', () => {
        // Note: 'open' maps to 'pending' in DB layer
        const result = validateTransition('pending', 'accepted', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to confirm payment (DB layer transition)', () => {
        // Note: payment_confirmed is transient and collapses to payment_sent in minimal API
        const result = validateTransition('payment_sent', 'payment_confirmed', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to complete order from payment_confirmed (DB layer)', () => {
        // Note: This is a DB-layer transition; in minimal API, goes directly to completed
        const result = validateTransition('payment_confirmed', 'completed', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to cancel open order', () => {
        const result = validateTransition('pending', 'cancelled', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to raise dispute', () => {
        const result = validateTransition('payment_sent', 'disputed', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to mark payment sent from escrowed', () => {
        // Note: Merchant CAN send payment (for sell orders)
        const result = validateTransition('escrowed', 'payment_sent', 'merchant');
        expect(result.valid).toBe(true);
      });
    });

    // Valid transitions - System
    describe('System transitions', () => {
      it('should allow system to expire open order', () => {
        // Note: 'open' maps to 'pending' in DB layer
        const result = validateTransition('pending', 'expired', 'system');
        expect(result.valid).toBe(true);
      });

      it('should allow system to complete disputed order (resolution)', () => {
        const result = validateTransition('disputed', 'completed', 'system');
        expect(result.valid).toBe(true);
      });

      it('should allow system to cancel disputed order (resolution)', () => {
        const result = validateTransition('disputed', 'cancelled', 'system');
        expect(result.valid).toBe(true);
      });

      it('should allow system to trigger releasing (DB layer transient status)', () => {
        // Note: 'releasing' is transient and collapses to 'completed' in minimal API
        const result = validateTransition('payment_confirmed', 'releasing', 'system');
        expect(result.valid).toBe(true);
      });
    });

    // Invalid transitions
    describe('Invalid transitions', () => {
      it('should reject same-status transition', () => {
        // Note: 'pending' is 'open' in minimal API
        const result = validateTransition('pending', 'pending', 'user');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('already in');
      });

      it('should reject transition from terminal status (completed)', () => {
        const result = validateTransition('completed', 'cancelled', 'system');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('terminal');
      });

      it('should reject transition from terminal status (cancelled)', () => {
        const result = validateTransition('cancelled', 'pending', 'system');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('terminal');
      });

      it('should reject transition from terminal status (expired)', () => {
        const result = validateTransition('expired', 'completed', 'system');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('terminal');
      });

      it('should reject invalid status jump (open -> completed)', () => {
        // Note: 'pending' is 'open' in minimal API
        const result = validateTransition('pending', 'completed', 'merchant');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should reject invalid status jump (accepted -> completed)', () => {
        const result = validateTransition('accepted', 'completed', 'merchant');
        expect(result.valid).toBe(false);
      });

      it('should reject backward transition (completed -> open)', () => {
        // Note: 'pending' is 'open' in minimal API
        const result = validateTransition('completed', 'pending', 'system');
        expect(result.valid).toBe(false);
      });
    });

    // Actor permission checks
    describe('Actor permission checks', () => {
      it('should reject user trying to expire open order', () => {
        // Note: 'pending' is 'open' in minimal API
        const result = validateTransition('pending', 'expired', 'user');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should reject merchant trying to expire open order', () => {
        // Note: 'pending' is 'open' in minimal API
        const result = validateTransition('pending', 'expired', 'merchant');
        expect(result.valid).toBe(false);
      });

      it('should reject user trying to resolve dispute', () => {
        const result = validateTransition('disputed', 'completed', 'user');
        expect(result.valid).toBe(false);
      });

      it('should reject merchant trying to resolve dispute', () => {
        const result = validateTransition('disputed', 'cancelled', 'merchant');
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('isTerminalStatus', () => {
    it('should return true for completed', () => {
      expect(isTerminalStatus('completed')).toBe(true);
    });

    it('should return true for cancelled', () => {
      expect(isTerminalStatus('cancelled')).toBe(true);
    });

    it('should return true for expired', () => {
      expect(isTerminalStatus('expired')).toBe(true);
    });

    it('should return false for pending', () => {
      expect(isTerminalStatus('pending')).toBe(false);
    });

    it('should return false for escrowed', () => {
      expect(isTerminalStatus('escrowed')).toBe(false);
    });

    it('should return false for disputed', () => {
      expect(isTerminalStatus('disputed')).toBe(false);
    });
  });

  describe('isActiveStatus', () => {
    it('should return true for open (pending)', () => {
      // Note: 'pending' is 'open' in minimal API
      expect(isActiveStatus('pending')).toBe(true);
    });

    it('should return true for escrowed', () => {
      expect(isActiveStatus('escrowed')).toBe(true);
    });

    it('should return true for disputed', () => {
      expect(isActiveStatus('disputed')).toBe(true);
    });

    it('should return false for completed', () => {
      expect(isActiveStatus('completed')).toBe(false);
    });

    it('should return false for cancelled', () => {
      expect(isActiveStatus('cancelled')).toBe(false);
    });

    it('should return false for expired', () => {
      expect(isActiveStatus('expired')).toBe(false);
    });
  });

  describe('shouldRestoreLiquidity', () => {
    it('should restore liquidity when cancelling from open (pending)', () => {
      // Note: 'pending' is 'open' in minimal API
      expect(shouldRestoreLiquidity('pending', 'cancelled')).toBe(true);
    });

    it('should restore liquidity when expiring from open (pending)', () => {
      // Note: 'pending' is 'open' in minimal API
      expect(shouldRestoreLiquidity('pending', 'expired')).toBe(true);
    });

    it('should restore liquidity when cancelling from accepted', () => {
      expect(shouldRestoreLiquidity('accepted', 'cancelled')).toBe(true);
    });

    it('should NOT restore liquidity when completing from escrowed', () => {
      expect(shouldRestoreLiquidity('escrowed', 'completed')).toBe(false);
    });

    it('should NOT restore liquidity when cancelling from escrowed (funds in escrow)', () => {
      expect(shouldRestoreLiquidity('escrowed', 'cancelled')).toBe(false);
    });

    it('should NOT restore liquidity on normal transitions', () => {
      expect(shouldRestoreLiquidity('pending', 'accepted')).toBe(false);
    });
  });

  describe('getTransitionEventType', () => {
    it('should return correct event type for accepted', () => {
      expect(getTransitionEventType('pending', 'accepted')).toBe('status_changed_to_accepted');
    });

    it('should return correct event type for completed', () => {
      expect(getTransitionEventType('payment_confirmed', 'completed')).toBe('status_changed_to_completed');
    });

    it('should return correct event type for disputed', () => {
      expect(getTransitionEventType('payment_sent', 'disputed')).toBe('status_changed_to_disputed');
    });
  });

  describe('getStatusTimeout', () => {
    it('should return timeout for open (pending - 15 min)', () => {
      // Note: 'pending' is 'open' in minimal API
      const timeout = getStatusTimeout('pending');
      expect(timeout).toBe(15 * 60 * 1000);
    });

    it('should return timeout for accepted (15 min)', () => {
      // Note: Global 15-min timeout applies to all non-terminal statuses
      const timeout = getStatusTimeout('accepted');
      expect(timeout).toBe(15 * 60 * 1000);
    });

    it('should return timeout for escrowed (15 min)', () => {
      // Note: Global 15-min timeout applies to all non-terminal statuses
      const timeout = getStatusTimeout('escrowed');
      expect(timeout).toBe(15 * 60 * 1000);
    });

    it('should return timeout for payment_sent (15 min)', () => {
      // Note: Global 15-min timeout applies to all non-terminal statuses
      const timeout = getStatusTimeout('payment_sent');
      expect(timeout).toBe(15 * 60 * 1000);
    });

    it('should return null for completed (no timeout)', () => {
      expect(getStatusTimeout('completed')).toBeNull();
    });
  });

  describe('Constants integrity', () => {
    it('should have all DB statuses defined (12 total)', () => {
      // DB layer maintains 12 statuses for backwards compatibility
      // Minimal API exposes 8 statuses
      expect(ORDER_STATUSES).toContain('pending'); // maps to 'open'
      expect(ORDER_STATUSES).toContain('completed');
      expect(ORDER_STATUSES).toContain('cancelled');
      expect(ORDER_STATUSES).toContain('disputed');
      expect(ORDER_STATUSES.length).toBe(12);
    });

    it('should have terminal statuses as subset of all statuses', () => {
      TERMINAL_STATUSES.forEach(status => {
        expect(ORDER_STATUSES).toContain(status);
      });
    });

    it('should have active statuses as subset of all statuses', () => {
      ACTIVE_STATUSES.forEach(status => {
        expect(ORDER_STATUSES).toContain(status);
      });
    });

    it('should have no overlap between terminal and active statuses', () => {
      const overlap = TERMINAL_STATUSES.filter(s => ACTIVE_STATUSES.includes(s));
      expect(overlap.length).toBe(0);
    });
  });
});
