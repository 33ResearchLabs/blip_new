-- 086: Chat System v2 — Production-ready improvements
--
-- 1. Denormalize sender_name into chat_messages (eliminates 3-table JOIN)
-- 2. Add metadata JSONB column for extensible payloads
-- 3. Denormalize last-message summary onto orders (O(1) merchant inbox)
-- 4. Compliance audit log table
-- 5. Auto-update trigger for order chat summary
--
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS).

-- ─── 1. sender_name denormalization ─────────────────────────────────────
-- Avoids the 3-way LEFT JOIN (users + merchants + compliance_team) on every
-- message pagination query. Populated at INSERT time by sendMessage().

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS sender_name TEXT DEFAULT NULL;

-- Backfill existing rows (one-time, idempotent — only touches NULLs)
UPDATE chat_messages cm SET sender_name = u.username
  FROM users u
  WHERE cm.sender_type = 'user' AND cm.sender_id = u.id
  AND cm.sender_name IS NULL;

UPDATE chat_messages cm SET sender_name = m.display_name
  FROM merchants m
  WHERE cm.sender_type = 'merchant' AND cm.sender_id = m.id
  AND cm.sender_name IS NULL;

UPDATE chat_messages cm SET sender_name = ct.name
  FROM compliance_team ct
  WHERE cm.sender_type = 'compliance' AND cm.sender_id = ct.id
  AND cm.sender_name IS NULL;

UPDATE chat_messages SET sender_name = 'System'
  WHERE sender_type = 'system' AND sender_name IS NULL;

-- ─── 2. Extensible metadata column ─────────────────────────────────────
-- For payment proof data, compliance notes, action button payloads, etc.
-- Complements the existing receipt_data column (which is receipt-specific).

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- ─── 3. Order-level chat summary (merchant inbox denormalization) ──────
-- The merchant inbox query becomes a single indexed scan on orders —
-- no JOIN to chat_messages or direct_messages needed.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_message_preview TEXT DEFAULT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_message_sender_type VARCHAR(20) DEFAULT NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS chat_closed_at TIMESTAMPTZ DEFAULT NULL;

-- Merchant inbox index: orders sorted by latest message, excluding expired
CREATE INDEX IF NOT EXISTS idx_orders_merchant_inbox
  ON orders (merchant_id, last_message_at DESC NULLS LAST)
  WHERE status NOT IN ('expired');

-- Same for M2M buyer merchants
CREATE INDEX IF NOT EXISTS idx_orders_buyer_merchant_inbox
  ON orders (buyer_merchant_id, last_message_at DESC NULLS LAST)
  WHERE buyer_merchant_id IS NOT NULL AND status NOT IN ('expired');

-- ─── 4. Compliance audit log ───────────────────────────────────────────
-- Tracks every compliance officer action for audit/legal purposes.
-- Separate from order_events which tracks order state changes.

CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id),
  compliance_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  target_message_id UUID REFERENCES chat_messages(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_order
  ON compliance_audit_log (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_actor
  ON compliance_audit_log (compliance_id, created_at DESC);

-- ─── 5. Auto-update order chat summary on new message ──────────────────
-- This trigger fires on every INSERT into chat_messages and updates the
-- denormalized summary fields on the orders table. This means the merchant
-- inbox query never needs to JOIN or subquery chat_messages.

CREATE OR REPLACE FUNCTION update_order_chat_summary()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE orders SET
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(COALESCE(NEW.content, '[attachment]'), 100),
    last_message_sender_type = NEW.sender_type::TEXT
  WHERE id = NEW.order_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_message_summary ON chat_messages;
CREATE TRIGGER trg_chat_message_summary
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_order_chat_summary();

-- ─── 6. Backfill last_message_at for existing orders ───────────────────
-- One-time backfill so existing orders appear in the merchant inbox.

UPDATE orders o SET
  last_message_at = sub.last_at,
  last_message_preview = LEFT(sub.last_content, 100),
  last_message_sender_type = sub.last_sender
FROM (
  SELECT DISTINCT ON (order_id)
    order_id,
    created_at as last_at,
    content as last_content,
    sender_type::TEXT as last_sender
  FROM chat_messages
  ORDER BY order_id, created_at DESC
) sub
WHERE o.id = sub.order_id
  AND o.last_message_at IS NULL;
