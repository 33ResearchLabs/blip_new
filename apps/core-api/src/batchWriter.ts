/**
 * In-memory batch writer for fire-and-forget DB operations.
 *
 * Buffers INSERT rows (order_events, notification_outbox, reputation_events)
 * and flushes them periodically as multi-row INSERTs.
 *
 * This eliminates 1 SQL round-trip per HTTP call (was 1 CTE per request).
 * At 1000 lifecycles/s × 5 steps = 5000 buffered rows → flushed as ~100 bulk INSERTs.
 */
import { query } from 'settlement-core';

// --- Event buffer ---
interface EventRow {
  order_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string;
  old_status: string;
  new_status: string;
  metadata: string;
}

// --- Notification buffer ---
interface NotifRow {
  order_id: string;
  event_type: string;
  payload: string;
}

// --- Reputation buffer ---
interface RepRow {
  entity_id: string;
  entity_type: 'merchant' | 'user';
  event_type: string;
  score_change: number;
  reason: string;
  metadata: string;
}

const eventBuf: EventRow[] = [];
const notifBuf: NotifRow[] = [];
const repBuf: RepRow[] = [];

const FLUSH_MS = 50;
const MAX_BUF = 500;

let timer: ReturnType<typeof setTimeout> | null = null;

function schedule() {
  if (!timer) {
    timer = setTimeout(flush, FLUSH_MS);
  }
}

async function flush() {
  timer = null;

  // Swap out buffers atomically
  const events = eventBuf.splice(0);
  const notifs = notifBuf.splice(0);
  const reps = repBuf.splice(0);

  // Flush events
  if (events.length > 0) {
    const vals: unknown[] = [];
    const phs: string[] = [];
    for (let i = 0; i < events.length; i++) {
      const o = i * 7;
      phs.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7})`);
      const e = events[i];
      vals.push(e.order_id, e.event_type, e.actor_type, e.actor_id, e.old_status, e.new_status, e.metadata);
    }
    query(
      `INSERT INTO order_events (order_id,event_type,actor_type,actor_id,old_status,new_status,metadata) VALUES ${phs.join(',')}`,
      vals
    ).catch(() => {});
  }

  // Flush notifications
  if (notifs.length > 0) {
    const vals: unknown[] = [];
    const phs: string[] = [];
    for (let i = 0; i < notifs.length; i++) {
      const o = i * 3;
      phs.push(`($${o+1},$${o+2},$${o+3},'pending')`);
      const n = notifs[i];
      vals.push(n.order_id, n.event_type, n.payload);
    }
    query(
      `INSERT INTO notification_outbox (order_id,event_type,payload,status) VALUES ${phs.join(',')}`,
      vals
    ).catch(() => {});
  }

  // Flush reputation
  if (reps.length > 0) {
    const vals: unknown[] = [];
    const phs: string[] = [];
    for (let i = 0; i < reps.length; i++) {
      const o = i * 6;
      phs.push(`($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6})`);
      const r = reps[i];
      vals.push(r.entity_id, r.entity_type, r.event_type, r.score_change, r.reason, r.metadata);
    }
    query(
      `INSERT INTO reputation_events (entity_id,entity_type,event_type,score_change,reason,metadata) VALUES ${phs.join(',')} ON CONFLICT DO NOTHING`,
      vals
    ).catch(() => {});
  }
}

export function bufferEvent(row: EventRow) {
  eventBuf.push(row);
  if (eventBuf.length >= MAX_BUF) flush();
  else schedule();
}

export function bufferNotification(row: NotifRow) {
  notifBuf.push(row);
  if (notifBuf.length >= MAX_BUF) flush();
  else schedule();
}

export function bufferReputation(row: RepRow) {
  repBuf.push(row);
  if (repBuf.length >= MAX_BUF) flush();
  else schedule();
}

// Flush on process exit
process.on('beforeExit', flush);
