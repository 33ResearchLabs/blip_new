-- Migration 124: Web Push subscriptions
--
-- One row per (actor, device) pair. The browser-provided endpoint is the
-- delivery URL — vendor-rotated, immutable for a given subscription. The
-- p256dh + auth keys are the device's encryption keys for the payload.
-- We never log them — read-only at send time.
--
-- Actor can be either a user OR a merchant; same shape, distinct actor_type.
-- (Compliance role doesn't need push for now.)

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type        TEXT         NOT NULL CHECK (actor_type IN ('user', 'merchant')),
  actor_id          UUID         NOT NULL,
  endpoint          TEXT         NOT NULL UNIQUE,
  p256dh            TEXT         NOT NULL,
  auth              TEXT         NOT NULL,
  user_agent        TEXT,
  last_seen_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Number of consecutive 410/404 responses from the push service. We
  -- prune subs once this crosses a threshold (subscription expired).
  failure_count     INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_push_subs_actor ON push_subscriptions (actor_type, actor_id);

COMMENT ON TABLE push_subscriptions IS
  'Web Push (VAPID) subscriptions. One per browser+device per actor.';
