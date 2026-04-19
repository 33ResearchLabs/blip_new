-- Migration 101: Hybrid merchant-competition auction system.
--
-- Additive only. The existing fixed-price flow continues to work unchanged.
-- An order is "auction" only when orders.auction_mode = 'auction' (default
-- 'fixed'). All new columns are nullable for legacy rows.

-- ───────────────────────────────────────────────────────────────────────────
-- orders: lock fields for the winning bid.
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS auction_mode           VARCHAR(20) NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS selection_mode         VARCHAR(20),                       -- 'fastest' | 'recommended' | 'best_value'
  ADD COLUMN IF NOT EXISTS auction_id             UUID,
  ADD COLUMN IF NOT EXISTS selected_merchant_id   UUID,                              -- winner (once locked)
  ADD COLUMN IF NOT EXISTS agreed_rate            NUMERIC(10, 4),                    -- winning rate
  ADD COLUMN IF NOT EXISTS expected_payout_base   NUMERIC(20, 0);                    -- pre-computed payout (u64-safe)

ALTER TABLE orders
  ADD CONSTRAINT orders_auction_mode_check
    CHECK (auction_mode IN ('fixed', 'auction'));

ALTER TABLE orders
  ADD CONSTRAINT orders_selection_mode_check
    CHECK (selection_mode IS NULL
           OR selection_mode IN ('fastest', 'recommended', 'best_value'));

-- ───────────────────────────────────────────────────────────────────────────
-- order_auctions: one row per auctioned order. Tracks the bidding window.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_auctions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  mode                VARCHAR(20) NOT NULL CHECK (mode IN ('fastest', 'recommended', 'best_value')),
  -- Authoritative reference price at auction creation (what merchants quote against).
  base_rate           NUMERIC(10, 4)  NOT NULL,
  base_fee_bps        SMALLINT        NOT NULL,
  -- Bidding window.
  window_ms           INTEGER         NOT NULL DEFAULT 3000,
  window_opens_at     TIMESTAMPTZ     NOT NULL DEFAULT now(),
  window_closes_at    TIMESTAMPTZ     NOT NULL,
  -- Result.
  status              VARCHAR(20)     NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'scoring', 'locked', 'no_bids', 'cancelled')),
  winning_bid_id      UUID,
  bid_count           INTEGER         NOT NULL DEFAULT 0,
  rejected_count      INTEGER         NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_auctions_status_window
  ON order_auctions (status, window_closes_at);

-- ───────────────────────────────────────────────────────────────────────────
-- order_bids: each bid submitted by an eligible merchant.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_bids (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id            UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  auction_id          UUID NOT NULL REFERENCES order_auctions(id) ON DELETE CASCADE,
  merchant_id         UUID NOT NULL REFERENCES merchants(id),
  rate                NUMERIC(10, 4) NOT NULL CHECK (rate > 0),
  max_amount          NUMERIC(20, 6) NOT NULL CHECK (max_amount > 0),
  eta_seconds         INTEGER        NOT NULL CHECK (eta_seconds > 0 AND eta_seconds <= 3600),
  -- Populated at scoring time.
  score               NUMERIC(10, 6),
  score_breakdown     JSONB,                                 -- {payout, rating, success, speed, dispute}
  status              VARCHAR(20) NOT NULL DEFAULT 'submitted'
                        CHECK (status IN ('submitted', 'filtered', 'won', 'lost', 'expired')),
  rejection_reason    VARCHAR(50),                           -- 'success_rate' | 'liquidity' | 'deviation' | 'trust' | 'max_amount' | ...
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_order_bids_auction ON order_bids (auction_id, status);
CREATE INDEX IF NOT EXISTS idx_order_bids_merchant ON order_bids (merchant_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- merchant_metrics: rolling, authoritative metrics for scoring.
-- Separate from `merchants` to keep that table tight and avoid write contention.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS merchant_metrics (
  merchant_id              UUID PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  total_orders             INTEGER         NOT NULL DEFAULT 0,
  completed_orders         INTEGER         NOT NULL DEFAULT 0,
  failed_orders            INTEGER         NOT NULL DEFAULT 0,
  disputed_orders          INTEGER         NOT NULL DEFAULT 0,
  disputes_lost            INTEGER         NOT NULL DEFAULT 0,
  total_volume_usdt        NUMERIC(20, 6)  NOT NULL DEFAULT 0,
  avg_completion_seconds   INTEGER         NOT NULL DEFAULT 300,
  avg_rating               NUMERIC(3, 2),                                           -- mirror of merchants.rating
  rating_count             INTEGER         NOT NULL DEFAULT 0,
  -- Policy state.
  trust_level              VARCHAR(20)     NOT NULL DEFAULT 'probation'
                             CHECK (trust_level IN ('untrusted', 'probation', 'standard', 'trusted')),
  suspended_until          TIMESTAMPTZ,
  suspension_reason        VARCHAR(120),
  last_bid_at              TIMESTAMPTZ,
  last_order_at            TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Derived view for cheap reads in scoring: success_rate, dispute_rate.
CREATE OR REPLACE VIEW v_merchant_scoring AS
SELECT
  m.id                                                                   AS merchant_id,
  m.rating                                                               AS avg_rating,
  m.rating_count                                                         AS rating_count,
  m.balance                                                              AS balance,
  m.is_online                                                            AS is_online,
  m.status                                                               AS merchant_status,
  COALESCE(mm.trust_level, 'probation')                                  AS trust_level,
  mm.suspended_until                                                     AS suspended_until,
  COALESCE(mm.total_orders, 0)                                           AS total_orders,
  COALESCE(mm.completed_orders, 0)                                       AS completed_orders,
  COALESCE(mm.disputed_orders, 0)                                        AS disputed_orders,
  COALESCE(mm.disputes_lost, 0)                                          AS disputes_lost,
  COALESCE(mm.avg_completion_seconds, 300)                               AS avg_completion_seconds,
  CASE
    WHEN COALESCE(mm.total_orders, 0) = 0 THEN 1.0
    ELSE COALESCE(mm.completed_orders, 0)::numeric / mm.total_orders::numeric
  END                                                                    AS success_rate,
  CASE
    WHEN COALESCE(mm.total_orders, 0) = 0 THEN 0.0
    ELSE COALESCE(mm.disputes_lost, 0)::numeric / mm.total_orders::numeric
  END                                                                    AS dispute_rate
FROM merchants m
LEFT JOIN merchant_metrics mm ON mm.merchant_id = m.id;

COMMENT ON TABLE order_auctions   IS 'One row per auctioned order. Tracks bidding window + outcome.';
COMMENT ON TABLE order_bids       IS 'All bids submitted for an auctioned order. Idempotent per (order, merchant).';
COMMENT ON TABLE merchant_metrics IS 'Rolling authoritative metrics used by the auction scorer.';
COMMENT ON VIEW  v_merchant_scoring IS 'Denormalised read view for scoring — joins merchants + merchant_metrics.';
