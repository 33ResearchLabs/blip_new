-- 141_hypothesis_breakdown.sql (Phase F — Bayesian classifier polish)
--
-- Adds two columns to risk_profiles so the admin UI can show the full
-- hypothesis breakdown and an ambiguity indicator without re-running the
-- Bayesian classifier on every detail view:
--
--   * wl_per_hypothesis   — full {NORMAL: 0.62, BOT_FARM: 0.18, ...} payload
--                            so we can render a breakdown bar in the modal
--                            without rebuilding the classifier client-side
--   * wl_hypothesis_margin — top posterior − second-place posterior. Used
--                            for ambiguity styling on the hypothesis chip
--                            (margin > 0.5 = confident, < 0.2 = ambiguous).
--
-- Additive-only. Existing code paths that read other wl_* columns are
-- unaffected.

BEGIN;

ALTER TABLE risk_profiles
  ADD COLUMN IF NOT EXISTS wl_per_hypothesis            jsonb,
  ADD COLUMN IF NOT EXISTS wl_hypothesis_margin         real,
  ADD COLUMN IF NOT EXISTS wl_hypothesis_contributors   jsonb;

COMMIT;
