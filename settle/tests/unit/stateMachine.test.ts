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
} from '../../src/lib/orders/stateMachine';

describe('Order State Machine', () => {
  describe('validateTransition', () => {
    // Valid transitions - User
    describe('User transitions', () => {
      it('should allow user to cancel pending order', () => {
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

      it('should NOT allow user to confirm payment', () => {
        const result = validateTransition('payment_sent', 'payment_confirmed', 'user');
        expect(result.valid).toBe(false);
      });
    });

    // Valid transitions - Merchant
    describe('Merchant transitions', () => {
      it('should allow merchant to accept pending order', () => {
        const result = validateTransition('pending', 'accepted', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to confirm payment', () => {
        const result = validateTransition('payment_sent', 'payment_confirmed', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to complete order after confirmation', () => {
        const result = validateTransition('payment_confirmed', 'completed', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to cancel pending order', () => {
        const result = validateTransition('pending', 'cancelled', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should allow merchant to raise dispute', () => {
        const result = validateTransition('payment_sent', 'disputed', 'merchant');
        expect(result.valid).toBe(true);
      });

      it('should NOT allow merchant to mark payment sent', () => {
        const result = validateTransition('escrowed', 'payment_sent', 'merchant');
        expect(result.valid).toBe(false);
      });
    });

    // Valid transitions - System
    describe('System transitions', () => {
      it('should allow system to expire pending order', () => {
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

      it('should allow system to release escrowed funds', () => {
        const result = validateTransition('payment_confirmed', 'releasing', 'system');
        expect(result.valid).toBe(true);
      });
    });

    // Invalid transitions
    describe('Invalid transitions', () => {
      it('should reject same-status transition', () => {
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

      it('should reject invalid status jump (pending -> completed)', () => {
        const result = validateTransition('pending', 'completed', 'merchant');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should reject invalid status jump (accepted -> completed)', () => {
        const result = validateTransition('accepted', 'completed', 'merchant');
        expect(result.valid).toBe(false);
      });

      it('should reject backward transition (completed -> pending)', () => {
        const result = validateTransition('completed', 'pending', 'system');
        expect(result.valid).toBe(false);
      });
    });

    // Actor permission checks
    describe('Actor permission checks', () => {
      it('should reject user trying to expire order', () => {
        const result = validateTransition('pending', 'expired', 'user');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('not allowed');
      });

      it('should reject merchant trying to expire order', () => {
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
    it('should return true for pending', () => {
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
    it('should restore liquidity when cancelling from pending', () => {
      expect(shouldRestoreLiquidity('pending', 'cancelled')).toBe(true);
    });

    it('should restore liquidity when expiring from pending', () => {
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
    it('should return timeout for pending (15 min)', () => {
      const timeout = getStatusTimeout('pending');
      expect(timeout).toBe(15 * 60 * 1000);
    });

    it('should return timeout for accepted (30 min)', () => {
      const timeout = getStatusTimeout('accepted');
      expect(timeout).toBe(30 * 60 * 1000);
    });

    it('should return timeout for escrowed (2 hours)', () => {
      const timeout = getStatusTimeout('escrowed');
      expect(timeout).toBe(120 * 60 * 1000);
    });

    it('should return timeout for payment_sent (4 hours)', () => {
      const timeout = getStatusTimeout('payment_sent');
      expect(timeout).toBe(240 * 60 * 1000);
    });

    it('should return null for completed (no timeout)', () => {
      expect(getStatusTimeout('completed')).toBeNull();
    });
  });

  describe('Constants integrity', () => {
    it('should have all statuses defined', () => {
      expect(ORDER_STATUSES).toContain('pending');
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
