import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Time logged against a matter.
 *
 * There was no time capture in this product at all before this table: no hours,
 * no durations, no rates, nothing. Every "effort" figure on the KPI page is
 * computed from these rows, and from nothing else — the alternative was to
 * proxy effort with task counts, which would have produced a number that looks
 * like hours, is labelled like hours, and is not hours.
 *
 * MINUTES, not hours. Integer minutes are exact; hours as a float are not, and
 * a timer that runs for 20 minutes should not be stored as 0.33333.
 *
 * `startedAt` is set only by the running timer and cleared when it stops. A row
 * with a null `startedAt` and a positive `minutes` is a finished entry; a row
 * with a non-null `startedAt` and zero `minutes` is a timer still running. The
 * partial index below keeps "does this member have a timer going" a cheap
 * lookup rather than a scan.
 */
export const timeEntriesTable = pgTable(
  "time_entries",
  {
    id: serial("id").primaryKey(),
    /** Tenant boundary. Every read is filtered by the caller's verified workspace. */
    workspaceId: integer("workspace_id").notNull(),
    caseId: integer("case_id").notNull(),
    /** users.id of whoever did the work. */
    userId: integer("user_id").notNull(),
    clerkId: text("clerk_id").notNull(),
    /** Denormalised so a report reads without joining, and survives a name change. */
    userName: text("user_name").notNull().default(""),
    /** The day the work happened — not the day it was typed in. */
    workDate: date("work_date").notNull(),
    /** Exact. Zero only while a timer is still running. */
    minutes: integer("minutes").notNull().default(0),
    description: text("description"),
    /**
     * Whether this time is chargeable. Drives the billable/non-billable ratio on
     * the KPI page and, later, which entries an invoice may draw from.
     */
    billable: boolean("billable").notNull().default(true),
    /** Set while a timer runs, null once it is stopped. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Every KPI query filters by workspace and then by date. Without this the
    // aggregates degrade into a full scan as soon as a chamber has real volume.
    index("time_entries_workspace_date_idx").on(t.workspaceId, t.workDate),
    index("time_entries_case_idx").on(t.caseId),
    index("time_entries_user_date_idx").on(t.userId, t.workDate),
  ],
);

export const insertTimeEntrySchema = createInsertSchema(timeEntriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntriesTable.$inferSelect;
