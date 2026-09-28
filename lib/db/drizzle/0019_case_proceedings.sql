-- Proceedings under a matter: applications, appeals, executions.
--
-- A matter is not one flat thing. A writ petition spawns a stay application, a
-- contempt, an appeal; each has its own number, its own dates and its own
-- progress, and until now they were recorded by typing them into the matter's
-- title or leaving them in somebody's head.
--
-- NOT a child row in `cases`, and that is the decision worth reading. A case
-- carries a client, a filing reference, billing, plan quota, a conflict
-- acknowledgement and an access pin; an interlocutory application has none of
-- those independently of its matter. Making it a case would mean every list,
-- count, quota and access scope learning to tell a parent from a child — and
-- getting one wrong either doubles a chamber's matter count or leaks a child
-- past a pin.
--
-- So this table is thin, and a proceeding inherits visibility from its matter:
-- whoever may see the matter may see its proceedings. That is enforced by
-- loading the matter through `getVisibleCase` first, never by this table's own
-- ids.
--
-- `status` and `stage` hold keys from the vocabularies a chamber already has
-- (migrations 0016 and 0017) rather than inventing a third for the same two
-- questions.
--
-- Additive and guarded, like every migration here.
CREATE TABLE IF NOT EXISTS case_proceedings (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  case_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'application',
  status TEXT NOT NULL DEFAULT 'open',
  stage TEXT,
  filing_ref TEXT,
  filed_on DATE,
  decided_on DATE,
  note TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The only read is "the proceedings on this matter".
CREATE INDEX IF NOT EXISTS case_proceedings_case_idx ON case_proceedings (case_id);
