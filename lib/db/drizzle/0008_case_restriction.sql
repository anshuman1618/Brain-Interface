-- "Restrict to Case ID" gets somewhere to live.
--
-- Both columns are nullable and additive. A client invite pins case_id on the
-- access-list entry; reconcileAccessList copies it onto the membership, which
-- is what lib/scope.ts actually reads to narrow visibility. No foreign key —
-- this codebase validates cross-table references in application code
-- (caseInWorkspace), not with constraints, and that stays consistent here.

ALTER TABLE "workspace_access_list" ADD COLUMN IF NOT EXISTS "case_id" integer;
ALTER TABLE "workspace_memberships" ADD COLUMN IF NOT EXISTS "case_id" integer;
