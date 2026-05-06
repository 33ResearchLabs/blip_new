/**
 * WebSocket connection-ticket store.
 *
 * Why this exists:
 *   The previous WS auth scheme accepted long-lived session tokens via either
 *   the URL query string (logged by every reverse proxy) or the
 *   Sec-WebSocket-Protocol subprotocol (less leaky but still long-lived).
 *   A leaked token gave the attacker the same lifetime as a normal login.
 *
 * What this is:
 *   A tiny store of opaque, single-use, short-lived tickets. The HTTP route
 *   POST /api/ws/ticket authenticates the caller via the existing httpOnly
 *   cookie, mints a ticket, and returns it once. The browser passes the
 *   ticket to `new WebSocket(url, ['bearer', ticket])`. The WS server
 *   atomically consumes the ticket on upgrade — replay is impossible.
 *
 * Storage:
 *   - Primary: Redis (via ioredis, GETDEL for atomic single-use). Required
 *     for multi-process / multi-host deployments — without Redis, a ticket
 *     minted on instance A is invisible to instance B.
 *   - Fallback: in-memory Map, kept on globalThis so HMR / dual-import
 *     (Next route + server.js) share one map within a single process.
 *
 * Format & lifetime:
 *   - 32 bytes of crypto-random as hex (256 bits — collision-free at scale).
 *   - 45-second TTL (long enough for slow handshakes on poor connections,
 *     short enough that an exfiltrated ticket is almost always already
 *     expired by the time it's used). Tunable via WS_TICKET_TTL_SECONDS.
 *
 * This file is intentionally CommonJS (.js) so the WebSocket server
 * (websocket-server.js, plain Node) can `require()` it without a transpile
 * step. The Next.js TypeScript route imports it via standard ESM interop.
 */

'use strict';

const crypto = require('crypto');

const TTL_SECONDS = Math.max(
  15,
  Math.min(120, parseInt(process.env.WS_TICKET_TTL_SECONDS || '45', 10) || 45),
);
const REDIS_KEY_PREFIX = 'ws:ticket:';

// ── In-memory fallback (single-process correctness only) ───────────────
// Stash on globalThis so:
//   1. dev HMR doesn't double-register the map (would silently lose tickets)
//   2. websocket-server.js and the Next.js API route — which run in the
//      same Node process via server.js — see the SAME map even though they
//      reach this module through different require paths.
const globalRef = globalThis;
if (!globalRef.__blipWsTicketMap) {
  globalRef.__blipWsTicketMap = new Map();
}
/** @type {Map<string, { actorId: string, actorType: string, expiresAt: number }>} */
const memoryMap = globalRef.__blipWsTicketMap;

// Lazy single sweeper — drops expired entries. Cheap; tickets are tiny and
// numerous only during traffic spikes.
if (!globalRef.__blipWsTicketSweeper) {
  globalRef.__blipWsTicketSweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memoryMap.entries()) {
      if (v.expiresAt <= now) memoryMap.delete(k);
    }
  }, 30_000);
  // Don't keep the process alive solely for this sweeper.
  if (typeof globalRef.__blipWsTicketSweeper.unref === 'function') {
    globalRef.__blipWsTicketSweeper.unref();
  }
}

// ── Redis (lazy, optional) ─────────────────────────────────────────────
let redisClient = null;
let redisLoadAttempted = false;

function getRedis() {
  if (redisLoadAttempted) return redisClient;
  redisLoadAttempted = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Redis } = require('ioredis');
    // Reuse a singleton across HMR / dual import — same pattern as
    // src/lib/cache/redis.ts. We do NOT reuse THAT module's client because
    // it's a TS ESM module that this CJS file can't import cleanly from
    // websocket-server.js without round-tripping through the build output.
    if (globalRef.__blipWsTicketRedis) {
      redisClient = globalRef.__blipWsTicketRedis;
      return redisClient;
    }
    const c = new Redis(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      connectTimeout: 3000,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 1000);
      },
    });
    c.on('error', (err) => {
      // Warn, never throw — ticket store falls back to in-memory cleanly.
      console.warn('[wsTicket] Redis error:', err && err.message ? err.message : err);
    });
    c.connect().catch((err) => {
      console.warn('[wsTicket] Redis initial connect failed (in-memory fallback active):', err.message);
    });
    globalRef.__blipWsTicketRedis = c;
    redisClient = c;
    return redisClient;
  } catch (err) {
    console.warn('[wsTicket] ioredis unavailable, using in-memory ticket store:', err && err.message ? err.message : err);
    return null;
  }
}

