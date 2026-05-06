-- Login-signature replay protection (Issue C1).
-- Server issues a nonce; client signs a message containing it; server consumes
-- the nonce on login. A captured signed message can no longer be replayed —
-- the nonce row is marked consumed atomically and any second attempt fails.
--
-- Storage choice: Postgres (not Redis). Postgres is required infra; Redis is
-- graceful-fallback in this app. Auth must work even if Redis is down, so the
-- nonce store lives where correctness is guaranteed.

CREATE TABLE IF NOT EXISTS login_nonces (
  nonce VARCHAR(64) PRIMARY KEY,
  wallet_address VARCHAR(100) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

-- Hot lookup path: WHERE nonce = $1 — covered by primary key.
-- Pruning path: DELETE WHERE expires_at < NOW() - interval — index speeds it.
CREATE INDEX IF NOT EXISTS idx_login_nonces_expires_at
  ON login_nonces (expires_at);

-- Per-wallet rate-limit visibility: count unconsumed nonces per wallet.
CREATE INDEX IF NOT EXISTS idx_login_nonces_wallet_open
  ON login_nonces (wallet_address)
  WHERE consumed_at IS NULL;
