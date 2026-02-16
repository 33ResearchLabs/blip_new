-- Add bio column to merchants for profile page
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS bio TEXT;
