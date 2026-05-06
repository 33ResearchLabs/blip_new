-- Migration 112: Restore server-derived seller validation in escrow_order_v1
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BACKGROUND — what regressed and why this exists
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The escrow lock function has been rewritten several times:
--
--   060 — derived the seller from order columns (server-side); rejected
--         callers with WRONG_ESCROW_PARTY when p_actor_id != v_seller_id.
--   061 — added a placeholder-user pending guard so real user-created orders
--         can't skip the merchant Mine/Accept step.
--   081 — fixed the missing escrow_debited_entity_* fields BUT in the rewrite
--         dropped both 060's seller validation AND 061's pending guard.
--         The function went back to trusting p_actor_type / p_actor_id,
--         and stored those client-supplied values as the "seller" of record.
--
-- Why that's bad:
--
--   * escrow_debited_entity_id is the authority for release_order_v1 + the
--     refund flow — whoever's recorded as having locked escrow can pull
--     funds out. Trusting p_actor_id at lock time means an attacker who
--     reaches the SQL layer (direct DB script, future debug endpoint,
--     bypass of the core-api ownership check) can record themselves as the
--     seller and later release escrow to themselves.
--   * 081 also widened the status guard back to allow 'pending' for any
--     order, re-opening the bug 061 closed.
--
-- The core-api route at apps/core-api/src/routes/escrow.ts already does
-- server-side seller derivation BEFORE calling the SP, so the live attack
-- surface for the proxy is closed. This migration restores the SQL-layer
-- defense-in-depth so the function is also safe when called directly
-- (admin tooling, future endpoints, ops scripts).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- TRUST BOUNDARIES — read this before changing the function body
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Server-derived (TRUSTED — derived from `orders` row inside the txn):
--   v_seller_id, v_seller_type   — who is allowed to lock escrow
--   v_amount                     — escrow size, from orders.crypto_amount
--   v_is_placeholder             — used to gate 'pending' → 'escrowed'
--
-- Caller-supplied IDENTITY (UNTRUSTED — must be validated, never stored):
--   p_actor_type, p_actor_id     — who CLAIMS to be locking escrow.
--                                  Function only uses these to compare against
--                                  v_seller_*. NEVER copied into the row as
--                                  the debited entity, NEVER used to choose
--                                  which balance to deduct.
--
-- Caller-supplied METADATA (UNTRUSTED — stored as labels, not branched on):
--   p_tx_hash                    — Solana tx signature. The CALLER is
--                                  responsible for verifying this tx on
--                                  chain BEFORE invoking. The function does
--                                  not re-verify; it trusts that settle's
--                                  /api/orders/[id]/escrow route confirmed
--                                  the tx before proxying. Storing without
--                                  verification is acceptable because the
--                                  on-chain escrow PDA is the authoritative
--                                  fund custody — this column is just an
--                                  index for the UI / explorer link.
--   p_escrow_address,
--   p_escrow_trade_id,
--   p_escrow_trade_pda,
--   p_escrow_pda,
--   p_escrow_creator_wallet      — informational PDAs / addresses. Never
--                                  branched on. Stored verbatim.
--
-- p_mock_mode                    — sourced from core-api's MOCK_MODE env at
--                                  runtime, not from a client header. Effectively
--                                  trusted (operator-controlled). In mock mode
--                                  we deduct a DB balance because there's no
--                                  on-chain escrow. In prod mode the chain is
--                                  the source of truth — DB balance is
--                                  untouched here.
--
-- IDEMPOTENCY:
--   `escrow_tx_hash IS NOT NULL` → ALREADY_ESCROWED (return without write).
--   Combined with the FOR UPDATE lock at the top, two concurrent calls on
--   the same order serialize and only one succeeds.
--
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.escrow_order_v1(
  p_order_id UUID,
  p_tx_hash VARCHAR,
  p_actor_type VARCHAR,
  p_actor_id UUID,
  p_escrow_address VARCHAR DEFAULT NULL,
  p_escrow_trade_id BIGINT DEFAULT NULL,
  p_escrow_trade_pda VARCHAR DEFAULT NULL,
  p_escrow_pda VARCHAR DEFAULT NULL,
  p_escrow_creator_wallet VARCHAR DEFAULT NULL,
  p_mock_mode BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_order         RECORD;
  v_old_status    VARCHAR;
  v_amount        DECIMAL;
  v_updated       RECORD;
  v_seller_id     UUID;       -- SERVER-DERIVED: who is allowed to lock escrow
  v_seller_type   VARCHAR;    -- 'merchant' | 'user' (server-derived)
  v_username      VARCHAR;
  v_is_placeholder BOOLEAN;
BEGIN
  -- 1. Lock the order row. Serializes concurrent attempts on the same order.
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
  END IF;

  v_old_status := v_order.status::TEXT;

  -- 2. Idempotency — if escrow is already locked, refuse.
  --    Crucially we check this BEFORE the status guard so a re-call with the
  --    SAME tx_hash gets a clean ALREADY_ESCROWED rather than a spurious
  --    ORDER_STATUS_CHANGED that callers might retry.
  IF v_order.escrow_tx_hash IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_ESCROWED');
  END IF;

  -- 3. Status guard.
  --    'pending' is only acceptable for merchant-created orders (placeholder
  --    user accounts whose username starts with open_order_ / m2m_). Real
  --    user-created orders MUST be in 'accepted' first — that's the
  --    Mine/Accept step that binds a merchant to the order. Skipping it
  --    would let any caller lock escrow on an unclaimed user order.
  IF v_order.status = 'pending'::order_status THEN
    SELECT username INTO v_username FROM users WHERE id = v_order.user_id;
    v_is_placeholder := v_username LIKE 'open_order_%' OR v_username LIKE 'm2m_%';
    IF NOT v_is_placeholder THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'ORDER_NOT_ACCEPTED',
        'detail', 'Order must be accepted by a merchant before escrow can be locked'
      );
    END IF;
  ELSIF v_order.status NOT IN ('accepted'::order_status, 'escrow_pending'::order_status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'ORDER_STATUS_CHANGED');
  END IF;

  v_amount := v_order.crypto_amount;

  -- 4. Derive the legitimate seller from the ORDER ROW only.
  --    This is the single source of truth for who is allowed to lock escrow.
  --    Rules (must match resolveTradeRole in handleOrderAction.ts):
  --      M2M  (buyer_merchant_id IS NOT NULL): merchant_id is ALWAYS seller
  --      buy  (non-M2M):                       merchant_id is seller
  --      sell (non-M2M):                       user_id is seller
  IF v_order.buyer_merchant_id IS NOT NULL THEN
    v_seller_id   := v_order.merchant_id;
    v_seller_type := 'merchant';
  ELSIF v_order.type = 'buy'::offer_type THEN
    v_seller_id   := v_order.merchant_id;
    v_seller_type := 'merchant';
  ELSE
    v_seller_id   := v_order.user_id;
    v_seller_type := 'user';
  END IF;

  -- 5. Authorization: caller-claimed identity MUST equal the server-derived
  --    seller. The p_actor_* params are inputs to this comparison ONLY —
  --    they're never written to the row, never branched on for which balance
  --    to deduct, and never used to set escrow_debited_entity_*.
  IF p_actor_id IS NULL OR p_actor_id <> v_seller_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'WRONG_ESCROW_PARTY',
      'detail', 'Only the seller can lock escrow. Expected ' || v_seller_type
                || ' ' || v_seller_id::TEXT
                || ', got ' || COALESCE(p_actor_type, '<null>')
                || ' ' || COALESCE(p_actor_id::TEXT, '<null>')
    );
  END IF;

  -- 6. Mock mode: deduct from the SERVER-DERIVED seller. We never use
  --    p_actor_id here even though it's been validated equal to v_seller_id —
  --    using v_seller_id keeps the source of truth obvious to future readers
  --    and prevents a future refactor that loosens validation from also
  --    silently misrouting the deduction.
  --    Production mode: balance is untouched in DB; on-chain escrow PDA is
  --    the authoritative fund custody.
  IF p_mock_mode THEN
    IF v_seller_type = 'merchant' THEN
      UPDATE merchants SET balance = balance - v_amount
        WHERE id = v_seller_id AND balance >= v_amount;
    ELSE
      UPDATE users SET balance = balance - v_amount
        WHERE id = v_seller_id AND balance >= v_amount;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_BALANCE');
    END IF;
  END IF;

  -- 7. Mark the order escrowed. The escrow_debited_entity_* fields record
  --    the SERVER-DERIVED seller, not the caller's claimed identity. These
  --    fields are read by release_order_v1 + the refund flow as the
  --    authority for releasing escrow back to a wallet, so trusting client
  --    input here would be the same class of bug as 081.
  UPDATE orders SET
    escrow_tx_hash             = p_tx_hash,
    escrow_address             = p_escrow_address,
    escrow_trade_id            = p_escrow_trade_id,
    escrow_trade_pda           = p_escrow_trade_pda,
    escrow_pda                 = p_escrow_pda,
    escrow_creator_wallet      = p_escrow_creator_wallet,
    escrowed_at                = NOW(),
    expires_at                 = NOW() + INTERVAL '120 minutes',
    status                     = 'escrowed'::order_status,
    order_version              = order_version + 1,
    -- ↓ from v_seller_*, NEVER from p_actor_*
    escrow_debited_entity_type = v_seller_type,
    escrow_debited_entity_id   = v_seller_id,
    escrow_debited_amount      = v_amount,
    escrow_debited_at          = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  -- NOTE: the auto_log_order_ledger trigger handles ledger entry creation
  -- when escrow_tx_hash transitions from NULL to non-NULL. Don't call
  -- log_ledger_entry from here or duplicate entries result.

  RETURN jsonb_build_object(
    'success',    true,
    'old_status', v_old_status,
    'order',      row_to_json(v_updated)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- BACKFILL — fix orders that 081 wrote with client-supplied actor as the
-- debited entity. Only correct rows where the recorded debited entity is
-- different from the SERVER-DERIVED seller (i.e. the bug actually fired).
-- ═══════════════════════════════════════════════════════════════════════════
WITH derived AS (
  SELECT
    id,
    CASE
      WHEN buyer_merchant_id IS NOT NULL THEN 'merchant'
      WHEN type = 'buy'::offer_type        THEN 'merchant'
      ELSE                                       'user'
    END AS seller_type,
    CASE
      WHEN buyer_merchant_id IS NOT NULL THEN merchant_id
      WHEN type = 'buy'::offer_type        THEN merchant_id
      ELSE                                       user_id
    END AS seller_id
  FROM orders
  WHERE escrow_tx_hash IS NOT NULL
)
UPDATE orders o
SET escrow_debited_entity_type = d.seller_type,
    escrow_debited_entity_id   = d.seller_id
FROM derived d
WHERE o.id = d.id
  AND (
    o.escrow_debited_entity_id IS NULL
    OR o.escrow_debited_entity_id <> d.seller_id
    OR o.escrow_debited_entity_type IS DISTINCT FROM d.seller_type
  );
