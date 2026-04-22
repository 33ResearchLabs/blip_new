-- User-initiated issue reports (manual bug reports / feedback).
-- PURELY ADDITIVE: no changes to any existing table.
-- Distinct from error_logs (which is for auto-captured errors).
-- Gated by ENABLE_ISSUE_REPORTING env flag on the server.

CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- User-provided summary (required, ≤ 200 chars)
  title VARCHAR(200) NOT NULL,
  -- Fixed taxonomy of issue categories
  category VARCHAR(32) NOT NULL DEFAULT 'other'
    CHECK (category IN ('ui_bug', 'backend', 'payment', 'performance', 'other')),
  -- User-provided detail (required, ≤ 500 chars per spec)
  description TEXT NOT NULL,
  -- Cloudinary URL of the annotated screenshot. NULL if user opted out.
  screenshot_url VARCHAR(2048),
  -- Extra attachments (images, videos, logs) stored as
  -- [{url, name, mime, size_bytes}, ...]
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Lifecycle status
  status VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  -- Triage priority
  priority VARCHAR(16) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  -- Where the report came from — 'manual' for user-initiated, 'auto' reserved
  -- for a future merger with the auto-error pipeline.
  source VARCHAR(16) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto')),
  -- Submitting actor — nullable so pre-login users can still file reports.
  -- actor_type identifies whether the id refers to users(id) or merchants(id).
  created_by UUID,
  actor_type VARCHAR(16)
    CHECK (actor_type IS NULL OR actor_type IN ('user', 'merchant', 'compliance', 'anonymous')),
  -- Auto-collected context: route, userAgent, screenSize, timestamp, etc.
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Internal admin notes (append-only from UI, stored as
  -- [{note, author, at}, ...]).
  admin_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100)
);

-- Indexes for the admin triage view's common filters.
CREATE INDEX IF NOT EXISTS idx_issues_created_at
  ON issues (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issues_status_created
  ON issues (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issues_category_created
  ON issues (category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issues_priority_created
  ON issues (priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issues_source_created
  ON issues (source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issues_created_by
  ON issues (created_by, created_at DESC)
  WHERE created_by IS NOT NULL;
