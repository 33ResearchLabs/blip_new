-- Migration 083: Backfill columns missing from migration 080's environment
--
-- Migration 080 introduced log_ledger_entry() with a 10th argument
-- (p_idempotency_key) that writes to ledger_entries.idempotency_key. Some
-- environments did not have that column yet (the original CREATE TABLE for
-- ledger_entries lives in earlier migrations and varies between branches),
-- which caused inserts to fail with PostgreSQL error 42703 (undefined
-- column).
--
-- This migration is fully idempotent (IF NOT EXISTS / IF EXISTS) so it
-- runs safely on every startup. It also drops the legacy 9-arg overload
-- of log_ledger_entry() introduced in migration 022, which became
-- ambiguous (PostgreSQL error 42725) once migration 080 added the new
-- 10-arg overload with p_idempotency_key DEFAULT NULL.

-- Ensure required columns exist on ledger_entries
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS balance_before numeric(20,8);

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS balance_after numeric(20,8);

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Unique-where-not-null index for idempotency lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency
  ON ledger_entries (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Drop the legacy 9-arg overload from migration 022 so the new 10-arg
-- version (with p_idempotency_key DEFAULT NULL) is the only resolution
-- target. PostgreSQL otherwise raises 42725 (function is not unique).
DROP FUNCTION IF EXISTS public.log_ledger_entry(
  character varying, uuid, character varying, numeric, character varying,
  uuid, character varying, text, jsonb
);
