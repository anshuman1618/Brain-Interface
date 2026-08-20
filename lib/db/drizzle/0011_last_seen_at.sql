-- The only record that anyone came back.
--
-- Every other column here records who registered. This one records who
-- returned, which is a different question and the one nothing could answer:
-- the audit log sees privileged writes only, so a person who reads the diary
-- daily and never writes left no trace at all.
--
-- Additive, nullable, no backfill. NULL means "not seen since this shipped",
-- which is the truth and must not be confused with "never signed in".

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;

-- The metrics view asks "how many were seen in the last N days" on every load.
CREATE INDEX IF NOT EXISTS "users_last_seen_at_idx" ON "users" ("last_seen_at");
