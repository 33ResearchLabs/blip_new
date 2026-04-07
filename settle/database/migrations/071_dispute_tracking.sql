-- Track who initiated a dispute (user or merchant) and their ID
ALTER TABLE orders ADD COLUMN IF NOT EXISTS disputed_by TEXT;         -- 'user' or 'merchant'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS disputed_by_id UUID;     -- actor ID who raised it

-- Backfill existing disputed orders from order_events if possible
-- (Current 3 disputes were auto-resolved by system, no initiator recorded)

COMMENT ON COLUMN orders.disputed_by IS 'Who initiated the dispute: user or merchant';
COMMENT ON COLUMN orders.disputed_by_id IS 'UUID of the user or merchant who raised the dispute';
