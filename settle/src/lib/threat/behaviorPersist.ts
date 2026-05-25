// Server-side validation + persistence for behavioural telemetry captured
// during the signup form session. All functions are fire-and-forget safe —
// they swallow errors so a failed write can never break a signup.

import { query } from '@/lib/db';
import type { ActorType } from './types';

export interface BehaviorPayload {
  fill_time_ms: number;
  mouse_entropy: number;
  keystroke_cadence_stddev: number;
  copy_paste_events: string[];   // field names only, no content
  tab_switches: number;
  scroll_events: number;
}

const MAX_COPY_PASTE_FIELDS = 20;
const VALID_FIELD_NAME = /^[a-zA-Z0-9_-]{1,40}$/;

/**
 * Validate and normalise a payload submitted from a client. Returns null
 * for anything that doesn't look like a telemetry payload — we never let
 * unvalidated client data into the DB.
 */
export function validateBehaviorPayload(input: unknown): BehaviorPayload | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const fillTime = asFiniteInt(raw.fill_time_ms, 0, 60 * 60 * 1000);  // max 1h
  const mouseEntropy = asFiniteNumber(raw.mouse_entropy, 0, 16);
  const keystrokeStdDev = asFiniteNumber(raw.keystroke_cadence_stddev, 0, 60_000);
  const tabSwitches = asFiniteInt(raw.tab_switches, 0, 10_000);
  const scrollEvents = asFiniteInt(raw.scroll_events, 0, 10_000);

  if (fillTime === null && mouseEntropy === null
      && keystrokeStdDev === null && tabSwitches === null && scrollEvents === null) {
    // Entire payload is junk — reject.
    return null;
  }

  // copy_paste_events must be array of short safe strings.
  let copyPasteEvents: string[] = [];
  if (Array.isArray(raw.copy_paste_events)) {
    const filtered = (raw.copy_paste_events as unknown[])
      .filter((v): v is string => typeof v === 'string' && VALID_FIELD_NAME.test(v));
    copyPasteEvents = Array.from(new Set(filtered)).slice(0, MAX_COPY_PASTE_FIELDS);
  }

  return {
    fill_time_ms: fillTime ?? 0,
    mouse_entropy: mouseEntropy ?? 0,
    keystroke_cadence_stddev: keystrokeStdDev ?? 0,
    copy_paste_events: copyPasteEvents,
    tab_switches: tabSwitches ?? 0,
    scroll_events: scrollEvents ?? 0,
  };
}

function asFiniteNumber(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

function asFiniteInt(v: unknown, min: number, max: number): number | null {
  const n = asFiniteNumber(v, min, max);
  return n === null ? null : Math.round(n);
}

/**
 * Insert one telemetry row. Errors swallowed — callers can fire and forget.
 */
export async function saveBehavior(
  actorType: ActorType,
  actorId: string,
  payload: BehaviorPayload,
): Promise<void> {
  try {
    await query(
      `INSERT INTO signup_behavior
         (actor_id, actor_type, fill_time_ms, mouse_entropy,
          keystroke_cadence_stddev, copy_paste_events, tab_switches, scroll_events)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        actorId, actorType,
        payload.fill_time_ms, payload.mouse_entropy,
        payload.keystroke_cadence_stddev,
        JSON.stringify(payload.copy_paste_events),
        payload.tab_switches, payload.scroll_events,
      ],
    );
  } catch (err) {
    console.error('[threat/behaviorPersist] saveBehavior failed', { actorType, actorId, err });
  }
}

/** Fire-and-forget. */
export function persistBehaviorAsync(
  actorType: ActorType,
  actorId: string,
  payload: BehaviorPayload,
): void {
  saveBehavior(actorType, actorId, payload).catch(err => {
    console.error('[threat/behaviorPersist] async persist failed', err);
  });
}