function isRedisReady() {
  const c = getRedis();
  return !!(c && c.status === 'ready');
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Mint a single-use, short-lived ticket bound to (actorId, actorType).
 * Caller MUST have already authenticated the actor.
 *
 * @param {{ actorId: string, actorType: 'user'|'merchant'|'compliance' }} payload
 * @returns {Promise<{ ticket: string, expiresInSeconds: number }>}
 */
async function createTicket(payload) {
  if (!payload || !payload.actorId || !payload.actorType) {
    throw new Error('createTicket: actorId and actorType are required');
  }
  if (!['user', 'merchant', 'compliance'].includes(payload.actorType)) {
    throw new Error(`createTicket: invalid actorType ${payload.actorType}`);
  }

  const ticket = crypto.randomBytes(32).toString('hex');
  const value = {
    actorId: String(payload.actorId),
    actorType: payload.actorType,
    expiresAt: Date.now() + TTL_SECONDS * 1000,
  };

  if (isRedisReady()) {
    try {
      await redisClient.set(
        REDIS_KEY_PREFIX + ticket,
        JSON.stringify(value),
        'EX',
        TTL_SECONDS,
      );
      return { ticket, expiresInSeconds: TTL_SECONDS };
    } catch (err) {
      // Fall through to in-memory — never block ticket issuance on a
      // transient Redis hiccup. Single-process correctness is preserved.
      console.warn('[wsTicket] Redis SET failed, using in-memory:', err && err.message ? err.message : err);
    }
  }

  memoryMap.set(ticket, value);
  return { ticket, expiresInSeconds: TTL_SECONDS };
}

/**
 * Atomically consume a ticket. Returns the bound payload exactly once;
 * every subsequent call with the same ticket returns null. Returns null
 * for unknown, expired, or already-consumed tickets.
 *
 * @param {string} ticket
 * @returns {Promise<{ actorId: string, actorType: 'user'|'merchant'|'compliance' } | null>}
 */
async function consumeTicket(ticket) {
  if (!ticket || typeof ticket !== 'string') return null;
  // Defence against accidental log-leakage of header bytes — reject anything
  // that doesn't look like our hex ticket. Cheaper than a Redis call too.
  if (!/^[a-f0-9]{64}$/.test(ticket)) return null;

  if (isRedisReady()) {
    try {
      // GETDEL is atomic in Redis 6.2+. ioredis exposes it as `getdel`.
      // If the server is older, ioredis throws "ERR unknown command" and
      // we drop to the GET+DEL pipeline below.
      const raw = await redisClient.getdel(REDIS_KEY_PREFIX + ticket);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.expiresAt <= Date.now()) return null;
      return { actorId: parsed.actorId, actorType: parsed.actorType };
    } catch (err) {
      // Fallback: pipelined GET + DEL. The DEL count tells us whether WE
      // were the one to consume the ticket — if 0, another worker beat us.
      try {
        const key = REDIS_KEY_PREFIX + ticket;
        const pipe = redisClient.multi();
        pipe.get(key);
        pipe.del(key);
        const results = await pipe.exec();
        // results: [[null, raw], [null, delCount]]
        const raw = results && results[0] && results[0][1];
        const delCount = results && results[1] && results[1][1];
        if (!raw || delCount !== 1) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.expiresAt <= Date.now()) return null;
        return { actorId: parsed.actorId, actorType: parsed.actorType };
      } catch (innerErr) {
        console.warn('[wsTicket] Redis consume failed, trying in-memory:', innerErr && innerErr.message ? innerErr.message : innerErr);
        // fall through to in-memory
      }
    }
  }

  // In-memory: Map.delete() is atomic within a single Node process. The
  // first caller to delete the entry "wins"; everyone else sees `false`.
  const entry = memoryMap.get(ticket);
  if (!entry) return null;
  const won = memoryMap.delete(ticket);
  if (!won) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return { actorId: entry.actorId, actorType: entry.actorType };
}

module.exports = {
  createTicket,
  consumeTicket,
  TTL_SECONDS,
};
