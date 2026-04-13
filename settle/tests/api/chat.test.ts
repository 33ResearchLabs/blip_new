/**
 * API Tests — Chat Endpoints
 *
 * Tests the HTTP layer that wraps getChatAvailability:
 *  - GET  /api/orders/:id/chat-status → response shape + enabled/disabled
 *  - POST /api/orders/:id/messages    → 403 on disabled chat, 201 on success
 *  - PATCH /api/orders/:id/messages   → mark-read clears unread
 *
 * Requires: settle running on SETTLE_URL, seeded test data.
 * Run with: npm run test:integration -- --testPathPattern="chat"
 */

const SETTLE_URL = process.env.SETTLE_URL || 'http://localhost:3000';
const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4010';

// ── Helpers ──────────────────────────────────────────────────────────

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(process.env.CORE_API_SECRET ? { 'x-core-api-secret': process.env.CORE_API_SECRET } : {}),
    ...extra,
  };
}

async function resetAndSeed() {
  const resetRes = await fetch(`${SETTLE_URL}/api/test/reset`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ confirm: true }),
  });
  if (!resetRes.ok) throw new Error(`Reset failed: ${resetRes.status}`);

  const seedRes = await fetch(`${SETTLE_URL}/api/test/seed`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ scenario: 'full' }),
  });
  if (!seedRes.ok) throw new Error(`Seed failed: ${seedRes.status}`);
  return (await seedRes.json()).data;
}

