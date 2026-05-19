-- Migration 127: Default payment method per user
--
-- Adds is_default to user_payment_methods so the profile UI can pin the
-- user's chosen primary method to the top and the trade-creation flow can
-- preselect it. At most one default per user (among active rows) is
-- enforced via a partial unique index; deleting / deactivating the default
-- does NOT auto-promote another row — the UI explicitly asks the user.
--
-- Backfill: every user gets their oldest active row promoted to default,
-- so no user is left without one if they already have payment methods.

ALTER TABLE user_payment_methods
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_payment_methods.is_default IS
  'True for the user''s primary payment method. At most one true per user (active rows) — enforced by uq_upm_one_default_per_user.';

-- One default per user, only among active rows. Soft-deleted rows are
-- exempt so we never block setting a new default after the old one was
-- deactivated.
CREATE UNIQUE INDEX IF NOT EXISTS uq_upm_one_default_per_user
  ON user_payment_methods (user_id)
  WHERE is_default = true AND is_active = true;

-- Backfill: promote each user's oldest active row to default IFF the user
-- has no default yet. Runs once safely; subsequent runs are no-ops because
-- the WHERE filter excludes users with an existing default.
WITH first_active AS (
  SELECT DISTINCT ON (user_id) id, user_id
  FROM user_payment_methods
  WHERE is_active = true
  ORDER BY user_id, created_at ASC
)
UPDATE user_payment_methods upm
SET is_default = true
FROM first_active fa
WHERE upm.id = fa.id
  AND NOT EXISTS (
    SELECT 1 FROM user_payment_methods existing
    WHERE existing.user_id = fa.user_id
      AND existing.is_default = true
      AND existing.is_active = true
  );
