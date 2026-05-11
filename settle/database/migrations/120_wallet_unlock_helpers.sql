-- Per-actor server-side unlock helper (Step 3 of wallet hardening roadmap).
--
-- Each user / merchant gets a 32-byte random secret stored server-side.
-- The encrypted-wallet blob in the user's browser is encrypted with a key
-- derived from `password + unlock_helper` (PBKDF2 over the concatenation).
-- Result: an attacker with only the offline localStorage blob cannot
-- brute-force the wallet at all — they must also authenticate to this
-- server and survive the rate limiter that gates GET /api/wallet/unlock-helper.
--
-- The helper is NOT a wallet key — it can be safely regenerated if leaked
-- (re-encrypt path required, but funds aren't at risk on rotation). For
-- this MVP the helper is static once minted; rotation is a future
-- improvement.
--
-- Idempotent — safe to re-run.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wallet_unlock_helper TEXT;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS wallet_unlock_helper TEXT;

COMMENT ON COLUMN users.wallet_unlock_helper IS
  'Base64-encoded 32-byte secret mixed into the user wallet KDF. Treat as a session secret — never return outside the authenticated unlock-helper endpoint.';

COMMENT ON COLUMN merchants.wallet_unlock_helper IS
  'Base64-encoded 32-byte secret mixed into the merchant wallet KDF. Treat as a session secret — never return outside the authenticated unlock-helper endpoint.';
