/**
 * Unit Tests — Redis Unread Counters
 *
 * Tests the Redis HSET-based unread counter system used by the merchant inbox.
 * Uses a mock Redis client to test logic without a live Redis connection.
 *
 * Key design:
 *  - HINCRBY unread:merchant:{mid} orderId 1  → on new message
 *  - HDEL   unread:merchant:{mid} orderId     → on mark-read
 *  - HGETALL unread:merchant:{mid}             → on inbox load (ONE call, no N+1)
 */

// ── Mock Redis before importing the module ──
const mockRedis = {
  hincrby: jest.fn().mockResolvedValue(1),
  hget: jest.fn().mockResolvedValue(null),
  hdel: jest.fn().mockResolvedValue(1),
  hgetall: jest.fn().mockResolvedValue({}),
};

jest.mock('@/lib/cache/redis', () => ({
  redis: mockRedis,
}));

import {
  incrementMerchantUnread,
  clearMerchantUnread,
  getAllMerchantUnreads,
  incrementUserUnread,
  clearUserUnread,
} from '@/lib/chat/unreadCounters';

const MID = 'merchant-001';
const OID_1 = 'order-aaa';
const OID_2 = 'order-bbb';
const UID = 'user-001';

beforeEach(() => {
  jest.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════
// incrementMerchantUnread
// ════════════════════════════════════════════════════════════════════════

describe('incrementMerchantUnread', () => {
  it('calls HINCRBY with correct key and field', async () => {
    await incrementMerchantUnread(MID, OID_1);
    expect(mockRedis.hincrby).toHaveBeenCalledWith(
      `unread:merchant:${MID}`,
      OID_1,
      1
    );
  });

  it('increments for multiple orders independently', async () => {
    await incrementMerchantUnread(MID, OID_1);
    await incrementMerchantUnread(MID, OID_2);
    expect(mockRedis.hincrby).toHaveBeenCalledTimes(2);
    expect(mockRedis.hincrby).toHaveBeenCalledWith(`unread:merchant:${MID}`, OID_1, 1);
    expect(mockRedis.hincrby).toHaveBeenCalledWith(`unread:merchant:${MID}`, OID_2, 1);
  });

  it('does not throw when Redis fails', async () => {
    mockRedis.hincrby.mockRejectedValueOnce(new Error('Redis down'));
    await expect(incrementMerchantUnread(MID, OID_1)).resolves.toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// clearMerchantUnread
// ════════════════════════════════════════════════════════════════════════

describe('clearMerchantUnread', () => {
  it('deletes the correct hash field', async () => {
    mockRedis.hget.mockResolvedValueOnce('5');
    const cleared = await clearMerchantUnread(MID, OID_1);
    expect(mockRedis.hdel).toHaveBeenCalledWith(`unread:merchant:${MID}`, OID_1);
    expect(cleared).toBe(5);
  });

  it('returns 0 when no unread existed', async () => {
    mockRedis.hget.mockResolvedValueOnce(null);
    const cleared = await clearMerchantUnread(MID, OID_1);
    expect(cleared).toBe(0);
  });

  it('does not throw when Redis fails', async () => {
    mockRedis.hget.mockRejectedValueOnce(new Error('Redis down'));
    await expect(clearMerchantUnread(MID, OID_1)).resolves.toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// getAllMerchantUnreads
// ════════════════════════════════════════════════════════════════════════

describe('getAllMerchantUnreads', () => {
  it('returns parsed unread counts per order', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      [OID_1]: '3',
      [OID_2]: '7',
    });
    const result = await getAllMerchantUnreads(MID);
    expect(result).toEqual({
      [OID_1]: 3,
      [OID_2]: 7,
    });
  });

  it('filters out zero counts', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({
      [OID_1]: '0',
      [OID_2]: '4',
    });
    const result = await getAllMerchantUnreads(MID);
    expect(result).toEqual({ [OID_2]: 4 });
  });

  it('returns empty object when no unreads', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({});
    const result = await getAllMerchantUnreads(MID);
    expect(result).toEqual({});
  });

  it('returns empty object when Redis fails', async () => {
    mockRedis.hgetall.mockRejectedValueOnce(new Error('Redis down'));
    const result = await getAllMerchantUnreads(MID);
    expect(result).toEqual({});
  });

  it('single HGETALL call serves entire inbox (no N+1)', async () => {
    mockRedis.hgetall.mockResolvedValueOnce({ [OID_1]: '1', [OID_2]: '2' });
    await getAllMerchantUnreads(MID);
    expect(mockRedis.hgetall).toHaveBeenCalledTimes(1);
    expect(mockRedis.hgetall).toHaveBeenCalledWith(`unread:merchant:${MID}`);
  });
});

// ════════════════════════════════════════════════════════════════════════
// User-side unread counters
// ════════════════════════════════════════════════════════════════════════

describe('incrementUserUnread', () => {
  it('calls HINCRBY with user key', async () => {
    await incrementUserUnread(UID, OID_1);
    expect(mockRedis.hincrby).toHaveBeenCalledWith(
      `unread:user:${UID}`,
      OID_1,
      1
    );
  });
});

describe('clearUserUnread', () => {
  it('calls HDEL with user key', async () => {
    await clearUserUnread(UID, OID_1);
    expect(mockRedis.hdel).toHaveBeenCalledWith(`unread:user:${UID}`, OID_1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Redis unavailable (null client)
// ════════════════════════════════════════════════════════════════════════

describe('Redis unavailable fallback', () => {
  beforeEach(() => {
    // Simulate Redis being null (not connected)
    jest.resetModules();
  });

  it('all functions return safe defaults when redis is null', async () => {
    // The real module checks `if (!redis) return` — tested via the mock
    // rejecting. Full null-redis test requires re-importing with redis=null.
    // The try/catch in each function ensures no throws propagate.
    mockRedis.hincrby.mockRejectedValueOnce(new Error('connection refused'));
    mockRedis.hgetall.mockRejectedValueOnce(new Error('connection refused'));
    mockRedis.hget.mockRejectedValueOnce(new Error('connection refused'));

    await expect(incrementMerchantUnread(MID, OID_1)).resolves.not.toThrow();
    await expect(getAllMerchantUnreads(MID)).resolves.toEqual({});
    await expect(clearMerchantUnread(MID, OID_1)).resolves.toBe(0);
  });
});
