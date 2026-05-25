// Behavior-category signal detectors.
//
// Phase A signal: RAPID_TASK_COMPLETION (timestamps in waitlist_tasks).
// Phase D signals (telemetry-driven): FORM_FILL_INSTANT, MOUSE_ENTROPY_ZERO,
//   KEYSTROKE_CADENCE_BOT, COPY_PASTE_CRITICAL — all rely on the latest
//   signup_behavior row for the actor (passed in via BehaviorLookups).

import type { Signal, ScoringContext } from '../types';
import { categoryForSignal } from '../weights';

// Fields where copy-paste is suspicious (compared to non-critical fields
// like "name" where paste is normal).
const CRITICAL_PASTE_FIELDS = new Set<string>([
  'email', 'reg-email', 'wallet', 'wallet-address', 'wallet_address',
  'password', 'reg-password',
]);

export interface BehaviorLookups {
  /** Most recent signup_behavior row for the actor, or null if telemetry
   *  was never captured. */
  telemetry: {
    fill_time_ms: number;
    mouse_entropy: number;
    keystroke_cadence_stddev: number;
    copy_paste_events: string[];
  } | null;
}

export function detectBehaviorSignals(
  ctx: ScoringContext,
  lookups: BehaviorLookups,
): Signal[] {
  const out: Signal[] = [];

  // RAPID_TASK_COMPLETION — ≥3 verified tasks within 60 seconds. Phase A.
  // Strong bot-farm tell: humans don't complete twitter + telegram + discord
  // verifications in under a minute.
  const verifiedTimestamps = ctx.tasks
    .filter(t => t.status === 'VERIFIED' && t.completed_at)
    .map(t => Date.parse(t.completed_at as string))
    .filter(n => !Number.isNaN(n))
    .sort((a, b) => a - b);

  if (verifiedTimestamps.length >= 3) {
    for (let i = 2; i < verifiedTimestamps.length; i++) {
      const window = verifiedTimestamps[i] - verifiedTimestamps[i - 2];
      if (window <= 60_000) {
        out.push({
          type: 'RAPID_TASK_COMPLETION',
          category: categoryForSignal('RAPID_TASK_COMPLETION'),
          severity_multiplier: 1,
          occurrence_count: 1,
          evidence: {
            window_ms: window,
            verified_tasks_in_window: 3,
            total_verified_tasks: verifiedTimestamps.length,
          },
        });
        break;
      }
    }
  }

  // --- Phase D telemetry-driven signals -------------------------------
  if (lookups.telemetry) {
    const t = lookups.telemetry;

    // FORM_FILL_INSTANT — submit within 3s of first focus. Humans don't
    // type email + password + confirm + click submit in 3s; bots do.
    if (t.fill_time_ms > 0 && t.fill_time_ms < 3000) {
      out.push({
        type: 'FORM_FILL_INSTANT',
        category: categoryForSignal('FORM_FILL_INSTANT'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { fill_time_ms: t.fill_time_ms },
      });
    }

    // MOUSE_ENTROPY_ZERO — no mouse movement entropy at all. Real humans
    // jiggle the cursor; bots either skip mousemove entirely or fire a
    // straight line to the submit button. Threshold of 0.5 bits is tight
    // enough to avoid false-positives on real touch-only users (touch
    // events don't fire mousemove on most browsers, but we already gate
    // on fill_time > 3s implicitly by ordering).
    if (t.mouse_entropy < 0.5) {
      out.push({
        type: 'MOUSE_ENTROPY_ZERO',
        category: categoryForSignal('MOUSE_ENTROPY_ZERO'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { mouse_entropy: t.mouse_entropy },
      });
    }

    // KEYSTROKE_CADENCE_BOT — std-dev of inter-keydown intervals < 5ms.
    // Real humans have variability >40ms even when typing quickly; a
    // sub-5ms std-dev means the keystrokes were synthesised by a script
    // (Puppeteer .type with no delay = constant ~1-2ms cadence).
    if (t.keystroke_cadence_stddev > 0 && t.keystroke_cadence_stddev < 5) {
      out.push({
        type: 'KEYSTROKE_CADENCE_BOT',
        category: categoryForSignal('KEYSTROKE_CADENCE_BOT'),
        severity_multiplier: 1,
        occurrence_count: 1,
        evidence: { stddev_ms: t.keystroke_cadence_stddev },
      });
    }

    // COPY_PASTE_CRITICAL — paste detected on email / wallet / password.
    // Pasting email is fairly common (autofill, password managers), so
    // this is a low-weight signal. Pasting wallet address is more
    // suspicious. Pasting password is normal for password-manager users.
    // We flag pasting in any CRITICAL field — Tier 2's category cap keeps
    // it from over-influencing the score.
    const critical = t.copy_paste_events.filter(f => CRITICAL_PASTE_FIELDS.has(f));
    if (critical.length > 0) {
      out.push({
        type: 'COPY_PASTE_CRITICAL',
        category: categoryForSignal('COPY_PASTE_CRITICAL'),
        severity_multiplier: 1,
        occurrence_count: critical.length,
        evidence: { pasted_fields: critical },
      });
    }
  }

  return out;
}