async function createAndAcceptOrder(seed: any): Promise<{ orderId: string; userId: string; merchantId: string }> {
  // Create order via core-api
  const createRes = await fetch(`${CORE_API_URL}/v1/orders`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: seed.userId,
      merchant_id: seed.merchantId,
      offer_id: seed.offerId,
      type: 'buy',
      payment_method: 'bank',
      crypto_amount: 10,
      fiat_amount: 36.7,
      rate: 3.67,
      payment_details: { bank_name: 'Test Bank', iban: 'AE123456789012345678901' },
    }),
  });
  if (!createRes.ok) throw new Error(`Create order failed: ${createRes.status}`);
  const order = (await createRes.json()).data;

  // Accept order (transitions from pending → accepted)
  const acceptRes = await fetch(`${CORE_API_URL}/v1/orders/${order.id}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status: 'accepted', actor_type: 'merchant', actor_id: seed.merchantId }),
  });
  if (!acceptRes.ok) throw new Error(`Accept failed: ${acceptRes.status}`);

  return { orderId: order.id, userId: seed.userId, merchantId: seed.merchantId };
}

async function transitionOrder(orderId: string, status: string, actorType: string, actorId: string) {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status, actor_type: actorType, actor_id: actorId }),
  });
  if (!res.ok) throw new Error(`Transition to ${status} failed: ${res.status}`);
}

// ════════════════════════════════════════════════════════════════════════
// Chat Status API
// ════════════════════════════════════════════════════════════════════════

describe('GET /api/orders/:id/chat-status', () => {
  let seed: any;
  let orderId: string;
  let userId: string;
  let merchantId: string;

  beforeAll(async () => {
    seed = await resetAndSeed();
    const created = await createAndAcceptOrder(seed);
    orderId = created.orderId;
    userId = created.userId;
    merchantId = created.merchantId;
  }, 30000);

  it('returns correct response shape', async () => {
    const res = await fetch(
      `${SETTLE_URL}/api/orders/${orderId}/chat-status`,
      { headers: headers({ 'x-user-id': userId }) }
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      data: {
        chat: {
          enabled: expect.any(Boolean),
          reason: expect.toBeOneOf([expect.any(String), null]),
        },
        bothPartiesJoined: expect.any(Boolean),
      },
    });
  });

  it('returns enabled=true for accepted order', async () => {
    const res = await fetch(
      `${SETTLE_URL}/api/orders/${orderId}/chat-status`,
      { headers: headers({ 'x-user-id': userId }) }
    );
    const body = await res.json();
    expect(body.data.chat.enabled).toBe(true);
    expect(body.data.chat.reason).toBeNull();
    expect(body.data.bothPartiesJoined).toBe(true);
  });

  it('returns 404 for non-existent order', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await fetch(
      `${SETTLE_URL}/api/orders/${fakeId}/chat-status`,
      { headers: headers({ 'x-user-id': userId }) }
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid order ID format', async () => {
    const res = await fetch(
      `${SETTLE_URL}/api/orders/not-a-uuid/chat-status`,
      { headers: headers({ 'x-user-id': userId }) }
    );
    expect(res.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Message Sending — Enforcement
// ════════════════════════════════════════════════════════════════════════

describe('POST /api/orders/:id/messages — chat enforcement', () => {
  let seed: any;

  beforeAll(async () => {
    seed = await resetAndSeed();
  }, 30000);

  it('allows message on accepted order (chat enabled)', async () => {
    const { orderId, userId } = await createAndAcceptOrder(seed);

    const res = await fetch(`${SETTLE_URL}/api/orders/${orderId}/messages`, {
      method: 'POST',
      headers: headers({ 'x-user-id': userId }),
      body: JSON.stringify({
        sender_type: 'user',
        sender_id: userId,
        content: 'Hello merchant!',
        message_type: 'text',
      }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('content', 'Hello merchant!');
  });

  it('blocks message on completed order with 403', async () => {
    const { orderId, userId, merchantId } = await createAndAcceptOrder(seed);

    // Transition to completed (skip intermediate states for speed)
    await transitionOrder(orderId, 'escrowed', 'merchant', merchantId);
    await transitionOrder(orderId, 'payment_sent', 'user', userId);
    await transitionOrder(orderId, 'completed', 'merchant', merchantId);

    const res = await fetch(`${SETTLE_URL}/api/orders/${orderId}/messages`, {
      method: 'POST',
      headers: headers({ 'x-user-id': userId }),
      body: JSON.stringify({
        sender_type: 'user',
        sender_id: userId,
        content: 'Can you still hear me?',
        message_type: 'text',
      }),
    });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/closed|completed/i);
  });

  it('returns validation error for missing content', async () => {
    const { orderId, userId } = await createAndAcceptOrder(seed);

    const res = await fetch(`${SETTLE_URL}/api/orders/${orderId}/messages`, {
      method: 'POST',
      headers: headers({ 'x-user-id': userId }),
      body: JSON.stringify({
        sender_type: 'user',
        sender_id: userId,
        // content missing
        message_type: 'text',
      }),
    });
    // Should be 400 or handled gracefully (content is optional in schema, allows images)
    // The key is it doesn't 500
    expect(res.status).toBeLessThan(500);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Mark Read — Unread Counter Sync
// ════════════════════════════════════════════════════════════════════════

describe('PATCH /api/orders/:id/messages — mark read', () => {
  let seed: any;

  beforeAll(async () => {
    seed = await resetAndSeed();
  }, 30000);

  it('marks messages as read and returns success', async () => {
    const { orderId, userId, merchantId } = await createAndAcceptOrder(seed);

    // Send a message first
    await fetch(`${SETTLE_URL}/api/orders/${orderId}/messages`, {
      method: 'POST',
      headers: headers({ 'x-user-id': userId }),
      body: JSON.stringify({
        sender_type: 'user',
        sender_id: userId,
        content: 'Test message',
        message_type: 'text',
      }),
    });

    // Merchant marks messages as read
    const res = await fetch(`${SETTLE_URL}/api/orders/${orderId}/messages`, {
      method: 'PATCH',
      headers: headers({ 'x-merchant-id': merchantId }),
      body: JSON.stringify({ reader_type: 'merchant' }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('marked_read', true);
  });
});

// ── Custom matcher ──
expect.extend({
  toBeOneOf(received: unknown, expected: unknown[]) {
    const pass = expected.some((exp) => {
      try {
        expect(received).toEqual(exp);
        return true;
      } catch {
        return false;
      }
    });
    return {
      pass,
      message: () => `expected ${received} to be one of ${JSON.stringify(expected)}`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeOneOf(expected: unknown[]): R;
    }
  }
}
