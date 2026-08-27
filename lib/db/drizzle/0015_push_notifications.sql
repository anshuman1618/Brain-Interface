-- Reaching somebody who is not looking at the app.
--
-- Two channels already existed: the in-app bell (a `notifications` row, polled
-- every thirty seconds) and email (`mail_outbox`, written BEFORE the transport
-- is called so a failure stays visible). Push is the third, and it is built to
-- the same shape as the second on purpose. The things this system notifies
-- about are filing deadlines and hearing dates; a message that failed to send
-- must not become a log line nobody reads.
--
-- Additive and idempotent. Nothing existing is touched.

CREATE TABLE IF NOT EXISTS "device_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  -- Per chamber, not per person. This column IS the tenant boundary for push:
  -- a notification for chamber A can only ever select a row naming A, so the
  -- send path never has to infer the boundary from a message's contents.
  "workspace_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "clerk_id" text DEFAULT '' NOT NULL,
  -- The FCM registration token. Not stable: the OS reissues it on reinstall,
  -- on restore to a new handset, and sometimes unprompted — which is why the
  -- app re-registers every launch and this is written upsert-style.
  "token" text NOT NULL,
  "platform" text DEFAULT '' NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  -- Set, never deleted, so "they had notifications switched off" stays
  -- answerable after the fact.
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  -- One handset signed into two chambers legitimately holds two rows; the same
  -- handset re-registering in one chamber must update rather than accumulate.
  CONSTRAINT "device_tokens_ws_token_key" UNIQUE("workspace_id","token")
);

-- The send loop asks "which live devices belong to this user in this chamber"
-- on every notification.
CREATE INDEX IF NOT EXISTS "device_tokens_ws_user_idx"
  ON "device_tokens" ("workspace_id","user_id");

CREATE TABLE IF NOT EXISTS "push_outbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "workspace_id" integer,
  "device_token_id" integer NOT NULL,
  -- Copied at queue time: the device row may be revoked before this drains,
  -- and the attempt should still record where it was addressed.
  "token" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "link" text DEFAULT '' NOT NULL,
  "kind" text DEFAULT 'notice' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "transport" text DEFAULT '' NOT NULL,
  "error" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamptz,
  "last_attempt_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "sent_at" timestamptz
);

-- The drain selects failed messages whose retry is due, once a minute.
CREATE INDEX IF NOT EXISTS "push_outbox_status_next_idx"
  ON "push_outbox" ("status","next_attempt_at");
