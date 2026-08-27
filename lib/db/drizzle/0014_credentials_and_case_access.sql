-- Three things: what an advocate must tell us, who may see which matter, and
-- the trial being once per person rather than once per chamber.
--
-- Additive and guarded throughout. Nothing is dropped and nothing is retyped,
-- so this survives a database `drizzle-kit push` has touched.

-- ── Advocate credentials ────────────────────────────────────────────────────
--
-- `bar_council_state`, `bar_enrolment_no`, `aor_no` and `bar_declared_at`
-- already exist. These are the rest of what an Indian advocate is identified by.
--
-- aor_high_court_no is separate from aor_no on purpose: they are different
-- rolls with different numbers, and an advocate may hold either, both or
-- neither. One column would make "which court is this from" unanswerable.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aor_high_court_no" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "cop_no" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "all_india_bar_no" text;

-- When the All India Bar number stops being optional: six months from the
-- first declaration. A date rather than something derived on read, because the
-- window belongs to the person — extending it for somebody whose examination
-- was postponed should be one update, not a code change that moves the
-- deadline for everyone.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "all_india_bar_due_at" timestamptz;

-- ── The trial, once per person ──────────────────────────────────────────────
--
-- On the user, not the subscription. A founder who has used the trial and then
-- creates a second chamber must not get another, and a per-workspace record
-- resets every time somebody founds one. Written by the payment webhook, so it
-- records a payment that happened rather than an intent to pay.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trial_claimed_at" timestamptz;

-- ── Case access ─────────────────────────────────────────────────────────────
--
-- False for every existing row, which is what makes this deploy take access
-- away from nobody. An admin turns it on per member; only then does
-- case_access_grants mean anything for them.
ALTER TABLE "workspace_memberships"
  ADD COLUMN IF NOT EXISTS "case_access_restricted" boolean NOT NULL DEFAULT false;

-- A matter opened to one member. Additive to their row scope: a restricted
-- member sees what they are assigned, plus these, and nothing else.
CREATE TABLE IF NOT EXISTS "case_access_grants" (
  "id" serial PRIMARY KEY,
  "workspace_id" integer NOT NULL,
  "membership_id" integer NOT NULL,
  "case_id" integer NOT NULL,
  "granted_by" text NOT NULL DEFAULT '',
  "granted_by_clerk_id" text NOT NULL DEFAULT '',
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "case_access_grants_membership_case_key" UNIQUE ("membership_id", "case_id")
);
CREATE INDEX IF NOT EXISTS "case_access_grants_membership_idx"
  ON "case_access_grants" ("membership_id");
CREATE INDEX IF NOT EXISTS "case_access_grants_workspace_idx"
  ON "case_access_grants" ("workspace_id");
