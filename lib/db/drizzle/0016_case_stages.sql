-- Stages of a matter.
--
-- A matter is not a flat pile of paper: a writ petition is answered by a
-- counter affidavit, which is answered by a rejoinder, and an advocate opening
-- a file wants to see it in that order. Three columns and one table give the
-- vault its headings.
--
-- `cases.forum_group` picks WHICH standard list applies (writ / civil /
-- criminal / tribunal / general). Nullable and never backfilled — the server
-- infers a group from `case_type_norm` when the column is null, so every
-- matter that already exists gets sensible headings without this migration
-- having guessed on its behalf in a row nobody would think to check.
--
-- `cases.stage` is the phase the MATTER is in, which is not `status`: a matter
-- stays "open" while it travels petition -> counter -> rejoinder.
--
-- `documents.stage` is the stage a given paper belongs to. Null means unfiled,
-- which is what every document uploaded before today is, and they group under
-- a trailing heading rather than vanishing.
--
-- `case_stage_labels` holds ONLY the stages a chamber added. The standard ones
-- are code, not rows: they are identical in every chamber, and seeding them
-- per workspace would mean migrating thirty duplicated rows to fix one word.
--
-- Additive and guarded throughout, like every migration here. Nothing is
-- dropped, retyped or backfilled.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS forum_group TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS stage TEXT;

CREATE TABLE IF NOT EXISTS case_stage_labels (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  forum_group TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 900,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT case_stage_labels_ws_forum_key UNIQUE (workspace_id, forum_group, key)
);

CREATE INDEX IF NOT EXISTS case_stage_labels_workspace_idx
  ON case_stage_labels (workspace_id, forum_group);

-- The vault reads documents by matter and groups them by stage. Without this
-- the grouping is a sequential scan per case detail page.
CREATE INDEX IF NOT EXISTS documents_case_stage_idx ON documents (case_id, stage);
