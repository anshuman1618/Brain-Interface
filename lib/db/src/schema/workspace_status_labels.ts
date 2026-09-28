import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Statuses a chamber added to the standard workflow list.
 *
 * Deliberately the same shape as `case_stage_labels`, because it is the same
 * problem: a controlled vocabulary the product ships defaults for and a
 * chamber has to be able to extend, or it decays into free text in the title.
 *
 * ── Status is not stage, and this table is not that one ───────────────────
 *
 * `stage` is the phase of the matter — petition, counter affidavit, orders —
 * and depends on the forum, which is why `case_stage_labels` is scoped to a
 * forum group. `status` is workflow: is anyone working on this. That does not
 * vary by forum, so this table is scoped to the workspace alone. A chamber
 * that adds "On hold" wants it on every matter it has, not on its writs.
 *
 * The four standard statuses — open, in_progress, review, closed — are NOT
 * rows here. They live in `artifacts/api-server/src/lib/case-statuses.ts` for
 * the reason the standard stages live in code: they are identical in every
 * chamber, and seeding four rows per workspace would mean four rows to migrate
 * every time one of them is reworded.
 *
 * Nothing deletes from here, same as stages. A status matters already carry
 * cannot be removed without leaving them under a heading with no name, and the
 * honest fix for a mistyped status is to move the matters off it.
 */
export const workspaceStatusLabelsTable = pgTable(
  "workspace_status_labels",
  {
    id: serial("id").primaryKey(),
    /** Tenant boundary. Every read is filtered by the caller's verified workspace. */
    workspaceId: integer("workspace_id").notNull(),
    /** Slug written by `statusKey()`. This is what `cases.status` stores. */
    key: text("key").notNull(),
    /** What the chip reads, as the chamber typed it. */
    label: text("label").notNull(),
    /**
     * Where it sits relative to the standard statuses. Defaults past the end of
     * the standard list so an addition lands after "closed" rather than in the
     * middle of a sequence people read in order.
     */
    position: integer("position").notNull().default(900),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("workspace_status_labels_ws_key").on(t.workspaceId, t.key)],
);

export const insertWorkspaceStatusLabelSchema = createInsertSchema(workspaceStatusLabelsTable).omit(
  {
    id: true,
    createdAt: true,
  },
);
export type InsertWorkspaceStatusLabel = z.infer<typeof insertWorkspaceStatusLabelSchema>;
export type WorkspaceStatusLabel = typeof workspaceStatusLabelsTable.$inferSelect;
