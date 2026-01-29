-- Reset/Clear Blip.money Database
-- This script removes all data while keeping the schema intact

-- Disable triggers temporarily for faster deletion
SET session_replication_role = 'replica';

-- Clear all data in order (respecting foreign key constraints)
TRUNCATE TABLE
  chat_messages,
  order_events,
  reviews,
  disputes,
  orders,
  merchant_offers,
  user_bank_accounts,
  merchants,
  users
CASCADE;

-- Re-enable triggers
SET session_replication_role = 'origin';

-- Reset sequences if any
-- Note: UUID-based tables don't use sequences

-- Optional: Clear compliance team as well (uncomment if needed)
-- TRUNCATE TABLE compliance_team CASCADE;

-- Verify all tables are empty
SELECT 'users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'merchants', COUNT(*) FROM merchants
UNION ALL
SELECT 'merchant_offers', COUNT(*) FROM merchant_offers
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'order_events', COUNT(*) FROM order_events
UNION ALL
SELECT 'chat_messages', COUNT(*) FROM chat_messages
UNION ALL
SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL
SELECT 'disputes', COUNT(*) FROM disputes
UNION ALL
SELECT 'user_bank_accounts', COUNT(*) FROM user_bank_accounts;
