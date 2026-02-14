-- =====================================================
-- TRUNCATE ALL DATA - WARNING: THIS IS IRREVERSIBLE
-- =====================================================
-- This script removes all data from all tables while
-- preserving the schema structure and constraints
-- =====================================================

BEGIN;

-- Disable triggers temporarily to avoid cascade issues
SET session_replication_role = 'replica';

-- Truncate all tables in dependency order (child tables first)
TRUNCATE TABLE reviews CASCADE;
TRUNCATE TABLE chat_messages CASCADE;
TRUNCATE TABLE order_events CASCADE;
TRUNCATE TABLE user_bank_accounts CASCADE;
TRUNCATE TABLE disputes CASCADE;
TRUNCATE TABLE orders CASCADE;
TRUNCATE TABLE merchant_offers CASCADE;
TRUNCATE TABLE merchant_contacts CASCADE;
TRUNCATE TABLE direct_messages CASCADE;
TRUNCATE TABLE merchants CASCADE;
TRUNCATE TABLE users CASCADE;
TRUNCATE TABLE compliance_team CASCADE;

-- Re-enable triggers
SET session_replication_role = 'origin';

-- Reset any sequences if they exist
-- (UUID generation doesn't use sequences, but this is for safety)

COMMIT;

-- Verify truncation
SELECT
  'users' AS table_name, COUNT(*) AS count FROM users
UNION ALL
SELECT 'merchants', COUNT(*) FROM merchants
UNION ALL
SELECT 'orders', COUNT(*) FROM orders
UNION ALL
SELECT 'chat_messages', COUNT(*) FROM chat_messages
UNION ALL
SELECT 'order_events', COUNT(*) FROM order_events
UNION ALL
SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL
SELECT 'disputes', COUNT(*) FROM disputes
UNION ALL
SELECT 'user_bank_accounts', COUNT(*) FROM user_bank_accounts
UNION ALL
SELECT 'merchant_offers', COUNT(*) FROM merchant_offers
UNION ALL
SELECT 'merchant_contacts', COUNT(*) FROM merchant_contacts
UNION ALL
SELECT 'direct_messages', COUNT(*) FROM direct_messages
UNION ALL
SELECT 'compliance_team', COUNT(*) FROM compliance_team;

-- Display success message
SELECT '✅ All data truncated successfully!' AS status;
