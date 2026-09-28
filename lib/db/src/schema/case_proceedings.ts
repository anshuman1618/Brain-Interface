import { pgTable, text, serial, integer, date, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A proceeding hanging off a matter: an application, an appeal, an execution.
 *
 * ── Why this is not a child case ──────────────────────────────────────────
 *
 * The obvious implementation is `cases.parent_case_id`, and it is the wrong
 * one here. A `cases` row carries a client, a filing reference, billing, plan
 * quota, conflict acknowledgement and an access pin — and an interlocutory
 * application has none of those independently of the matter it belongs to. It
 * is the same client, the same file, the same people. Making it a case would
 * mean every list, every count, every plan quota and every access scope in the
 * application learning to tell a parent from a child, and getting one of them
 * wrong doubles a chamber's matter count or leaks a child past a pin.
 *
 * So a proceeding is deliberately thin. It has a title, a kind, its own
 * progress and its own dates, and it inherits everything else from its matter:
 * whoever may see the matter may see its proceedings, and nobody else. That
 * inheritance is enforced by loading the matter through `getVisibleCase`
 * before touching anything here, never by checking this table's own ids.
 *
 * ── Status and stage are the matter's vocabularies, not new ones ─────────
 *
 * `status` is a key from the chamber's case-status list and `stage` from the
 * matter's forum-group stage list. A third vocabulary for the same two
 * questions would be one more thing to define per chamber and one more place
 * for the same word to mean two things.
 */

/**
 * What kind of proceeding it is.
 *
 * A closed list in code, not a chamber vocabulary: unlike status and stage,
 * these are categories of thing rather than positions in a workflow, and they
 * are the same in every chamber in the country. `misc` exists so the list
 * never blocks recording something real.
 */
export const PROCEEDING_KINDS = [
  "application",
  "appeal",
  "execution",
  "review",
  "caveat",
  "contempt",
  "misc",
] as const;
export type ProceedingKind = (typeof PROCEEDING_KINDS)[number];

export function isProceedingKind(value: unknown): value is ProceedingKind {
  return typeof value === "string" && (PROCEEDING_KINDS as readonly string[]).includes(value);
}

export const caseProceedingsTable = pgTable(
  "case_proceedings",
  {
    id: serial("id").primaryKey(),
    /**
     * Tenant boundary, denormalised from the matter.
     *
     * Redundant with `caseId` and kept anyway: every other table in this
     * schema filters on `workspace_id`, and a proceedings query that had to
     * join `cases` to establish the tenant is one refactor away from somebody
     * dropping the join. The column makes the boundary checkable in the same
     * shape as everywhere else.
     */
    workspaceId: integer("workspace_id").notNull(),
    caseId: integer("case_id").notNull(),
    title: text("title").notNull(),
    /** One of PROCEEDING_KINDS. Free text at the column level so a new kind is
     *  a code change rather than a migration. */
    kind: text("kind").notNull().default("application"),
    /** A key from the chamber's case-status list — see `case-statuses.ts`. */
    status: text("status").notNull().default("open"),
    /** A key from the matter's stage list, or null. See `case-stages.ts`. */
    stage: text("stage"),
    /** The court's number for the proceeding, where it has one of its own. */
    filingRef: text("filing_ref"),
    filedOn: date("filed_on", { mode: "string" }),
    /** When it was disposed of. Null while it is live. */
    decidedOn: date("decided_on", { mode: "string" }),
    note: text("note"),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  // The only read is "the proceedings on this matter", in filing order.
  (t) => [index("case_proceedings_case_idx").on(t.caseId)],
);

export const insertCaseProceedingSchema = createInsertSchema(caseProceedingsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCaseProceeding = z.infer<typeof insertCaseProceedingSchema>;
export type CaseProceeding = typeof caseProceedingsTable.$inferSelect;
