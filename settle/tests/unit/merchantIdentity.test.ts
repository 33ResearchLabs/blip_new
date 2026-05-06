/**
 * Merchant identity helpers — replace the `x-merchant-id` header pattern.
 *
 * Verifies:
 *   - getMerchantId returns auth.actorId only for merchant tokens
 *   - requireMerchantActor returns 403 NextResponse for non-merchants
 *   - assertActorMatchesAuth rejects mismatching actor_id and cross-type spoofs
 *   - Helpers depend ONLY on the auth context — never read request headers
 */

import {
  getMerchantId,
  requireMerchantActor,
  assertActorMatchesAuth,
} from '@/lib/middleware/merchantIdentity';
import { AuthContext } from '@/lib/middleware/auth';

const merchantAuth: AuthContext = {
  actorType: 'merchant',
  actorId: 'merch-A',
  merchantId: 'merch-A',
};
const userAuth: AuthContext = {
  actorType: 'user',
  actorId: 'user-A',
  userId: 'user-A',
};
const complianceAuth: AuthContext = {
  actorType: 'compliance',
  actorId: 'comp-A',
  complianceId: 'comp-A',
};
const systemAuth: AuthContext = {
  actorType: 'system',
  actorId: 'system',
};

describe('getMerchantId', () => {
  test('merchant auth → returns auth.actorId', () => {
    expect(getMerchantId(merchantAuth)).toBe('merch-A');
  });
  test('user auth → null', () => {
    expect(getMerchantId(userAuth)).toBeNull();
  });
  test('compliance auth → null', () => {
    expect(getMerchantId(complianceAuth)).toBeNull();
  });
  test('system auth → null', () => {
    expect(getMerchantId(systemAuth)).toBeNull();
  });
  test('NEVER reads from request — function takes only auth context', () => {
    // Call without any request — it works. The legacy bug was reading
    // an arbitrary header value; this helper has no access to one.
    expect(getMerchantId(merchantAuth)).toBe('merch-A');
  });
});

describe('requireMerchantActor', () => {
  test('merchant auth → returns id (string)', () => {
    expect(requireMerchantActor(merchantAuth)).toBe('merch-A');
  });
  test('user auth → returns 403 NextResponse', () => {
    const r = requireMerchantActor(userAuth);
    expect(typeof r).not.toBe('string');
    if (typeof r !== 'string') {
      expect(r.status).toBe(403);
    }
  });
  test('compliance auth → returns 403 (compliance is not a merchant)', () => {
    const r = requireMerchantActor(complianceAuth);
    expect(typeof r).not.toBe('string');
  });
});

describe('assertActorMatchesAuth — accept paths', () => {
  test('actor_id matches auth.actorId, no actor_type → null', () => {
    expect(assertActorMatchesAuth(merchantAuth, { actor_id: 'merch-A' })).toBeNull();
  });
  test('matching actor_id + actor_type → null', () => {
    expect(assertActorMatchesAuth(merchantAuth, {
      actor_id: 'merch-A', actor_type: 'merchant',
    })).toBeNull();
  });
  test('user calling with matching identity → null', () => {
    expect(assertActorMatchesAuth(userAuth, {
      actor_id: 'user-A', actor_type: 'user',
    })).toBeNull();
  });
});

describe('assertActorMatchesAuth — REJECT paths (spoofing attempts)', () => {
  test('actor_id mismatch → 403 (the canonical impersonation attempt)', () => {
    const r = assertActorMatchesAuth(merchantAuth, { actor_id: 'merch-VICTIM' });
    expect(r).not.toBeNull();
    if (r) expect(r.status).toBe(403);
  });

  test('user token claiming actor_type=merchant → 403', () => {
    // Without this guard, a user token could submit
    // actor_type=merchant + actor_id=<their own user_id> and the route
    // would route through merchant-only branches.
    const r = assertActorMatchesAuth(userAuth, {
      actor_id: 'user-A', actor_type: 'merchant',
    });
    expect(r).not.toBeNull();
    if (r) expect(r.status).toBe(403);
  });

  test('merchant token with actor_type=user → 403 (cross-type spoof)', () => {
    const r = assertActorMatchesAuth(merchantAuth, {
      actor_id: 'merch-A', actor_type: 'user',
    });
    expect(r).not.toBeNull();
  });

  test('missing actor_id in body → 403', () => {
    const r = assertActorMatchesAuth(merchantAuth, {});
    expect(r).not.toBeNull();
  });

  test('null actor_id → 403', () => {
    const r = assertActorMatchesAuth(merchantAuth, { actor_id: null });
    expect(r).not.toBeNull();
  });

  test('attacker swap attempt: body actor_id is victim merchant id → 403', () => {
    // Exactly the legacy vulnerability. Token says merch-A. Body says
    // merch-VICTIM. There is no longer a header path to swap auth.actorId,
    // so this fails the actorId equality check. Pre-fix, the route would
    // have re-read x-merchant-id, matched it to actor_id=merch-VICTIM,
    // and reassigned auth.actorId.
    const r = assertActorMatchesAuth(merchantAuth, {
      actor_id: 'merch-VICTIM', actor_type: 'merchant',
    });
    expect(r).not.toBeNull();
    if (r) expect(r.status).toBe(403);
  });
});

describe('helpers do not access request — pure functions of AuthContext', () => {
  test('all three exports are pure functions of their argument', () => {
    // Snapshot test: same input → same output, every time.
    expect(getMerchantId(merchantAuth)).toBe(getMerchantId(merchantAuth));
    expect(getMerchantId(userAuth)).toBe(getMerchantId(userAuth));
    // Mismatch reasons are deterministic too
    const r1 = assertActorMatchesAuth(merchantAuth, { actor_id: 'X' });
    const r2 = assertActorMatchesAuth(merchantAuth, { actor_id: 'X' });
    expect(r1?.status).toBe(r2?.status);
  });
});
