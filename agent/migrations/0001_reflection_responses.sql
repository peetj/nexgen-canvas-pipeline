CREATE TABLE IF NOT EXISTS reflection_responses (
  id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  canvas_user_id TEXT NOT NULL,
  canvas_user_name TEXT,
  canvas_user_email TEXT,
  context_id TEXT,
  context_title TEXT,
  resource_link_id TEXT,
  resource_link_title TEXT,
  session_id TEXT,
  session_title TEXT,
  task_id TEXT,
  task_title TEXT,
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reflection_responses_user
  ON reflection_responses (canvas_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reflection_responses_context
  ON reflection_responses (context_id, session_id, task_id, updated_at DESC);
