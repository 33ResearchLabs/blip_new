-- Migration: Add extension_minutes column to orders table
-- Date: 2026-03-14
-- Description: Stores the total extension time granted to an order.
--              Without this column, extension endpoints return 500.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS extension_minutes INTEGER DEFAULT 15;
