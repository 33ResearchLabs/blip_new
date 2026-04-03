-- Migration 069: Device Tracking + Risk Events + Blacklist System
-- Adds device fingerprinting, IP tracking, risk event logging, and blacklist enforcement.
-- All tables are new — zero impact on existing tables.

BEGIN;

-- ============================================================================
-- 1. DEVICES TABLE — stores unique device fingerprints
-- ============================================================================
CREATE TABLE IF NOT EXISTS devices (
  device_id          VARCHAR(64) PRIMARY KEY,         -- SHA-256 hash of fingerprint
  fingerprint_raw    TEXT,                             -- debug only (hashed client-side, this is the hash)
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_accounts    INTEGER NOT NULL DEFAULT 1,
  risk_score         INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  metadata           JSONB DEFAULT '{}'::jsonb         -- browser, os, screen, etc.
);

-- ============================================================================
-- 2. DEVICE_USERS — links devices to users/merchants (many-to-many)
-- ============================================================================
CREATE TABLE IF NOT EXISTS device_users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id          VARCHAR(64) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  entity_id          UUID NOT NULL,                    -- user or merchant ID
  entity_type        VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'merchant')),
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(device_id, entity_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_device_users_entity ON device_users(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_device_users_device ON device_users(device_id);

-- ============================================================================
-- 3. IP_LOGS — per-request IP logging
-- ============================================================================
CREATE TABLE IF NOT EXISTS ip_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          UUID NOT NULL,
  entity_type        VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'merchant')),
  ip                 VARCHAR(45) NOT NULL,             -- supports IPv6
  action             VARCHAR(50) NOT NULL DEFAULT 'login', -- login, order_create, etc.
  user_agent         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_logs_entity ON ip_logs(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_ip_logs_ip ON ip_logs(ip);
CREATE INDEX IF NOT EXISTS idx_ip_logs_created ON ip_logs(created_at);

-- ============================================================================
-- 4. IP_STATS — aggregated IP usage stats (updated by worker)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ip_stats (
  ip                 VARCHAR(45) PRIMARY KEY,
  usage_count        INTEGER NOT NULL DEFAULT 1,
  unique_users       INTEGER NOT NULL DEFAULT 1,
  first_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_flagged         BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================================
-- 5. RISK_EVENTS — fraud signal log
-- ============================================================================
CREATE TABLE IF NOT EXISTS risk_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          UUID NOT NULL,
  entity_type        VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'merchant', 'device', 'ip')),
  event_type         VARCHAR(50) NOT NULL,              -- multi_account_device, ip_cluster_detected, etc.
  severity           VARCHAR(10) NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  metadata           JSONB DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_events_entity ON risk_events(entity_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_risk_events_type ON risk_events(event_type);
CREATE INDEX IF NOT EXISTS idx_risk_events_severity ON risk_events(severity);
CREATE INDEX IF NOT EXISTS idx_risk_events_created ON risk_events(created_at);

-- ============================================================================
-- 6. BLACKLIST — blocked entities
-- ============================================================================
CREATE TABLE IF NOT EXISTS blacklist (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          VARCHAR(128) NOT NULL,             -- user_id, device_id, IP, wallet address
  entity_type        VARCHAR(20) NOT NULL CHECK (entity_type IN ('user', 'merchant', 'device', 'ip', 'wallet')),
  reason             TEXT NOT NULL,
  severity           VARCHAR(10) NOT NULL DEFAULT 'hard' CHECK (severity IN ('soft', 'hard')),
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_by         VARCHAR(128),                      -- admin/system/compliance who added it
  expires_at         TIMESTAMPTZ,                       -- NULL = permanent
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(entity_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_blacklist_active ON blacklist(entity_type, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_blacklist_entity ON blacklist(entity_id);

-- ============================================================================
-- 7. Add cancelled_orders, dispute_count columns to users and merchants
--    These are additive columns — no existing data changes.
-- ============================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS cancelled_orders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dispute_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avg_completion_time_ms INTEGER;

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS cancelled_orders INTEGER NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS dispute_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS avg_completion_time_ms INTEGER;

COMMIT;
