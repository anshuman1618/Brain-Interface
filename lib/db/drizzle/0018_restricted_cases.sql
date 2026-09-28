-- Many matters per pinned grant.
--
-- "Restrict to Case ID" pinned an access-list entry, and the membership it
-- creates, to exactly ONE matter: a single `case_id` column on each, typed
-- into a free-text box. A client with three matters at the chamber needed
-- three invitations, or saw one matter and rang up about the others.
--
-- Two tables and not one, because there are two objects with two lifetimes.
-- The access-list row is the standing grant an admin wrote in advance; the
-- membership is the real thing created on first sign-in, and it is what
-- `lib/scope.ts` enforces from. The set is copied across at reconcile, exactly
-- as the single column already was.
--
-- THE LEGACY COLUMNS STAY, and keep receiving the first matter of the set.
-- They are no longer the source of truth, but if a read path is missed,
-- restricting to one matter of three is narrower than intended rather than
-- wider — a missed read that fails open is a data leak, one that fails closed
-- is a support ticket. That asymmetry is why nothing is dropped here.
--
-- It also means no backfill: every membership that existed before this keeps
-- working with no rows in these tables, one `case_id`, and a resolver that
-- falls back to it.
--
-- Additive and guarded, like every migration here.
CREATE TABLE IF NOT EXISTS access_list_cases (
  id SERIAL PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  CONSTRAINT access_list_cases_entry_case_key UNIQUE (entry_id, case_id)
);

CREATE TABLE IF NOT EXISTS membership_cases (
  id SERIAL PRIMARY KEY,
  membership_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  CONSTRAINT membership_cases_membership_case_key UNIQUE (membership_id, case_id)
);

-- Read on every request that resolves a restricted caller's scope.
CREATE INDEX IF NOT EXISTS access_list_cases_entry_idx ON access_list_cases (entry_id);
CREATE INDEX IF NOT EXISTS membership_cases_membership_idx ON membership_cases (membership_id);
