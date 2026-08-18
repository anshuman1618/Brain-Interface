import { pgTable, text, serial, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One row of a court's published cause list, as fetched.
 *
 * GLOBAL, like `courts` and for the same reason: this is a public document,
 * identical for every chamber that appears in it. See `courts` for the full
 * argument. Chambers never read this table directly — they read
 * `cause_list_matches`, which is workspace-scoped and only ever names matters
 * they already hold.
 *
 * `rawText` is kept alongside the parsed fields on purpose. A cause list is
 * the document that decides whether an advocate has to be in a courtroom
 * tomorrow, so when the parsed fields and the advocate's memory disagree,
 * somebody has to be able to read what the page actually said. It is also the
 * only way to debug a parser against a list that has since been replaced by
 * the next day's — court sites rarely keep an archive.
 */
export const causeListEntriesTable = pgTable(
  "cause_list_entries",
  {
    id: serial("id").primaryKey(),
    courtId: integer("court_id").notNull(),
    /** The day this list is FOR (YYYY-MM-DD), not the day it was fetched. */
    listDate: text("list_date").notNull(),

    /** Case identity, as printed. */
    caseType: text("case_type").notNull().default(""),
    /** Normalised by `normaliseCaseType` at write time — this is what matching compares. */
    caseTypeNorm: text("case_type_norm").notNull().default(""),
    caseNumber: integer("case_number"),
    caseYear: integer("case_year"),

    /** Parties as printed, e.g. "Ram Prasad vs State of U.P.". Free text: formats vary wildly. */
    parties: text("parties").notNull().default(""),
    /** Court room number, where the list gives one. */
    courtNo: text("court_no").notNull().default(""),
    /** Serial position in the day's list — what an advocate uses to judge when to be there. */
    itemNo: text("item_no").notNull().default(""),
    /** The bench, as printed. */
    coram: text("coram").notNull().default(""),
    /** Listing stage, where given: "For Admission", "For Hearing", "For Orders". */
    purpose: text("purpose").notNull().default(""),

    /** The row exactly as it was read, before parsing. See the note above. */
    rawText: text("raw_text").notNull().default(""),

    /**
     * Stable identity of this row within its list, from the adapter. Used to
     * make a re-fetch idempotent: courts republish a list several times a day
     * as items move, and re-running the sync must update rows rather than
     * accumulate copies of them.
     */
    sourceKey: text("source_key").notNull(),
    /** Which sync run last wrote this row — joins to `cause_list_sync_runs`. */
    syncRunId: integer("sync_run_id"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A court's list for a day cannot contain the same source key twice; this
    // is what makes re-fetching an update instead of a duplicate.
    unique("cause_list_entries_court_date_key").on(t.courtId, t.listDate, t.sourceKey),
    // The matcher's hot path: everything listed for a court on a date.
    index("cause_list_entries_court_date_idx").on(t.courtId, t.listDate),
  ],
);

export const insertCauseListEntrySchema = createInsertSchema(causeListEntriesTable).omit({
  id: true,
  fetchedAt: true,
});
export type InsertCauseListEntry = z.infer<typeof insertCauseListEntrySchema>;
export type CauseListEntry = typeof causeListEntriesTable.$inferSelect;
