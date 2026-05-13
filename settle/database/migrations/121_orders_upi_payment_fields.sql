-- Migration 121: UPI payment fields on orders
--
-- For the "Pay by QR" flow: when a user scans a merchant's UPI QR and creates
-- a sell order, the order needs to carry the scanned VPA + payee name + INR
-- amount so the accepting Blip merchant knows where to actually send the rupees.
--
-- Without these columns, the merchant only sees the USDT/INR amounts but no
-- destination to pay to. With them, the merchant order card can re-render the
-- UPI QR for the merchant to scan in their own UPI app.
--
-- All three are nullable — they only exist on UPI-pay sell orders. Regular
-- bank-transfer / cash orders leave them NULL.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS upi_vpa         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS upi_payee_name  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS upi_fiat_inr    NUMERIC(20, 2);

-- Partial index over the rows that actually have UPI metadata — keeps the
-- index tiny since most orders won't be UPI-flow.
CREATE INDEX IF NOT EXISTS idx_orders_upi_vpa
  ON orders (upi_vpa)
  WHERE upi_vpa IS NOT NULL;

COMMENT ON COLUMN orders.upi_vpa IS
  'Destination UPI VPA (e.g. user@bank) scanned from merchant QR. Set only on UPI-pay sell orders.';
COMMENT ON COLUMN orders.upi_payee_name IS
  'Display name from the scanned UPI QR (pn= param). May be empty string.';
COMMENT ON COLUMN orders.upi_fiat_inr IS
  'Original INR amount the user typed during UPI scan. Independent of fiat_amount which is computed from rate × USDT. These should be near-identical but may differ by sub-rupee rounding.';
