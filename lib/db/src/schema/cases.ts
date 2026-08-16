import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const casesTable = pgTable("cases", {
  id: serial("id").primaryKey(),
  /** Tenant boundary. Every read of this table is filtered by the caller's verified workspace. */
  workspaceId: integer("workspace_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"), // open | in_progress | review | closed
  clientId: integer("client_id"),
  /** Who the matter is against. Free text because the other side is rarely a
   *  user of this system — and it is what the conflict check searches. */
  opposingParty: text("opposing_party"),
  /** Set when an advocate was shown a possible conflict and opened the matter
   *  anyway. The reason they gave is the record of that decision. */
  conflictAcknowledgedBy: text("conflict_acknowledged_by"),
  conflictNote: text("conflict_note"),
  /**
   * The court/registry reference for the matter. Required: a matter that
   * cannot be tied back to a filing is not findable in the place that counts,
   * and the field was optional for long enough that nobody filled it in.
   *
   * No default. A default would let an insert that forgot the reference
   * succeed with a placeholder, which is the failure this constraint exists to
   * prevent.
   */
  filingRef: text("filing_ref").notNull(),
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  /**
   * When the matter was closed. Null while it is open.
   *
   * Cycle time needs an end point, and the only record of one was a
   * `status_changed` timeline row with the new status inside a free-text
   * sentence. Parsing prose to compute a median is a metric that breaks the day
   * somebody rewords the message. Set by the update route whenever status
   * becomes "closed", and cleared if a closed matter is reopened.
   */
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCaseSchema = createInsertSchema(casesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCase = z.infer<typeof insertCaseSchema>;
export type Case = typeof casesTable.$inferSelect;
