-- Chamber-defined case statuses.
--
-- `cases.status` has always been one of four strings the product chose — open,
-- in_progress, review, closed — hardcoded in the frontend as a filter and
-- pinned as an enum in the OpenAPI schema. A chamber that works in stages the
-- product did not anticipate ("On hold", "Awaiting instructions", "Settled")
-- had nowhere to put them but the matter's title.
--
-- Same split as `case_stage_labels` in migration 0016: the standard list stays
-- in code (`artifacts/api-server/src/lib/case-statuses.ts`) because it is
-- identical in every chamber and every matter in production already carries
-- one of those four strings, and this table holds ONLY the additions.
--
-- Not scoped to a forum group, unlike stages. Whether anyone is working on a
-- matter does not depend on which court it is in.
--
-- No column on `cases` changes. `status` stays TEXT with the same default, so
-- every existing row is already valid under the new vocabulary — which is the
-- whole reason the standard four are not seeded here as rows.
--
-- Additive and guarded, like every migration here. Nothing is dropped,
-- retyped or backfilled.
CREATE TABLE IF NOT EXISTS workspace_status_labels (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 900,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_status_labels_ws_key UNIQUE (workspace_id, key)
);

-- Every read is "the statuses this workspace offers".
CREATE INDEX IF NOT EXISTS workspace_status_labels_workspace_idx
  ON workspace_status_labels (workspace_id);
