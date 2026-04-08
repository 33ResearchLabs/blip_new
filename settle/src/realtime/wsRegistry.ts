/**
 * Connection registry — tracks all live WS connections per actor key.
 * Key format: `${actorType}:${actorId}` e.g. "user:123", "merchant:456".
 */
import type { WebSocket } from 'ws';
import type { ActorType } from './wsEvents';

export interface ConnectionMeta {
  actorId: string;
  actorType: ActorType;
  rooms: Set<string>;
  isAlive: boolean;
}

const connections = new Map<string, Set<WebSocket>>();
const metaByWs = new WeakMap<WebSocket, ConnectionMeta>();

export function actorKey(actorType: ActorType, actorId: string): string {
  return `${actorType}:${actorId}`;
}

export function register(ws: WebSocket, actorType: ActorType, actorId: string): ConnectionMeta {
  const key = actorKey(actorType, actorId);
  let set = connections.get(key);
  if (!set) {
    set = new Set();
    connections.set(key, set);
  }
  set.add(ws);
  const meta: ConnectionMeta = { actorId, actorType, rooms: new Set(), isAlive: true };
  metaByWs.set(ws, meta);
  return meta;
}

/** Returns true if this was the LAST connection for the actor (i.e. now offline). */
export function unregister(ws: WebSocket): { meta: ConnectionMeta | undefined; wentOffline: boolean } {
  const meta = metaByWs.get(ws);
  if (!meta) return { meta: undefined, wentOffline: false };
  const key = actorKey(meta.actorType, meta.actorId);
  const set = connections.get(key);
  if (!set) return { meta, wentOffline: false };
  set.delete(ws);
  if (set.size === 0) {
    connections.delete(key);
    return { meta, wentOffline: true };
  }
  return { meta, wentOffline: false };
}

export function getMeta(ws: WebSocket): ConnectionMeta | undefined {
  return metaByWs.get(ws);
}

export function getActorSockets(actorType: ActorType, actorId: string): Set<WebSocket> | undefined {
  return connections.get(actorKey(actorType, actorId));
}

export function isOnline(actorType: ActorType, actorId: string): boolean {
  const set = connections.get(actorKey(actorType, actorId));
  return !!set && set.size > 0;
}

export function allConnections(): IterableIterator<[string, Set<WebSocket>]> {
  return connections.entries();
}

export function totalConnectionCount(): number {
  let n = 0;
  for (const s of connections.values()) n += s.size;
  return n;
}
