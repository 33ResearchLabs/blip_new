/**
 * Redis pub/sub bus for the shadow WebSocket system.
 *
 * Architecture:
 *   outbox worker  →  publishShadowEvent()  →  Redis channel "blip:ws-shadow"
 *                                                       │
 *                                                       ▼
 *                                ┌─────────────┐  ┌─────────────┐
 *                                │ ws-shadow A │  │ ws-shadow B │   (multiple ws nodes)
 *                                │ subscriber  │  │ subscriber  │
 *                                └─────────────┘  └─────────────┘
 *                                       │                │
 *                                       ▼                ▼
 *                                  room broadcast    room broadcast
 *
 * Isolation guarantees:
 *   - Uses ITS OWN ioredis clients (pub/sub clients can't be shared with the
 *     cache client). Does NOT touch src/lib/cache/redis.ts.
 *   - If REDIS_URL is unset OR Redis is down, all functions become no-ops
 *     and log a single warning. The shadow server still works in single-node
 *     mode via direct emitEvent() calls. The main app is unaffected.
 *   - Removable with src/realtime/.
 */
import IORedis, { type Redis as RedisClient } from 'ioredis';
import { randomUUID } from 'crypto';
import { WS_SHADOW_LOG_PREFIX as TAG, type OutgoingEvent } from './wsEvents';

export const SHADOW_CHANNEL = 'blip:ws-shadow';

/**
 * Unique identifier for THIS process. Stamped onto every published event
 * as `_origin` so the subscriber can drop self-published messages and
 * prevent same-process double-delivery when the WS server and outbox
 * worker happen to share a process.
 */
export const NODE_ID = randomUUID();

interface WireEvent extends OutgoingEvent {
  _origin?: string;
}

let publisher: RedisClient | null = null;
let subscriber: RedisClient | null = null;
let publisherWarned = false;
let subscriberWarned = false;

// Bounded retry buffer: events that failed to publish during disconnects
// are queued here and flushed when the publisher next becomes ready.
const RETRY_BUFFER_MAX = 1000;
const retryBuffer: string[] = [];

function buildClient(role: 'pub' | 'sub'): RedisClient | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    if ((role === 'pub' && !publisherWarned) || (role === 'sub' && !subscriberWarned)) {
      console.warn(`${TAG} redis ${role}: REDIS_URL not set — running in single-node mode`);
      if (role === 'pub') publisherWarned = true;
      else subscriberWarned = true;
    }
    return null;
  }
  const client = new IORedis(url, {
    lazyConnect: false,
    // Publisher uses an offline queue so events sent during a brief
    // reconnect aren't lost. Subscriber doesn't need it.
    enableOfflineQueue: role === 'pub',
    maxRetriesPerRequest: role === 'pub' ? null : 1,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  client.on('error', (err) => {
    const flag = role === 'pub' ? publisherWarned : subscriberWarned;
    if (!flag) {
      console.warn(`${TAG} redis ${role} error:`, (err as Error).message);
      if (role === 'pub') publisherWarned = true;
      else subscriberWarned = true;
    }
  });
  client.on('ready', () => {
    console.log(`${TAG} redis ${role} ready`);
    if (role === 'pub') {
      publisherWarned = false;
      void flushRetryBuffer();
    } else {
      subscriberWarned = false;
    }
  });
  return client;
}

async function flushRetryBuffer(): Promise<void> {
  if (!publisher || retryBuffer.length === 0) return;
  const drained = retryBuffer.splice(0, retryBuffer.length);
  console.log(`${TAG} flushing ${drained.length} buffered events`);
  for (const payload of drained) {
    try {
      await publisher.publish(SHADOW_CHANNEL, payload);
    } catch (err) {
      // Re-buffer on failure (bounded).
      if (retryBuffer.length < RETRY_BUFFER_MAX) retryBuffer.push(payload);
      console.warn(`${TAG} flush retry failed:`, (err as Error).message);
      return;
    }
  }
}

function getPublisher(): RedisClient | null {
  if (publisher) return publisher;
  publisher = buildClient('pub');
  return publisher;
}

/**
 * Publish a shadow event to Redis. Safe to call from anywhere.
 * Returns true on enqueue success, false if Redis is unavailable.
 * NEVER throws.
 */
export async function publishShadowEvent(event: OutgoingEvent): Promise<boolean> {
  const client = getPublisher();
  if (!client) return false;
  // Stamp origin so the same process can drop its own publish if it
  // also runs the WS subscriber.
  const wire: WireEvent = { ...event, _origin: NODE_ID };
  const payload = JSON.stringify(wire);
  if (client.status !== 'ready') {
    if (retryBuffer.length < RETRY_BUFFER_MAX) {
      retryBuffer.push(payload);
    } else {
      console.warn(`${TAG} retry buffer full — dropping event`);
    }
    return false;
  }
  try {
    await client.publish(SHADOW_CHANNEL, payload);
    return true;
  } catch (err) {
    console.warn(`${TAG} publish failed:`, (err as Error).message);
    if (retryBuffer.length < RETRY_BUFFER_MAX) retryBuffer.push(payload);
    return false;
  }
}

export type ShadowEventHandler = (event: OutgoingEvent) => void;

/**
 * Subscribe to the shadow channel. Returns an unsubscribe function.
 * If Redis is unavailable, returns a no-op unsubscribe and logs once —
 * the shadow server continues to function in single-node mode.
 */
export function subscribeShadowEvents(handler: ShadowEventHandler): () => Promise<void> {
  if (subscriber) {
    console.warn(`${TAG} subscribeShadowEvents called twice — ignoring`);
    return async () => {};
  }
  const client = buildClient('sub');
  if (!client) {
    return async () => {};
  }
  subscriber = client;

  client.subscribe(SHADOW_CHANNEL, (err, count) => {
    if (err) {
      console.warn(`${TAG} subscribe failed:`, err.message);
      return;
    }
    console.log(`${TAG} subscribed to ${SHADOW_CHANNEL} (channels=${count})`);
  });

  client.on('message', (channel, message) => {
    if (channel !== SHADOW_CHANNEL) return;
    let parsed: WireEvent;
    try {
      parsed = JSON.parse(message) as WireEvent;
    } catch (err) {
      console.warn(`${TAG} invalid pubsub payload:`, (err as Error).message);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.type) return;
    // Loopback filter: drop events this process published itself.
    if (parsed._origin === NODE_ID) return;
    // Strip transport-only field before handing to broadcast layer.
    const { _origin, ...clean } = parsed;
    void _origin;
    try {
      handler(clean as OutgoingEvent);
    } catch (err) {
      console.warn(`${TAG} handler error:`, (err as Error).message);
    }
  });

  return async () => {
    try {
      await client.unsubscribe(SHADOW_CHANNEL);
    } catch {
      /* ignore */
    }
    client.disconnect();
    subscriber = null;
  };
}

/** Test/shutdown helper. */
export async function closeShadowBus(): Promise<void> {
  if (publisher) {
    publisher.disconnect();
    publisher = null;
  }
  if (subscriber) {
    subscriber.disconnect();
    subscriber = null;
  }
}
