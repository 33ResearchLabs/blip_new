-- Phase 1 of the Issue Reporting expansion: multi-screenshot support
-- and explicit status history. ADDITIVE ONLY:
--   • screenshot_url column kept (back-compat with the v1 reporter)
--   • status CHECK widened to allow 'rejected' (existing values still valid)
--   • new columns default to '[]', so existing rows are immediately valid
--
-- Idempotent — safe to re-run on every core-api startup.

-- ── 1. New columns ──────────────────────────────────────────────────────
-- screenshots: ordered list of [{ id, url, type: 'screenshot'|'upload',
--   mime, size_bytes, created_at }] — same shape as `attachments` plus
--   a `type` discriminator so the UI can render captured shots
--   differently from manual uploads.
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS screenshots JSONB NOT NULL DEFAULT '[]'::jsonb;

-- status_history: append-only audit trail. Each entry:
--   { status, at, by_type, by_id, note? }
-- Source of truth for the user-facing timeline. admin_notes stays as
-- internal-only commentary.
ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS status_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── 2. Widen status CHECK to include 'rejected' ─────────────────────────
-- Drop and recreate. The default Postgres-generated name for the v1
-- check is `issues_status_check`. DROP IF EXISTS makes the migration
-- safe even if the constraint was already replaced by a previous run.
ALTER TABLE issues
  DROP CONSTRAINT IF EXISTS issues_status_check;

ALTER TABLE issues
  ADD CONSTRAINT issues_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'rejected'));

-- ── 3. Back-fill from v1 columns ────────────────────────────────────────
-- For rows that pre-date this migration, seed `screenshots` from the
-- single screenshot_url so the new UI doesn't show a regression. We
-- only touch rows whose screenshots is still the default '[]', so this
-- is safe to re-run.
UPDATE issues
   SET screenshots = jsonb_build_array(
         jsonb_build_object(
           'id',         id::text,
           'url',        screenshot_url,
           'type',       'screenshot',
           'created_at', to_char(created_at AT TIME ZONE 'UTC',
                                 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
         )
       )
 WHERE screenshots = '[]'::jsonb
   AND screenshot_url IS NOT NULL;

-- Seed status_history with the current status so the timeline is
-- non-empty for legacy rows. Idempotent via the '[]' guard.
UPDATE issues
   SET status_history = jsonb_build_array(
         jsonb_build_object(
           'status',  status,
           'at',      to_char(created_at AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'by_type', 'system',
           'by_id',   NULL
         )
       )
 WHERE status_history = '[]'::jsonb;

-- ── 4. Index for the user-facing "My Issues" query ──────────────────────
-- The new GET /api/issues route filters by created_by + actor_type and
-- orders by created_at DESC. Compound partial index keeps the scan
-- bounded even as the table grows.
CREATE INDEX IF NOT EXISTS idx_issues_actor_created
  ON issues (actor_type, created_by, created_at DESC)
  WHERE created_by IS NOT NULL;
