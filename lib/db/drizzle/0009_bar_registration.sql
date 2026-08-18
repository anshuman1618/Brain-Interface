-- Self-declared bar credentials for admin, senior_advocate and junior_advocate.
--
-- Additive, nullable, no validation at the database layer — enrolment formats
-- vary by state bar, so the app stores what is typed and validates loosely.
-- bar_declared_at is named for what it is: self-declaration, never checked
-- against a bar council.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bar_council_state" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bar_enrolment_no" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aor_no" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bar_declared_at" timestamptz;
