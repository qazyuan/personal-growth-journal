CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE entries (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_revision integer NOT NULL CHECK (current_revision >= 1),
  occurred_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('iphone', 'mac_web', 'ipad_web', 'import')),
  mode text NOT NULL CHECK (mode IN ('record_only', 'record_and_analyze')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  ai_policy jsonb NOT NULL DEFAULT '{"instant":true,"reviews":true}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX entries_owner_timeline_idx ON entries(owner_id, occurred_at DESC, id DESC);

CREATE TABLE entry_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision >= 1),
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  content_format text NOT NULL DEFAULT 'plain_text' CHECK (content_format = 'plain_text'),
  base_revision integer,
  created_by_device text,
  content_hash text NOT NULL,
  extra_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entry_id, revision)
);

CREATE INDEX entry_revisions_entry_idx ON entry_revisions(entry_id, revision DESC);

CREATE TABLE client_operations (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  operation_type text NOT NULL,
  entity_id uuid NOT NULL,
  request_hash text NOT NULL,
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, operation_id)
);

INSERT INTO users (id, display_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Local Journal User')
ON CONFLICT (id) DO NOTHING;
