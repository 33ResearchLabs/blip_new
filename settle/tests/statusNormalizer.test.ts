/**
 * Tests for Status Normalization Layer
 */

import {
  OrderStatus,
  MinimalOrderStatus,
  normalizeStatus,
  expandStatus,
  normalizeAction,
  denormalizeStatus,
  isTransientStatus,
  validateStatusWrite,
  getCanonicalStatus,
  areStatusesEquivalent,
} from 'settlement-core';

describe('statusNormalizer', () => {
  describe('normalizeStatus', () => {
    it('should normalize pending to open', () => {
      expect(normalizeStatus('pending')).toBe('open');
    });

    it('should normalize accepted to accepted', () => {
      expect(normalizeStatus('accepted')).toBe('accepted');
    });

    it('should normalize escrow_pending to accepted', () => {
      expect(normalizeStatus('escrow_pending')).toBe('accepted');
    });

    it('should normalize escrowed to escrowed', () => {
      expect(normalizeStatus('escrowed')).toBe('escrowed');
    });

    it('should normalize payment_pending to escrowed', () => {
      expect(normalizeStatus('payment_pending')).toBe('escrowed');
    });

    it('should normalize payment_sent to payment_sent', () => {
      expect(normalizeStatus('payment_sent')).toBe('payment_sent');
    });

    it('should normalize payment_confirmed to payment_sent', () => {
      expect(normalizeStatus('payment_confirmed')).toBe('payment_sent');
    });

    it('should normalize releasing to completed', () => {
      expect(normalizeStatus('releasing')).toBe('completed');
    });

    it('should normalize completed to completed', () => {
      expect(normalizeStatus('completed')).toBe('completed');
    });

    it('should normalize cancelled to cancelled', () => {
      expect(normalizeStatus('cancelled')).toBe('cancelled');
    });

    it('should normalize disputed to disputed', () => {
      expect(normalizeStatus('disputed')).toBe('disputed');
    });

    it('should normalize expired to expired', () => {
      expect(normalizeStatus('expired')).toBe('expired');
    });
  });

  describe('expandStatus', () => {
    it('should expand open to [pending]', () => {
      expect(expandStatus('open')).toEqual(['pending']);
    });

    it('should expand accepted to [accepted, escrow_pending]', () => {
      expect(expandStatus('accepted')).toEqual(['accepted', 'escrow_pending']);
    });

    it('should expand escrowed to [escrowed, payment_pending]', () => {
      expect(expandStatus('escrowed')).toEqual(['escrowed', 'payment_pending']);
    });

    it('should expand payment_sent to [payment_sent, payment_confirmed]', () => {
      expect(expandStatus('payment_sent')).toEqual(['payment_sent', 'payment_confirmed']);
    });

    it('should expand completed to [completed, releasing]', () => {
      expect(expandStatus('completed')).toEqual(['completed', 'releasing']);
    });

    it('should expand cancelled to [cancelled]', () => {
      expect(expandStatus('cancelled')).toEqual(['cancelled']);
    });

    it('should expand disputed to [disputed]', () => {
      expect(expandStatus('disputed')).toEqual(['disputed']);
    });

    it('should expand expired to [expired]', () => {
      expect(expandStatus('expired')).toEqual(['expired']);
    });
  });

  describe('normalizeAction', () => {
    it('should normalize accept action to accepted', () => {
      expect(normalizeAction('accept')).toBe('accepted');
    });

    it('should normalize lock_escrow action to escrowed', () => {
      expect(normalizeAction('lock_escrow')).toBe('escrowed');
    });

    it('should normalize mark_paid action to payment_sent', () => {
      expect(normalizeAction('mark_paid')).toBe('payment_sent');
    });

    it('should normalize confirm_and_release action to completed', () => {
      expect(normalizeAction('confirm_and_release')).toBe('completed');
    });

    it('should normalize cancel action to cancelled', () => {
      expect(normalizeAction('cancel')).toBe('cancelled');
    });

    it('should normalize dispute action to disputed', () => {
      expect(normalizeAction('dispute')).toBe('disputed');
    });

    it('should return null for unknown action', () => {
      expect(normalizeAction('unknown_action')).toBeNull();
    });
  });

  describe('denormalizeStatus', () => {
    it('should denormalize open to pending', () => {
      expect(denormalizeStatus('open')).toBe('pending');
    });

    it('should denormalize accepted to accepted', () => {
      expect(denormalizeStatus('accepted')).toBe('accepted');
    });

    it('should denormalize escrowed to escrowed', () => {
      expect(denormalizeStatus('escrowed')).toBe('escrowed');
    });

    it('should denormalize payment_sent to payment_sent', () => {
      expect(denormalizeStatus('payment_sent')).toBe('payment_sent');
    });

    it('should denormalize completed to completed', () => {
      expect(denormalizeStatus('completed')).toBe('completed');
    });

    it('should denormalize cancelled to cancelled', () => {
      expect(denormalizeStatus('cancelled')).toBe('cancelled');
    });

    it('should denormalize disputed to disputed', () => {
      expect(denormalizeStatus('disputed')).toBe('disputed');
    });

    it('should denormalize expired to expired', () => {
      expect(denormalizeStatus('expired')).toBe('expired');
    });
  });

  describe('isTransientStatus', () => {
    it('should identify escrow_pending as transient', () => {
      expect(isTransientStatus('escrow_pending')).toBe(true);
    });

    it('should identify payment_pending as transient', () => {
      expect(isTransientStatus('payment_pending')).toBe(true);
    });

    it('should identify payment_confirmed as transient', () => {
      expect(isTransientStatus('payment_confirmed')).toBe(true);
    });

    it('should identify releasing as transient', () => {
      expect(isTransientStatus('releasing')).toBe(true);
    });

    it('should identify pending as non-transient', () => {
      expect(isTransientStatus('pending')).toBe(false);
    });

    it('should identify accepted as non-transient', () => {
      expect(isTransientStatus('accepted')).toBe(false);
    });

    it('should identify escrowed as non-transient', () => {
      expect(isTransientStatus('escrowed')).toBe(false);
    });

    it('should identify completed as non-transient', () => {
      expect(isTransientStatus('completed')).toBe(false);
    });
  });

  describe('validateStatusWrite', () => {
    it('should throw error for escrow_pending', () => {
      expect(() => validateStatusWrite('escrow_pending')).toThrow(
        "Cannot write transient status 'escrow_pending'. Use minimal status instead: accepted"
      );
    });

    it('should throw error for payment_pending', () => {
      expect(() => validateStatusWrite('payment_pending')).toThrow(
        "Cannot write transient status 'payment_pending'. Use minimal status instead: escrowed"
      );
    });

    it('should throw error for payment_confirmed', () => {
      expect(() => validateStatusWrite('payment_confirmed')).toThrow(
        "Cannot write transient status 'payment_confirmed'. Use minimal status instead: payment_sent"
      );
    });

    it('should throw error for releasing', () => {
      expect(() => validateStatusWrite('releasing')).toThrow(
        "Cannot write transient status 'releasing'. Use minimal status instead: completed"
      );
    });

    it('should not throw for pending', () => {
      expect(() => validateStatusWrite('pending')).not.toThrow();
    });

    it('should not throw for accepted', () => {
      expect(() => validateStatusWrite('accepted')).not.toThrow();
    });

    it('should not throw for escrowed', () => {
      expect(() => validateStatusWrite('escrowed')).not.toThrow();
    });

    it('should not throw for completed', () => {
      expect(() => validateStatusWrite('completed')).not.toThrow();
    });
  });

  describe('getCanonicalStatus', () => {
    it('should get canonical status for open', () => {
      expect(getCanonicalStatus('open')).toBe('pending');
    });

    it('should get canonical status for accepted', () => {
      expect(getCanonicalStatus('accepted')).toBe('accepted');
    });

    it('should get canonical status for escrowed', () => {
      expect(getCanonicalStatus('escrowed')).toBe('escrowed');
    });

    it('should get canonical status for payment_sent', () => {
      expect(getCanonicalStatus('payment_sent')).toBe('payment_sent');
    });

    it('should get canonical status for completed', () => {
      expect(getCanonicalStatus('completed')).toBe('completed');
    });
  });

  describe('areStatusesEquivalent', () => {
    it('should identify pending and open as equivalent', () => {
      expect(areStatusesEquivalent('pending', 'pending')).toBe(true);
    });

    it('should identify accepted and escrow_pending as equivalent', () => {
      expect(areStatusesEquivalent('accepted', 'escrow_pending')).toBe(true);
    });

    it('should identify escrowed and payment_pending as equivalent', () => {
      expect(areStatusesEquivalent('escrowed', 'payment_pending')).toBe(true);
    });

    it('should identify payment_sent and payment_confirmed as equivalent', () => {
      expect(areStatusesEquivalent('payment_sent', 'payment_confirmed')).toBe(true);
    });

    it('should identify completed and releasing as equivalent', () => {
      expect(areStatusesEquivalent('completed', 'releasing')).toBe(true);
    });

    it('should identify pending and completed as not equivalent', () => {
      expect(areStatusesEquivalent('pending', 'completed')).toBe(false);
    });

    it('should identify accepted and escrowed as not equivalent', () => {
      expect(areStatusesEquivalent('accepted', 'escrowed')).toBe(false);
    });
  });

  describe('roundtrip normalization', () => {
    it('should maintain consistency for pending', () => {
      const normalized = normalizeStatus('pending');
      const denormalized = denormalizeStatus(normalized);
      expect(denormalized).toBe('pending');
    });

    it('should maintain consistency for accepted', () => {
      const normalized = normalizeStatus('accepted');
      const denormalized = denormalizeStatus(normalized);
      expect(denormalized).toBe('accepted');
    });

    it('should collapse escrow_pending to accepted on roundtrip', () => {
      const normalized = normalizeStatus('escrow_pending');
      expect(normalized).toBe('accepted');
      const denormalized = denormalizeStatus(normalized);
      expect(denormalized).toBe('accepted');
    });

    it('should collapse payment_pending to escrowed on roundtrip', () => {
      const normalized = normalizeStatus('payment_pending');
      expect(normalized).toBe('escrowed');
      const denormalized = denormalizeStatus(normalized);
      expect(denormalized).toBe('escrowed');
    });

    it('should collapse payment_confirmed to payment_sent on roundtrip', () => {
      const normalized = normalizeStatus('payment_confirmed');
      expect(normalized).toBe('payment_sent');
      const denormalized = denormalizeStatus(normalized);
      expect(denormalized).toBe('payment_sent');
    });

    it('should collapse releasing to completed on roundtrip', () => {
      const normalized = normalizeStatus('releasing');
      expect(normalized).toBe('completed');
      const denormalized = denormalizeStatus(normalized);
      expect(denormalized).toBe('completed');
    });
  });
});
