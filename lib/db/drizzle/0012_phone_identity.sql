-- Sign in with a mobile number, and be admitted by one.
--
-- Until now a person WAS a verified email address: the access list matched on
-- it, invites were addressed to it, and a Clerk account carrying only a phone
-- resolved to users.email = '' and dead-ended on Access Denied for good.
--
-- Two columns is the whole schema change. `workspace_access_list.kind` is a
-- plain text column whose unique key is already (workspace_id, kind, value),
-- so the new 'phone' kind needed no migration at all — it slots into the key
-- that was already there.
--
-- Additive and idempotent, per the rule in CLAUDE.md. Both columns mirror the
-- existing `users.email` idiom exactly — NOT NULL defaulting to '' — so a row
-- holding one identifier and not the other needs no special case in any query,
-- and no backfill is required or possible.
--
-- Deliberately NOT unique, again matching `users.email`. The identity anchor
-- is `users.clerk_id`; email and phone are what the access list matches on,
-- and uniqueness on either would turn two Clerk accounts sharing a recycled
-- number into a failed insert rather than two distinct, separately-admitted
-- identities.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text DEFAULT '' NOT NULL;

-- An invite is addressed to exactly one of email / phone; the other is ''.
-- `email` keeps NOT NULL and gains a default instead of becoming nullable,
-- which is what keeps this migration additive — nothing is dropped or retyped.
ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "phone" text DEFAULT '' NOT NULL;
ALTER TABLE "invites" ALTER COLUMN "email" SET DEFAULT '';

-- Sign-in resolves an identity to its grants on every request, so the phone
-- lookup is on the hot path exactly as the email one is.
CREATE INDEX IF NOT EXISTS "users_phone_idx" ON "users" ("phone");
