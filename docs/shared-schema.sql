-- Shared classroom sandbox only. Do not store real personal or financial data.
CREATE TABLE IF NOT EXISTS sandbox_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  record TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  owner_hash TEXT NOT NULL,
  invite_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  lease_hash TEXT,
  lease_member TEXT,
  lease_expires INTEGER NOT NULL DEFAULT 0,
  join_window INTEGER NOT NULL DEFAULT 0,
  join_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sandbox_members (
  workspace_id TEXT NOT NULL REFERENCES sandbox_workspaces(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, token_hash)
);
CREATE INDEX IF NOT EXISTS sandbox_created ON sandbox_workspaces(created_at);
