/**
 * WS Version Gating Tests
 *
 * Verifies that shouldAcceptUpdate() correctly gates stale order updates.
 * This is the mechanism that prevents out-of-order WebSocket events
 * from overwriting newer data in the UI.
 */
import { shouldAcceptUpdate, isNewerVersion } from '../../src/lib/orders/statusResolver';

describe('WS Version Gating', () => {
  describe('shouldAcceptUpdate', () => {
    it('rejects incoming version < current version (stale update)', () => {
      const result = shouldAcceptUpdate(2, 3);
      expect(result.accept).toBe(false);
      expect(result.reason).toContain('Stale');
    });

    it('accepts incoming version > current version (newer update)', () => {
      const result = shouldAcceptUpdate(4, 3);
      expect(result.accept).toBe(true);
      expect(result.reason).toContain('newer');
    });

    it('accepts same version (idempotent update)', () => {
      const result = shouldAcceptUpdate(3, 3);
      expect(result.accept).toBe(true);
      expect(result.reason).toContain('idempotent');
    });

    it('accepts when incoming version is undefined (no version info)', () => {
      const result = shouldAcceptUpdate(undefined, 3);
      expect(result.accept).toBe(true);
    });

    it('accepts when current version is undefined', () => {
      const result = shouldAcceptUpdate(5, undefined);
      expect(result.accept).toBe(true);
    });

    it('accepts when both versions are undefined', () => {
      const result = shouldAcceptUpdate(undefined, undefined);
      expect(result.accept).toBe(true);
    });

    it('accepts version 1 == 1 as idempotent (first update)', () => {
      const result = shouldAcceptUpdate(1, 1);
      expect(result.accept).toBe(true);
      expect(result.reason).toContain('idempotent');
    });

    it('accepts large version gap (100 > 1)', () => {
      const result = shouldAcceptUpdate(100, 1);
      expect(result.accept).toBe(true);
    });

    it('rejects version 1 when current is 5 (very stale)', () => {
      const result = shouldAcceptUpdate(1, 5);
      expect(result.accept).toBe(false);
    });
  });

  describe('isNewerVersion', () => {
    it('returns true when incoming > current', () => {
      expect(isNewerVersion(5, 3)).toBe(true);
    });

    it('returns false when incoming < current', () => {
      expect(isNewerVersion(3, 5)).toBe(false);
    });

    it('returns false when incoming === current', () => {
      expect(isNewerVersion(3, 3)).toBe(false);
    });

    it('returns true when incoming is undefined (assume newer)', () => {
      expect(isNewerVersion(undefined, 3)).toBe(true);
    });

    it('returns true when current is undefined (assume newer)', () => {
      expect(isNewerVersion(5, undefined)).toBe(true);
    });
  });
});
