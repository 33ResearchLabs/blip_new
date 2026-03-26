-- Migration 054: Safety net — verify escrow backfill from 052
--
-- Migration 052 now handles the backfill + constraint in the correct order.
-- This migration is a no-op verification that confirms the data is clean
-- and the constraint is in place. Kept for auditability.

DO $$
DECLARE
  v_violations INT;
  v_constraint_exists BOOLEAN;
BEGIN
  -- Verify no violations exist
  SELECT COUNT(*) INTO v_violations
  FROM orders
  WHERE status IN ('payment_sent', 'payment_confirmed', 'releasing', 'completed')
    AND escrow_debited_entity_id IS NULL;

  IF v_violations > 0 THEN
    RAISE EXCEPTION '[054] Data integrity check failed: % orders still missing escrow_debited_entity_id.', v_violations;
  END IF;

  -- Verify constraint exists
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_escrow_required_for_payment_statuses'
  ) INTO v_constraint_exists;

  IF NOT v_constraint_exists THEN
    RAISE EXCEPTION '[054] Constraint chk_escrow_required_for_payment_statuses not found — migration 052 may not have run.';
  END IF;

  RAISE NOTICE '[054] Verification passed: 0 violations, constraint is active.';
END $$;
