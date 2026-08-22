-- A mobile number as a second way to be admitted.
--
-- Until now email was the only bridge from "authenticated" to "authorized":
-- workspace_access_list.value compared by equality against a Clerk-verified
-- address. A clerk or client with a phone and no work address could sign in
-- and reach nothing. These columns widen that seam.
--
-- users.phone is E.164 and deliberately NOT unique, matching users.email.
--
-- invites.email drops NOT NULL because an invite may now name a number
-- instead. Nothing is dropped or retyped and no row is touched; the route
-- enforces that exactly one of the two is present.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" text;
CREATE INDEX IF NOT EXISTS "users_phone_idx" ON "users" ("phone");

ALTER TABLE "invites" ADD COLUMN IF NOT EXISTS "phone" text;
ALTER TABLE "invites" ALTER COLUMN "email" DROP NOT NULL;
