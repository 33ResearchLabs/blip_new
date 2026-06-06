-- Migration 156: Add escalation support to issues table
-- Adds: escalated_department (which team the ticket was routed to),
--        escalated_at (when escalation happened),
--        resolution_note (the message shown to the user when resolved)

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS escalated_department TEXT
    CHECK (escalated_department IN ('risk', 'finance', 'compliance', 'engineering', 'legal', 'operations')),
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- Index for quickly finding escalated tickets per department
CREATE INDEX IF NOT EXISTS idx_issues_escalated_department
  ON issues (escalated_department)
  WHERE escalated_department IS NOT NULL;
