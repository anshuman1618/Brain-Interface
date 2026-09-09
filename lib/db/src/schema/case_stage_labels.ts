import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Stages a chamber added to the standard list for a forum group.
 *
 * The standard stages themselves are NOT rows here. They live in
 * `artifacts/api-server/src/lib/case-stages.ts` as code, because they are the
 * same in every chamber in the country — a writ petition is answered by a
 * counter affidavit whoever is arguing it — and seeding an identical thirty
 * rows per workspace would mean thirty rows to migrate every time the wording
 * of one of them is corrected. This table holds only the additions: the stage
 * a chamber has that the standard list does not.
 *
 * Scoped to a workspace AND a forum group, not to a matter. A chamber that
 * adds "Caveat" to its writ list wants it on the next writ petition too;
 * adding it per matter would mean re-adding it every time, which is how a
 * controlled vocabulary decays back into free text.
 *
 * `key` is what a document stores. It is generated from the label by
 * `stageKey()` and made unique per (workspace, forum group), so a chamber
 * cannot end up with two stages that render identically and sort apart.
 *
 * Nothing deletes from here. A stage label that documents already carry cannot
 * be removed without orphaning them under a heading with no name, and the
 * honest fix for a mistyped stage is to relabel the documents — which the
 * document PATCH already does — rather than to delete the vocabulary out from
 * under them.
 */
export const caseStageLabelsTable = pgTable(
  "case_stage_labels",
  {
    id: serial("id").primaryKey(),
    /** Tenant boundary. Every read is filtered by the caller's verified workspace. */
    workspaceId: integer("workspace_id").notNull(),
    /** One of FORUM_GROUPS. Free text at the column level so a new group is a
     *  code change, not a migration. */
    forumGroup: text("forum_group").notNull(),
    /** Slug written by `stageKey()`. This is what `documents.stage` stores. */
    key: text("key").notNull(),
    /** What the heading reads, as the chamber typed it. */
    label: text("label").notNull(),
    /**
     * Where it sits relative to the standard stages. Defaults past the end of
     * every standard list, so an addition lands at the bottom rather than
     * silently in the middle of a sequence somebody relies on reading in order.
     */
    position: integer("position").notNull().default(900),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("case_stage_labels_ws_forum_key").on(t.workspaceId, t.forumGroup, t.key)],
);

export const insertCaseStageLabelSchema = createInsertSchema(caseStageLabelsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCaseStageLabel = z.infer<typeof insertCaseStageLabelSchema>;
export type CaseStageLabel = typeof caseStageLabelsTable.$inferSelect;
