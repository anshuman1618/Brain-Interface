import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Chamber-wide calendar updates: hearings, filings, meetings and notices.
 *
 * The master calendar already draws task deadlines and consultations from their
 * own tables. This table is for everything else the chamber needs on a shared
 * calendar — and, crucially, for entries that are *directed at* someone rather
 * than derived from work they hold.
 *
 * Only Admin and Senior Advocate may write one (`calendar.write`), which is the
 * same boundary as assigning work: those two direct the chamber, everyone else
 * receives.
 *
 * `audience` is how one calendar serves every portal:
 *   all           — everybody in the workspace, clients included
 *   staff         — everyone except clients
 *   role:<role>   — one tier, e.g. "role:clerk_intern"
 *   user:<clerkId> — one person
 * A client never sees a `staff` notice, and a clerk never sees one addressed to
 * an advocate. Filtering happens server-side; see routes/calendar.ts.
 */
export const CALENDAR_ENTRY_KINDS = ["hearing", "filing", "meeting", "note"] as const;
export type CalendarEntryKind = (typeof CALENDAR_ENTRY_KINDS)[number];

export const calendarEntriesTable = pgTable("calendar_entries", {
  id: serial("id").primaryKey(),
  workspaceId: integer("workspace_id").notNull(),
  title: text("title").notNull(),
  notes: text("notes"),
  kind: text("kind").notNull().default("note"),
  /** Date-only (YYYY-MM-DD); the calendar is a day grid, not a scheduler. */
  entryDate: text("entry_date").notNull(),
  /** Optional wall-clock time, e.g. "10:30". */
  entryTime: text("entry_time"),
  caseId: integer("case_id"),
  audience: text("audience").notNull().default("all"),
  createdBy: text("created_by").notNull().default(""),
  createdByRole: text("created_by_role").notNull().default(""),
  createdByClerkId: text("created_by_clerk_id").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCalendarEntrySchema = createInsertSchema(calendarEntriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCalendarEntry = z.infer<typeof insertCalendarEntrySchema>;
export type CalendarEntry = typeof calendarEntriesTable.$inferSelect;

/** True when `audience` addresses a member with this role and id. */
export function audienceIncludes(audience: string, role: string, clerkId: string): boolean {
  if (audience === "all") return true;
  if (audience === "staff") return role !== "client";
  if (audience.startsWith("role:")) return audience.slice(5) === role;
  if (audience.startsWith("user:")) return audience.slice(5) === clerkId;
  return false;
}
