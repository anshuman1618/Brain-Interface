-- Push notifications: the handsets, and every message aimed at one.
--
-- Two tables for the reason mail already has two. A token is an ADDRESS and a
-- message is an ATTEMPT to reach one, so revoking a device must not erase the
-- record of what was sent to it.
--
-- `device_tokens` is keyed (workspace_id, token), not (user_id, token). A
-- person can hold memberships in several chambers, and a reminder about
-- chamber A's hearing must go to the registration made while working in A —
-- the same tenant boundary every other table carries, applied to a lock
-- screen. The unique constraint is what makes re-registration an UPSERT: the
-- OS reissues a token on reinstall and on restore to a new handset, so the app
-- registers on every launch, and without this each launch would add a row and
-- every reminder would go out N times.
--
-- `push_outbox` mirrors `mail_outbox` down to the five statuses and the retry
-- ladder. Deliberately, not by inertia: a second delivery channel with a
-- different failure model would mean two places to look when somebody says
-- they were never told.
--
-- Additive and guarded throughout, like every migration here. Nothing is
-- dropped, retyped or backfilled.

CREATE TABLE IF NOT EXISTS device_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  workspace_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE
);

DO $$ BEGIN
  ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_ws_token_key UNIQUE (workspace_id, token);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS device_tokens_user_idx ON device_tokens (user_id);
CREATE INDEX IF NOT EXISTS device_tokens_workspace_idx ON device_tokens (workspace_id);

CREATE TABLE IF NOT EXISTS push_outbox (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER,
  user_id INTEGER,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'notice',
  status TEXT NOT NULL DEFAULT 'queued',
  transport TEXT NOT NULL DEFAULT '',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP WITH TIME ZONE,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP WITH TIME ZONE
);

-- The drain's own query: due messages, oldest first.
CREATE INDEX IF NOT EXISTS push_outbox_due_idx ON push_outbox (status, next_attempt_at);
