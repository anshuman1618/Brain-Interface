import { pgTable, text, serial, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * "Your matter appears to be listed tomorrow." A proposal, never a fact.
 *
 * This is the tenant boundary for the whole cause-list feature: `courts` and
 * `cause_list_entries` are global public data, and this table is where that
 * data becomes something a particular chamber is told about. A row exists
 * only where a scraped listing matched a matter the chamber already holds, so
 * a chamber can never learn anything from this table about a matter that is
 * not theirs.
 *
 * NOTHING here writes to the calendar on its own. A wrong hearing date in a
 * practice-management tool is not a cosmetic bug — a missed listing can mean
 * a matter dismissed for non-appearance — so every proposal is decided by a
 * person, and only accepting one creates a calendar entry. `calendarEntryId`
 * records which entry that was, so an accepted proposal can be traced to the
 * thing it put in front of the advocate.
 *
 * status:
 *   pending   — proposed, nobody has looked at it
 *   accepted  — a person agreed; `calendarEntryId` is the entry it created
 *   dismissed — a person said no. Never re-proposed; see the unique key.
 */
export const CAUSE_LIST_MATCH_STATUSES = ["pending", "accepted", "dismissed"] as const;
export type CauseListMatchStatus = (typeof CAUSE_LIST_MATCH_STATUSES)[number];

/**
 * How the listing was tied to the matter.
 *
 * Only `exact` exists today: court, case type, number and year all agree.
 * The column is here so a future fuzzy matcher — party-name similarity, a
 * number that matches but a type that does not — has somewhere to record how
 * sure it was, and so the review screen can sort by it without a migration.
 */
export const CAUSE_LIST_MATCH_CONFIDENCE = ["exact"] as const;
export type CauseListMatchConfidence = (typeof CAUSE_LIST_MATCH_CONFIDENCE)[number];

export const causeListMatchesTable = pgTable(
  "cause_list_matches",
  {
    id: serial("id").primaryKey(),
    /** Tenant boundary. Every read of this table is filtered by the verified workspace. */
    workspaceId: integer("workspace_id").notNull(),
    causeListEntryId: integer("cause_list_entry_id").notNull(),
    caseId: integer("case_id").notNull(),

    status: text("status").notNull().default("pending"),
    confidence: text("confidence").notNull().default("exact"),

    /** Set only once accepted — the calendar entry this proposal produced. */
    calendarEntryId: integer("calendar_entry_id"),

    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * One proposal per listing per matter. This is what stops a re-sync from
     * nagging: a dismissed proposal stays dismissed, and an accepted one is
     * not offered again, because the sync cannot insert a second row for the
     * same pair.
     */
    unique("cause_list_matches_ws_entry_case_key").on(t.workspaceId, t.causeListEntryId, t.caseId),
    index("cause_list_matches_ws_status_idx").on(t.workspaceId, t.status),
  ],
);

export const insertCauseListMatchSchema = createInsertSchema(causeListMatchesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCauseListMatch = z.infer<typeof insertCauseListMatchSchema>;
export type CauseListMatch = typeof causeListMatchesTable.$inferSelect;

export function isCauseListMatchStatus(v: unknown): v is CauseListMatchStatus {
  return typeof v === "string" && (CAUSE_LIST_MATCH_STATUSES as readonly string[]).includes(v);
}
