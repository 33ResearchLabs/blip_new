-- 139_signup_behavior.sql (Phase D — behavioural telemetry capture)
--
-- One row per signup form session. Captures timing-level signals
-- (form fill duration, mouse entropy, keystroke cadence, paste events,
-- tab-switches, scroll events) so the threat-detection pipeline can fire
-- bot-detection signals (FORM_FILL_INSTANT, MOUSE_ENTROPY_ZERO,
-- KEYSTROKE_CADENCE_BOT, COPY_PASTE_CRITICAL).
--
-- Privacy considerations:
--   * No keystroke CONTENT is stored — only timing (intervals).
--   * No mouse path coordinates — only the computed entropy summary.
--   * copy_paste_events stores only the FIELD NAME ('email', 'wallet'),
--     never the pasted content.
--   * All values are aggregates: no raw event log is persisted.
--
-- Schema is additive-only. Standalone table; no FK to users/merchants
-- (cascade-safe — actor_type+actor_id is a soft pointer).

BEGIN;

CREATE TABLE IF NOT EXISTS signup_behavior (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id                   uuid NOT NULL,
  actor_type                 text NOT NULL,
  -- Total ms from first form field focus to submit click.
  fill_time_ms               integer,
  -- Shannon-entropy summary of mousemove distribution (0–8 typical range;
  -- ~0 = bot with no/straight movement, >4 = human).
  mouse_entropy              real,
  -- Standard deviation of inter-keydown intervals across all input fields.
  -- ~0 = constant cadence (typed by script).
  keystroke_cadence_stddev   real,
  -- Array of input field names (e.g. ['email','password']) where a paste
  -- event was detected. Used by COPY_PASTE_CRITICAL signal.
  copy_paste_events          jsonb DEFAULT '[]'::jsonb,
  -- Document visibilitychange events seen during the form session.
  tab_switches               integer DEFAULT 0,
  -- scroll events on window/document during the form session.
  scroll_events              integer DEFAULT 0,
  captured_at                timestamptz NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'signup_behavior_actor_type_check'
  ) THEN
    ALTER TABLE signup_behavior
      ADD CONSTRAINT signup_behavior_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_signup_behavior_actor
  ON signup_behavior (actor_type, actor_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_signup_behavior_captured
  ON signup_behavior (captured_at);

COMMIT;
