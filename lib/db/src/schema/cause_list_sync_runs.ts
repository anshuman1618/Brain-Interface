import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One row per attempt to read one court's list for one day.
 *
 * GLOBAL, like the data it describes. This exists because the characteristic
 * failure of a scraper is not crashing — it is quietly returning nothing
 * after the court redesigns a page, while everything downstream keeps working
 * on an empty set and nobody notices for a month. A run that fetched zero
 * rows is recorded exactly as loudly as one that threw, so "the Lucknow list
 * has been empty since the 4th" is a question the database can answer.
 *
 * status:
 *   ok      — the adapter returned rows (possibly zero, legitimately: courts
 *             do not sit every day, and a holiday list is genuinely empty)
 *   failed  — the adapter threw. `error` says what.
 *   skipped — no adapter is registered for this court, so nothing was tried.
 */
export const SYNC_RUN_STATUSES = ["ok", "failed", "skipped"] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

export const causeListSyncRunsTable = pgTable(
  "cause_list_sync_runs",
  {
    id: serial("id").primaryKey(),
    courtId: integer("court_id").notNull(),
    /** Which adapter ran, recorded separately from the court so a court that
     *  changes adapter keeps a readable history. */
    adapter: text("adapter").notNull().default(""),
    /** The day whose list was requested (YYYY-MM-DD). */
    listDate: text("list_date").notNull(),

    status: text("status").notNull().default("ok"),
    /** Rows the adapter returned. */
    fetched: integer("fetched").notNull().default(0),
    /** Rows written — inserted or updated in place on a re-fetch. */
    upserted: integer("upserted").notNull().default(0),
    /** Proposals created across every workspace. Zero is normal and expected:
     *  most of a court's list is other people's matters. */
    proposed: integer("proposed").notNull().default(0),

    error: text("error"),
    /** Wall-clock duration, for noticing a court that has become slow. */
    durationMs: integer("duration_ms").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("cause_list_sync_runs_court_started_idx").on(t.courtId, t.startedAt)],
);

export const insertCauseListSyncRunSchema = createInsertSchema(causeListSyncRunsTable).omit({
  id: true,
  startedAt: true,
});
export type InsertCauseListSyncRun = z.infer<typeof insertCauseListSyncRunSchema>;
export type CauseListSyncRun = typeof causeListSyncRunsTable.$inferSelect;
