-- Migration 125: record the QR's asserted INR amount alongside the user's typed amount
--
-- Audit F-3: today only the user-typed INR is persisted (`upi_fiat_inr`).
-- The QR's `am=` value is parsed but discarded after the user lands on the
-- amount screen. If a user scans a ₹100 merchant QR and submits an order
-- for ₹10,000, the audit trail has no record of the mismatch.
--
-- This column is purely additive — nothing reads it yet. Forms an audit
-- record for now; a follow-up PR can render a UI badge when
-- upi_qr_amount IS NOT NULL AND upi_qr_amount <> upi_fiat_inr.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS upi_qr_amount NUMERIC(20, 2);

COMMENT ON COLUMN orders.upi_qr_amount IS
  'INR amount asserted by the scanned UPI QR (the upi://pay `am=` param). '
  'NULL = QR did not specify an amount (open-ended QR) or order was not '
  'created from a QR scan. Compare against upi_fiat_inr to detect user '
  'amount overrides at scan time. Audit-only — no balance logic depends on it.';
