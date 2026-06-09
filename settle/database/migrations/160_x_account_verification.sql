-- 160_x_account_verification.sql
--
-- Self-attested X (Twitter) account verification, surfaced in the merchant
-- Settings → Limits tab ("Social Verification"). The merchant follows
-- @blip_money and confirms by entering their X handle; we record it as a
-- verified badge. This is DISPLAY-ONLY — it does NOT change trade limits and
-- is independent of the waitlist quest system (waitlist_tasks).
--
-- One row per (actor_type, actor_id) enforced by a UNIQUE index, so the
-- POST endpoint upserts. actor_type is kept generic ('user' | 'merchant')
-- for symmetry with the rest of the limit system, though it is only wired
-- into the merchant Limits tab today. Idempotent / re-runnable.

CREATE TABLE IF NOT EXISTS x_account_verifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type  text        NOT NULL,   -- 'user' | 'merchant'
  actor_id    UUID        NOT NULL,
  x_username  text        NOT NULL,   -- X handle without leading '@'
  status      text        NOT NULL DEFAULT 'verified',  -- 'verified'
  verified_at timestamptz NOT NULL DEFAULT NOW(),
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

-- CHECK constraints added defensively (re-runnable): only attach if absent.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'x_account_verifications_actor_type_check'
  ) THEN
    ALTER TABLE x_account_verifications
      ADD CONSTRAINT x_account_verifications_actor_type_check
      CHECK (actor_type IN ('user','merchant'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'x_account_verifications_status_check'
  ) THEN
    ALTER TABLE x_account_verifications
      ADD CONSTRAINT x_account_verifications_status_check
      CHECK (status IN ('verified'));
  END IF;
END $$;

-- One verification row per actor (the lookup + upsert key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_x_account_verifications_actor
  ON x_account_verifications (actor_type, actor_id);
