-- Migration 050: Schema Migrations Tracking Table
--
-- Creates a table to track which migrations have been applied,
-- preventing duplicate execution and enabling migration auditing.
--
-- This migration is ADDITIVE — no existing tables modified.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id         SERIAL PRIMARY KEY,
  filename   TEXT UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
