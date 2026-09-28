import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Every kind of thing the matter's Activity Ledger records.
 *
 * A list rather than a comment, because the ledger is filterable now and both
 * ends need the same vocabulary: the server writes these strings and the UI
 * groups by them. It is deliberately NOT a database constraint and NOT an enum
 * in the OpenAPI schema — `eventType` stays a plain string on the wire, so a
 * row written by an older build with a type not on this list still reads back
 * and still filters, under its own raw name.
 *
 * `delay_logged` is here because the column comment always claimed it; nothing
 * writes one yet.
 */
export const TIMELINE_EVENT_TYPES = [
  "case_created",
  "status_changed",
  /**
   * The phase of the matter, which is not its status. Added when it turned out
   * `PATCH /cases/:id` wrote a timeline row for `status` and silently none for
   * `stage` — so the one field a chamber defines its own vocabulary for was
   * the one field whose changes left no trace on the matter.
   */
  "stage_changed",
  "document_added",
  "document_requested",
  "document_request_fulfilled",
  "task_assigned",
  "task_completed",
  "consultation_scheduled",
  /**
   * A proceeding under the matter — an application, an appeal — opened,
   * changed or removed. The whole point of proceedings being a first-class
   * object rather than a note in the title is that their movement is traceable
   * here.
   */
  "proceeding_opened",
  "proceeding_updated",
  "proceeding_closed",
  "proceeding_deleted",
  "delay_logged",
] as const;
export type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

export const timelineEventsTable = pgTable("timeline_events", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull(),
  /** One of TIMELINE_EVENT_TYPES — see the note there on why it is not an enum. */
  eventType: text("event_type").notNull(),
  description: text("description").notNull(),
  actorName: text("actor_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTimelineEventSchema = createInsertSchema(timelineEventsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTimelineEvent = z.infer<typeof insertTimelineEventSchema>;
export type TimelineEvent = typeof timelineEventsTable.$inferSelect;
