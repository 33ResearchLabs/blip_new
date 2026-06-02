-- Support chat tables

CREATE TABLE IF NOT EXISTS support_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'merchant'
  actor_id TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'open',      -- 'open' | 'resolved'
  subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_admin INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES support_sessions(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,  -- 'user' | 'admin'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS support_sessions_actor ON support_sessions(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS support_sessions_status ON support_sessions(status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_session ON support_messages(session_id, created_at ASC);