-- ============================================================================
-- 144_backfill_referral_codes.sql
--
-- Idempotent one-off backfill for users.referral_code and
-- merchants.referral_code. Targets two populations:
--
--   1. Accounts that registered through the main user/merchant app at
--      `/?tab=register` (or earlier paths) and never went through
--      setupWaitlistForActor — their referral_code column was left NULL.
--
--   2. Pre-waitlist accounts that existed before migration 131 added
--      the column.
--
-- Strategy ("one human = one code"):
--   Pass 1+2: when one side of a same-email (or same-wallet) user/merchant
--             pair already has a code and the other is NULL, COPY the
--             existing code across. Avoids generating divergent codes for
--             the same human.
--   Pass 3:   generate fresh base62 codes for any remaining NULL users,
--             retrying on the rare partial-unique index collision.
--   Pass 4:   re-run the cross-actor propagation now that user codes
--             exist for previously-orphaned merchant counterparts.
--   Pass 5:   generate fresh codes for any merchants still NULL.
--
-- Idempotency: every UPDATE is gated on `referral_code IS NULL`, so
-- subsequent runs (the migration runner re-fires on every core-api
-- startup) become no-ops once the column is fully populated.
--
-- Non-destructive: existing non-null codes are never overwritten. No
-- BLIP points are credited; no waitlist_status / joined_at / source
-- column is touched. Compare to migration 134 (which DID credit
-- balances) — this one is column-write-only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: 8-char base62 generator mirroring src/lib/waitlist/referral.ts:11
-- so codes assigned here are indistinguishable from runtime-generated ones.
-- DROP at the end so we don't leave the helper in the schema.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _backfill_gen_referral_code() RETURNS text AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(alphabet, 1 + floor(random() * 62)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Pass 1A: users.referral_code ← merchants.referral_code matched by email
-- ----------------------------------------------------------------------------
UPDATE users u
   SET referral_code = m.referral_code,
       updated_at    = NOW()
  FROM merchants m
 WHERE u.referral_code IS NULL
   AND m.referral_code IS NOT NULL
   AND u.email IS NOT NULL
   AND m.email IS NOT NULL
   AND LOWER(u.email) = LOWER(m.email);

-- Pass 1B: same direction, matched by wallet_address (for accounts without
-- email overlap but with a shared embedded-wallet linkage).
UPDATE users u
   SET referral_code = m.referral_code,
       updated_at    = NOW()
  FROM merchants m
 WHERE u.referral_code IS NULL
   AND m.referral_code IS NOT NULL
   AND u.wallet_address IS NOT NULL
   AND u.wallet_address = m.wallet_address;

-- ----------------------------------------------------------------------------
-- Pass 2A: merchants.referral_code ← users.referral_code matched by email
-- ----------------------------------------------------------------------------
UPDATE merchants m
   SET referral_code = u.referral_code,
       updated_at    = NOW()
  FROM users u
 WHERE m.referral_code IS NULL
   AND u.referral_code IS NOT NULL
   AND m.email IS NOT NULL
   AND u.email IS NOT NULL
   AND LOWER(m.email) = LOWER(u.email);

-- Pass 2B: same direction, matched by wallet_address.
UPDATE merchants m
   SET referral_code = u.referral_code,
       updated_at    = NOW()
  FROM users u
 WHERE m.referral_code IS NULL
   AND u.referral_code IS NOT NULL
   AND m.wallet_address IS NOT NULL
   AND m.wallet_address = u.wallet_address;

-- ----------------------------------------------------------------------------
-- Pass 3: generate fresh codes for users still NULL. PL/pgSQL loop with
-- retry on 23505 (unique_violation on the partial unique index).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  attempts INT;
BEGIN
  FOR r IN SELECT id FROM users WHERE referral_code IS NULL LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      candidate := _backfill_gen_referral_code();
      BEGIN
        UPDATE users
           SET referral_code = candidate,
               updated_at    = NOW()
         WHERE id = r.id
           AND referral_code IS NULL;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF attempts > 10 THEN
          RAISE NOTICE '[144] could not assign referral_code for user %', r.id;
          EXIT;
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Pass 4: re-propagate user codes to NULL merchant counterparts (some
-- counterparts may have had a NULL primary in pass 2 that now has one).
-- ----------------------------------------------------------------------------
UPDATE merchants m
   SET referral_code = u.referral_code,
       updated_at    = NOW()
  FROM users u
 WHERE m.referral_code IS NULL
   AND u.referral_code IS NOT NULL
   AND m.email IS NOT NULL
   AND u.email IS NOT NULL
   AND LOWER(m.email) = LOWER(u.email);

UPDATE merchants m
   SET referral_code = u.referral_code,
       updated_at    = NOW()
  FROM users u
 WHERE m.referral_code IS NULL
   AND u.referral_code IS NOT NULL
   AND m.wallet_address IS NOT NULL
   AND m.wallet_address = u.wallet_address;

-- ----------------------------------------------------------------------------
-- Pass 5: generate fresh codes for any merchants still NULL.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  candidate TEXT;
  attempts INT;
BEGIN
  FOR r IN SELECT id FROM merchants WHERE referral_code IS NULL LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      candidate := _backfill_gen_referral_code();
      BEGIN
        UPDATE merchants
           SET referral_code = candidate,
               updated_at    = NOW()
         WHERE id = r.id
           AND referral_code IS NULL;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF attempts > 10 THEN
          RAISE NOTICE '[144] could not assign referral_code for merchant %', r.id;
          EXIT;
        END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Clean up the helper. CREATE OR REPLACE above means re-runs are fine; the
-- DROP at the end means we don't leave random objects in the public schema.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS _backfill_gen_referral_code();
