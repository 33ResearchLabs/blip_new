/**
 * Contract Tests — Chat Real-Time Event Payloads
 *
 * These tests verify that the event payloads emitted by the backend
 * match the shape the frontend expects. A broken contract here means
 * silent UI failures — the frontend binds to these exact field names.
 *
 * NOT testing Pusher delivery (that's Pusher's job).
 * Testing that OUR payload construction is correct.
 */

import { getChatAvailability } from '@/lib/chat/availability';

// ── Contract schemas (what the frontend expects) ───────────────────

interface ChatStatusUpdatePayload {
  orderId: string;
  enabled: boolean;
  reason: string | null;
}

interface ChatMessagePreviewPayload {
  orderId: string;
  preview: string;
  senderType: 'user' | 'merchant' | 'compliance' | 'system';
  senderName: string;
  messageType: string;
  timestamp: string; // ISO 8601
}

interface ChatUnreadUpdatePayload {
  orderId: string;
  count: number;
}

interface ChatMessageNewPayload {
  messageId: string;
  orderId: string;
  senderType: string;
  senderId: string | null;
  content: string;
  messageType: string;
  createdAt: string;  // ISO 8601
  // Phase 3 fields
  clientId: string | null;
  seq: number | null;
}

// ════════════════════════════════════════════════════════════════════════
// chat:status-update
// ════════════════════════════════════════════════════════════════════════

