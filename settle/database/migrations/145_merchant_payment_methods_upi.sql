-- Migration 145: Allow 'upi' on merchant_payment_methods.type
--
-- Migration 045 defined the CHECK constraint with values
-- {bank, cash, crypto, card, mobile}. The UI / API now also offer 'upi'
-- (already accepted on the user side via migration 039 and on
-- orders.payment_method via migration 099). Widen the merchant CHECK to
-- match so POSTs that include type='upi' don't trip the constraint.
--
-- Idempotent: drops the existing constraint (auto-named by Postgres as
-- `merchant_payment_methods_type_check`) and re-creates it with the full
-- set. Re-running is a no-op because the new constraint is a superset.

ALTER TABLE merchant_payment_methods
  DROP CONSTRAINT IF EXISTS merchant_payment_methods_type_check;

ALTER TABLE merchant_payment_methods
  ADD CONSTRAINT merchant_payment_methods_type_check
  CHECK (type IN ('bank', 'cash', 'crypto', 'card', 'mobile', 'upi'));
