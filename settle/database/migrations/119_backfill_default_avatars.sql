-- Backfill DiceBear default avatars for existing users / merchants.
--
-- New rows get a default via the application code (lib/avatars.ts). This
-- one-shot migration paints the same default onto pre-existing rows that
-- still have NULL or empty avatar_url, so historical accounts also show
-- a picture instead of the generic placeholder.
--
-- Seed: username (preferred), falling back to email or wallet_address.
-- Style: adventurer (matches the on-app picker on /merchant/settings).
--
-- Idempotent — only writes rows where avatar_url is currently absent,
-- and re-running is a no-op once everyone has a value.

UPDATE users
   SET avatar_url = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' ||
                    COALESCE(NULLIF(TRIM(username), ''),
                             NULLIF(LOWER(TRIM(email)), ''),
                             NULLIF(TRIM(wallet_address), ''),
                             'anonymous')
 WHERE avatar_url IS NULL OR TRIM(avatar_url) = '';

UPDATE merchants
   SET avatar_url = 'https://api.dicebear.com/7.x/adventurer/svg?seed=' ||
                    COALESCE(NULLIF(TRIM(username), ''),
                             NULLIF(LOWER(TRIM(email)), ''),
                             NULLIF(TRIM(wallet_address), ''),
                             'anonymous')
 WHERE avatar_url IS NULL OR TRIM(avatar_url) = '';