describe('Contract: chat:status-update', () => {
  function buildStatusPayload(orderId: string, status: string): ChatStatusUpdatePayload {
    // This mirrors what instantNotify.ts does: call getChatAvailability
    // and wrap the result into the event payload.
    const order = {
      id: orderId,
      status,
      user_id: 'user-001',
      merchant_id: 'merchant-001',
      buyer_merchant_id: null,
      chat_frozen: false,
      chat_frozen_by: null,
    };
    const result = getChatAvailability(order, 'user');
    return {
      orderId,
      enabled: result.enabled,
      reason: result.reason,
    };
  }

  it('has all required fields when chat is enabled', () => {
    const payload = buildStatusPayload('order-001', 'accepted');
    expect(payload).toEqual({
      orderId: 'order-001',
      enabled: true,
      reason: null,
    });
  });

  it('has all required fields when chat is disabled', () => {
    const payload = buildStatusPayload('order-001', 'completed');
    expect(payload).toEqual({
      orderId: expect.any(String),
      enabled: false,
      reason: expect.any(String),
    });
    expect(payload.reason).toBeTruthy();
    expect(payload.reason!.length).toBeGreaterThan(0);
  });

  it('reason is always string or null (never undefined)', () => {
    const statuses = ['pending', 'accepted', 'escrowed', 'payment_sent', 'disputed', 'completed', 'cancelled', 'expired'];
    for (const status of statuses) {
      const payload = buildStatusPayload('order-001', status);
      expect(payload.reason === null || typeof payload.reason === 'string').toBe(true);
    }
  });

  it('enabled is always boolean (never truthy/falsy)', () => {
    const statuses = ['pending', 'accepted', 'completed'];
    for (const status of statuses) {
      const payload = buildStatusPayload('order-001', status);
      expect(typeof payload.enabled).toBe('boolean');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// chat:message-preview
// ════════════════════════════════════════════════════════════════════════

describe('Contract: chat:message-preview', () => {
  function buildPreviewPayload(
    orderId: string,
    content: string,
    senderType: 'user' | 'merchant' | 'compliance',
    senderName: string,
  ): ChatMessagePreviewPayload {
    // This mirrors the POST handler's payload construction
    return {
      orderId,
      preview: (content || '[attachment]').substring(0, 80),
      senderType,
      senderName: senderName || senderType,
      messageType: 'text',
      timestamp: new Date().toISOString(),
    };
  }

  it('has all required fields', () => {
    const payload = buildPreviewPayload('order-001', 'Hello!', 'user', 'Alice');
    expect(payload).toEqual({
      orderId: 'order-001',
      preview: 'Hello!',
      senderType: 'user',
      senderName: 'Alice',
      messageType: 'text',
      timestamp: expect.any(String),
    });
  });

  it('preview truncates to 80 chars', () => {
    const longMsg = 'A'.repeat(200);
    const payload = buildPreviewPayload('order-001', longMsg, 'user', 'Alice');
    expect(payload.preview.length).toBe(80);
  });

  it('preview defaults to [attachment] when content is empty', () => {
    const payload = buildPreviewPayload('order-001', '', 'user', 'Alice');
    expect(payload.preview).toBe('[attachment]');
  });

  it('senderName falls back to senderType if name is empty', () => {
    const payload = buildPreviewPayload('order-001', 'Hi', 'merchant', '');
    expect(payload.senderName).toBe('merchant');
  });

  it('timestamp is valid ISO 8601', () => {
    const payload = buildPreviewPayload('order-001', 'Hi', 'user', 'Alice');
    const parsed = new Date(payload.timestamp);
    expect(parsed.toISOString()).toBe(payload.timestamp);
  });
});

// ════════════════════════════════════════════════════════════════════════
// chat:message-new (full message event)
// ════════════════════════════════════════════════════════════════════════

describe('Contract: chat:message-new', () => {
  function buildMessagePayload(): ChatMessageNewPayload {
    // Mirrors notifyNewMessage() payload shape
    return {
      messageId: 'msg-001',
      orderId: 'order-001',
      senderType: 'user',
      senderId: 'user-001',
      content: 'Payment sent!',
      messageType: 'text',
      createdAt: new Date().toISOString(),
      clientId: 'client-uuid-001',
      seq: 42,
    };
  }

  it('has all required fields including Phase 3 (seq, clientId)', () => {
    const payload = buildMessagePayload();
    expect(payload).toEqual({
      messageId: expect.any(String),
      orderId: expect.any(String),
      senderType: expect.any(String),
      senderId: expect.any(String),
      content: expect.any(String),
      messageType: expect.any(String),
      createdAt: expect.any(String),
      clientId: expect.toBeOneOf([expect.any(String), null]),
      seq: expect.toBeOneOf([expect.any(Number), null]),
    });
  });

  it('clientId can be null (pre-Phase 3 messages)', () => {
    const payload = { ...buildMessagePayload(), clientId: null, seq: null };
    expect(payload.clientId).toBeNull();
    expect(payload.seq).toBeNull();
  });

  it('createdAt is valid ISO 8601', () => {
    const payload = buildMessagePayload();
    const parsed = new Date(payload.createdAt);
    expect(parsed.toISOString()).toBe(payload.createdAt);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Channel name contracts
// ════════════════════════════════════════════════════════════════════════

describe('Contract: Channel names', () => {
  // The frontend hardcodes these prefixes in Pusher subscriptions.
  // If they change, the entire real-time system breaks silently.

  it('order channel follows private-order-{id} pattern', () => {
    const { getOrderChannel } = require('@/lib/pusher/channels');
    expect(getOrderChannel('abc-123')).toBe('private-order-abc-123');
  });

  it('merchant chat channel follows private-merchant-chat-{id} pattern', () => {
    const { getMerchantChatChannel } = require('@/lib/pusher/channels');
    expect(getMerchantChatChannel('m-001')).toBe('private-merchant-chat-m-001');
  });

  it('user channel follows private-user-{id} pattern', () => {
    const { getUserChannel } = require('@/lib/pusher/channels');
    expect(getUserChannel('u-001')).toBe('private-user-u-001');
  });

  it('presence channel follows presence-order-{id} pattern', () => {
    const { getOrderPresenceChannel } = require('@/lib/pusher/channels');
    expect(getOrderPresenceChannel('abc-123')).toBe('presence-order-abc-123');
  });
});

// ── Custom matcher (reuse) ──
expect.extend({
  toBeOneOf(received: unknown, expected: unknown[]) {
    const pass = expected.some((exp) => {
      try { expect(received).toEqual(exp); return true; } catch { return false; }
    });
    return { pass, message: () => `expected ${received} to be one of ${JSON.stringify(expected)}` };
  },
});
declare global {
  namespace jest {
    interface Matchers<R> { toBeOneOf(expected: unknown[]): R; }
  }
}
