-- Migration 097: Add disputes.resolved_by column
--
-- BACKGROUND:
-- Production's `disputes` table is missing the `resolved_by` column even
-- though the application has been writing to it for a while:
--
--   src/app/api/compliance/disputes/[id]/finalize/route.ts:
--     UPDATE disputes
--        SET status = 'resolved'::dispute_status,
--            resolved_by = $1,         -- ← column missing on prod
--            resolved_at = NOW(),
--            ...
--
-- Until now nobody hit it on prod because the same endpoint also had a
-- 403 bug ("Invalid compliance member") that blocked merchants with
-- has_compliance_access from ever reaching the UPDATE. Commit 4ca41be13
-- fixes that 403 — without this migration, those merchants would now
-- sail past the auth check and crash on the UPDATE with
--   ERROR: column "resolved_by" of relation "disputes" does not exist.
--
-- Local + staging already have the column (it's in schema.sql and was
-- created at table-init time on those envs). This migration brings prod
-- in line. Pure additive ALTER COLUMN — no FK, NULL-default, idempotent.

ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS resolved_by TEXT NULL;
