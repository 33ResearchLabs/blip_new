/**
 * Room management — group sockets by room name.
 * Supported room shapes: order:{id}, user:{id}, merchant:{id}.
 */
import type { WebSocket } from 'ws';
import { getMeta } from './wsRegistry';
import type { OutgoingEvent } from './wsEvents';

const ROOM_PATTERN = /^(order|user|merchant):[A-Za-z0-9_-]+$/;

const rooms = new Map<string, Set<WebSocket>>();

export function isValidRoom(room: string): boolean {
  return ROOM_PATTERN.test(room);
}

export function joinRoom(ws: WebSocket, room: string): boolean {
  if (!isValidRoom(room)) return false;
  const meta = getMeta(ws);
  if (!meta) return false;
  let set = rooms.get(room);
  if (!set) {
    set = new Set();
    rooms.set(room, set);
  }
  set.add(ws);
  meta.rooms.add(room);
  return true;
}

export function leaveRoom(ws: WebSocket, room: string): boolean {
  const set = rooms.get(room);
  if (!set) return false;
  set.delete(ws);
  if (set.size === 0) rooms.delete(room);
  const meta = getMeta(ws);
  meta?.rooms.delete(room);
  return true;
}

export function leaveAllRooms(ws: WebSocket): string[] {
  const meta = getMeta(ws);
  if (!meta) return [];
  const left: string[] = [];
  for (const room of meta.rooms) {
    const set = rooms.get(room);
    if (set) {
      set.delete(ws);
      if (set.size === 0) rooms.delete(room);
    }
    left.push(room);
  }
  meta.rooms.clear();
  return left;
}

export function getRoomSockets(room: string): Set<WebSocket> | undefined {
  return rooms.get(room);
}

/** Sockets sharing at least one room with `ws` (deduped, excludes self). */
export function socketsSharingRoomsWith(ws: WebSocket): Set<WebSocket> {
  const result = new Set<WebSocket>();
  const meta = getMeta(ws);
  if (!meta) return result;
  for (const room of meta.rooms) {
    const set = rooms.get(room);
    if (!set) continue;
    for (const peer of set) if (peer !== ws) result.add(peer);
  }
  return result;
}

/**
 * Broadcast an event to all sockets in `event.room`.
 * Optional `exclude` socket (e.g. originator).
 */
export function broadcastToRoom(event: OutgoingEvent, exclude?: WebSocket): number {
  if (!event.room) return 0;
  const set = rooms.get(event.room);
  if (!set) return 0;
  const payload = JSON.stringify(event);
  let n = 0;
  for (const peer of set) {
    if (peer === exclude) continue;
    if (peer.readyState === peer.OPEN) {
      peer.send(payload);
      n++;
    }
  }
  return n;
}
